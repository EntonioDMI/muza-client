//! Нативный аудио-движок (шаг 1 переноса звука из WebView2 в процесс Музы).
//!
//! ЗАЧЕМ. «Захват аудио приложения» (OBS и всё на том же Windows API) обходит
//! дерево процессов от PID окна и обрывается на границе `muza-desktop.exe →
//! msedgewebview2.exe`: замер 10.08 — целясь в процессы WebView2 напрямую, звук
//! ловится (RMS 0.0028), из окна Музы ноль. Пока звук рендерит браузер, окно
//! «Муза» для стрима немое. Лечится единственным способом — выводом из своего
//! процесса, как это делает Spotify (у него процесса audio.mojom.AudioService
//! нет вовсе). Разбор — docs/notes/2026-08-10-обс-не-видит-звук-музы.md.
//!
//! СОСТОЯНИЕ: каркас. Один слот, без EQ/лимитера/кроссфейда — проверяется сам
//! принцип (гейт: пробник process-loopback должен поймать звук из PID окна).
//! Перенос DSP-цепи и остального — задачи 2–6.
//!
//! Ресемплинг: WASAPI в общем режиме держит частоту миксера (обычно 48 кГц), а
//! файлы в кэше сплошь 44.1 — без пересчёта музыка играла бы быстрее и выше.
//! Считает rubato (FFT, синхронный — соотношение частот постоянно), потому что
//! линейная интерполяция слышимо мажет верхи.

use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use audioadapter_buffers::direct::InterleavedSlice;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use symphonia::core::audio::GenericAudioBufferRef;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::registry::CodecRegistry;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;

/// Сколько секунд звука держим готовыми. Меньше — риск подхрипываний на
/// загруженной машине, больше — задержка реакции на паузу и перемотку.
const BUFFER_SECONDS: f32 = 1.5;

/// Реестр кодеков: штатные symphonia ПЛЮС Opus поверх libopus.
///
/// Своими силами symphonia Opus не умеет, а он у нас основной формат — 312
/// файлов из 423 в кэше (webm с YouTube). Поэтому вместо `default::get_codecs()`
/// собираем реестр сами: сначала всё включённое фичами, затем адаптер.
fn codecs() -> &'static CodecRegistry {
    static REGISTRY: std::sync::OnceLock<CodecRegistry> = std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| {
        let mut registry = CodecRegistry::new();
        symphonia::default::register_enabled_codecs(&mut registry);
        registry.register_audio_decoder::<symphonia_adapter_libopus::OpusDecoder>();
        registry
    })
}

struct Shared {
    /// Готовые к выводу сэмплы, уже в частоте и каналах устройства.
    pcm: Mutex<VecDeque<f32>>,
    paused: AtomicBool,
    stop: AtomicBool,
    /// Сколько кадров отдано устройству — из этого считается позиция.
    frames_out: AtomicU64,
    /// Частота и каналы ТЕКУЩЕГО устройства вывода. Атомики, потому что
    /// устройство может смениться на ходу (человек переключил вывод в
    /// Windows), и декодер обязан это заметить: под новую частоту нужен новый
    /// ресемплер.
    device_rate: AtomicU32,
    device_channels: AtomicU32,
    /// Громкость (биты f32), уже по перцептивной кривой — её считает
    /// вызывающий, формула общая с прежним движком.
    ///
    /// ⚠️ Именно атомик, а не Mutex. Ползунок шлёт значение десятки раз в
    /// секунду, и колбэк вывода не имеет права ни ждать блокировку, ни
    /// подставлять что-то своё, когда её не удалось взять: первая версия при
    /// неудачном try_lock брала 1.0, и каждое движение ползунка давало скачок
    /// громкости до максимума — те самые хрипы (жалоба владельца 10.08).
    volume: AtomicU32,
    /// Эквалайзер: включён и десять усилений полос в дБ (биты f32). Атомики —
    /// по той же причине, что и громкость: колбэк вывода не ждёт блокировок.
    eq_on: AtomicBool,
    eq_gains: [AtomicU32; 10],
    /// Запрошенная перемотка, секунды. Исполняет поток декодера: только он
    /// владеет читателем формата.
    seek_to: Mutex<Option<f64>>,
    /// Сколько кадров осталось до конца нарастания на старте. Звук всегда
    /// начинается с произвольной точки формы волны, и мгновенный старт с
    /// ненулевого уровня динамик отрабатывает низкочастотным щелчком —
    /// «ударом баса» (жалоба владельца 10.08).
    fade_in_left: AtomicU64,
    /// Декодер дошёл до конца файла. Трек считается сыгранным не здесь, а
    /// когда опустеет буфер — иначе конец объявлялся бы на полторы секунды
    /// раньше, чем человек его слышит.
    drained: AtomicBool,
}

pub struct NativeAudio {
    shared: Arc<Shared>,
}

impl NativeAudio {
    /// Открыть устройство вывода и начать проигрывать файл.
    ///
    /// `gain` обязателен и передаётся сразу, а не выставляется следом: поток
    /// вывода, начатый с чужой громкости, отдаёт первый буфер на ней — при
    /// тихом ползунке это удар в уши на старте каждого трека.
    pub fn play(path: &Path, gain: f32) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "нет устройства вывода".to_string())?;
        let config = device
            .default_output_config()
            .map_err(|e| format!("конфиг устройства: {e}"))?;

        let shared = Arc::new(Shared {
            pcm: Mutex::new(VecDeque::new()),
            paused: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            frames_out: AtomicU64::new(0),
            device_rate: AtomicU32::new(config.sample_rate().0),
            device_channels: AtomicU32::new(config.channels() as u32),
            volume: AtomicU32::new(gain.clamp(0.0, 4.0).to_bits()),
            fade_in_left: AtomicU64::new(0),
            eq_on: AtomicBool::new(false),
            eq_gains: std::array::from_fn(|_| AtomicU32::new(0f32.to_bits())),
            seek_to: Mutex::new(None),
            drained: AtomicBool::new(false),
        });

        // Декодер живёт в своём потоке: он спит, когда буфер полон, и не имеет
        // права блокировать колбэк вывода — тот реального времени.
        let decoder_shared = Arc::clone(&shared);
        let path = path.to_path_buf();
        std::thread::Builder::new()
            .name("muza-decode".into())
            .spawn(move || {
                if let Err(e) = decode_loop(&path, &decoder_shared) {
                    eprintln!("[audio] декодирование оборвалось: {e}");
                }
            })
            .map_err(|e| format!("поток декодера: {e}"))?;

        // Стрим cpal тоже в своём потоке: он !Send, а колбэк должен пережить
        // возврат из этой функции.
        //
        // ⚠️ ВНЕШНИЙ ЦИКЛ — ПРО СМЕНУ УСТРОЙСТВА ВЫВОДА. cpal открывает
        // КОНКРЕТНОЕ устройство и держит его: когда человек переключает вывод
        // в Windows или выдёргивает наушники, поток продолжает играть в
        // прежнее, и звук не пропадает там, где обязан (жалоба владельца
        // 10.08 — до нативного движка это работало, потому что переключение
        // за нас делал Chromium). Следим сами и переоткрываем вывод; буфер и
        // позиция при этом сохраняются, декодер даже не замечает.
        let stream_shared = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("muza-output".into())
            .spawn(move || {
                let host = cpal::default_host();
                let mut device = device;
                let mut config = config;
                loop {
                    if stream_shared.stop.load(Ordering::Relaxed) {
                        return;
                    }
                    let open_on = device.name().unwrap_or_default();
                    let rate = config.sample_rate().0;
                    let channels = config.channels() as usize;
                    // Декодер читает это каждый пакет: у нового устройства
                    // может быть другая частота, и ресемплер придётся собрать
                    // заново.
                    stream_shared.device_rate.store(rate, Ordering::Relaxed);
                    stream_shared.device_channels.store(channels as u32, Ordering::Relaxed);

                    // Отдельный клон для колбэка: он забирает владение, а
                    // самому потоку ссылка нужна дальше.
                    let cb = Arc::clone(&stream_shared);
                    // Живёт между вызовами колбэка: от неё ведётся плавный
                    // переход громкости, иначе каждый буфер начинался бы со
                    // скачка. Стартуем с УЖЕ ЗАДАННОЙ громкости, а не с
                    // единицы — иначе первый буфер едет с максимума вниз.
                    let mut current_gain = f32::from_bits(cb.volume.load(Ordering::Relaxed));
                    // 20 мс нарастания: на слух неразличимо, а щелчок от
                    // старта с ненулевого уровня убирает целиком.
                    let fade_total = (rate as u64 / 50).max(1);
                    cb.fade_in_left.store(fade_total, Ordering::Relaxed);
                    // Цепь обработки живёт вместе с потоком: у фильтров есть
                    // состояние, и при переоткрытии вывода оно начинается
                    // заново — это правильно, устройство другое.
                    let mut dsp = crate::dsp::Dsp::new(rate as f32);
                    let stream = device.build_output_stream(
                        &config.clone().into(),
                    move |out: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        // Поток реального времени: блокировку держим считанные
                        // микросекунды и забираем данные пачкой, а не по
                        // сэмплу — пер-сэмпловый pop_front под локом давал
                        // хрипы и щелчки.
                        if cb.paused.load(Ordering::Relaxed) {
                            out.fill(0.0);
                            return;
                        }
                        let target = f32::from_bits(cb.volume.load(Ordering::Relaxed));
                        let mut pcm = cb.pcm.lock().unwrap();
                        let ready = out.len().min(pcm.len());
                        // Громкость доводим до нового значения ЗА БУФЕР, а не
                        // ступенькой на его границе: мгновенный скачок уровня
                        // слышен щелчком, и на движении ползунка щелчки идут
                        // очередью. Прежний движок получал это даром от
                        // GainNode, здесь считаем сами.
                        let frames = (ready / channels).max(1);
                        let step = (target - current_gain) / frames as f32;
                        let mut gain = current_gain;
                        let mut fade_left = cb.fade_in_left.load(Ordering::Relaxed);
                        for (i, (slot, sample)) in
                            out.iter_mut().zip(pcm.drain(..ready)).enumerate()
                        {
                            // Нарастание на старте: множитель от 0 к 1.
                            let fade = if fade_left > 0 {
                                (fade_total - fade_left) as f32 / fade_total as f32
                            } else {
                                1.0
                            };
                            *slot = sample * gain * fade;
                            if (i + 1) % channels == 0 {
                                gain += step;
                                fade_left = fade_left.saturating_sub(1);
                            }
                        }
                        cb.fade_in_left.store(fade_left, Ordering::Relaxed);
                        current_gain = target;
                        drop(pcm);

                        // Эквалайзер и лимитер — после громкости, последними
                        // перед выходом: лимитер обязан видеть тот уровень,
                        // который реально уйдёт в устройство. Фильтры линейны,
                        // поэтому порядок с громкостью на звук не влияет.
                        let gains: [f32; 10] = std::array::from_fn(|i| {
                            f32::from_bits(cb.eq_gains[i].load(Ordering::Relaxed))
                        });
                        dsp.set_bands(cb.eq_on.load(Ordering::Relaxed), &gains, rate as f32);
                        dsp.process(&mut out[..ready], channels, rate as f32);
                        // Буфер не успел наполниться — тишина лучше мусора.
                        out[ready..].fill(0.0);
                        // Пауза сюда не доходит — выше ранний возврат, и часы
                        // позиции на паузе честно стоят.
                        let played = out.len() as u64 / channels as u64;
                        cb.frames_out.fetch_add(played, Ordering::Relaxed);
                    },
                        |e| eprintln!("[audio] поток вывода: {e}"),
                        None,
                    );
                    let stream = match stream {
                        Ok(stream) => stream,
                        Err(e) => {
                            eprintln!("[audio] не открылся вывод: {e}");
                            return;
                        }
                    };
                    if let Err(e) = stream.play() {
                        eprintln!("[audio] старт вывода: {e}");
                        return;
                    }

                    // Держим стрим живым, пока не попросят остановиться или
                    // пока человек не переключит устройство по умолчанию.
                    loop {
                        if stream_shared.stop.load(Ordering::Relaxed) {
                            return;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        let Some(now) = host.default_output_device() else {
                            continue; // устройств не осталось — ждём появления
                        };
                        if now.name().unwrap_or_default() == open_on {
                            continue;
                        }
                        if let Ok(cfg) = now.default_output_config() {
                            device = now;
                            config = cfg;
                            break; // стрим дропнется — прежнее устройство отпустим
                        }
                    }
                }
            })
            .map_err(|e| format!("поток вывода: {e}"))?;

        Ok(Self { shared })
    }

    pub fn set_paused(&self, paused: bool) {
        self.shared.paused.store(paused, Ordering::Relaxed);
    }

    pub fn position(&self) -> f64 {
        let frames = self.shared.frames_out.load(Ordering::Relaxed) as f64;
        frames / self.shared.device_rate.load(Ordering::Relaxed).max(1) as f64
    }

    /// Полосы эквалайзера в дБ. Пересборку коэффициентов делает сам DSP —
    /// и только когда значения реально изменились.
    pub fn set_eq(&self, on: bool, bands: &[f32]) {
        self.shared.eq_on.store(on, Ordering::Relaxed);
        for (slot, value) in self.shared.eq_gains.iter().zip(bands.iter()) {
            slot.store(value.clamp(-24.0, 24.0).to_bits(), Ordering::Relaxed);
        }
    }

    /// Громкость 0..1 (кривую считает вызывающий — она общая с прежним движком).
    pub fn set_volume(&self, gain: f32) {
        self.shared.volume.store(gain.clamp(0.0, 4.0).to_bits(), Ordering::Relaxed);
    }

    /// Перемотка исполняется потоком декодера — только он владеет читателем.
    ///
    /// Но буфер чистим ПРЯМО ЗДЕСЬ, не дожидаясь его: во-первых, в нём лежит
    /// до полутора секунд звука со старой позиции, и без очистки человек
    /// слышал бы прежнее место ещё секунду после прыжка; во-вторых, декодер
    /// почти всегда спит в ожидании свободного места и до проверки запроса
    /// доходит только проснувшись — освобождая буфер, мы его и будим.
    pub fn seek(&self, sec: f64) {
        let sec = sec.max(0.0);
        *self.shared.seek_to.lock().unwrap() = Some(sec);
        self.shared.pcm.lock().unwrap().clear();
        let rate = self.shared.device_rate.load(Ordering::Relaxed);
        let frames = (sec * rate as f64) as u64;
        self.shared.frames_out.store(frames, Ordering::Relaxed);
    }

    /// Трек доигран: декодер дошёл до конца И буфер опустел. Второе условие
    /// обязательно — иначе конец объявлялся бы за полторы секунды до того, как
    /// человек его услышит, и следующий трек наезжал бы на хвост текущего.
    pub fn ended(&self) -> bool {
        self.shared.drained.load(Ordering::Relaxed) && self.shared.pcm.lock().unwrap().is_empty()
    }

    pub fn stop(&self) {
        self.shared.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for NativeAudio {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Декод файла до конца: symphonia отдаёт кадры, мы приводим их к частоте и
/// числу каналов устройства и складываем в общий буфер.
fn decode_loop(path: &Path, shared: &Arc<Shared>) -> Result<(), String> {
    let file = File::open(path).map_err(|e| format!("открыть файл: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| format!("формат не распознан: {e}"))?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| "в файле нет звуковой дорожки".to_string())?;
    let track_id = track.id;
    let audio_params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| "у дорожки нет параметров звука".to_string())?
        .clone();

    let mut decoder = codecs()
        .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
        .map_err(|e| format!("кодек не поддержан: {e}"))?;

    // Параметры устройства перечитываются каждый пакет: человек может
    // переключить вывод на ходу, и тогда нужен новый ресемплер.
    let mut out_rate = shared.device_rate.load(Ordering::Relaxed);
    let mut out_channels = shared.device_channels.load(Ordering::Relaxed) as usize;
    let mut capacity = (out_rate as f32 * BUFFER_SECONDS) as usize * out_channels;
    // Ресемплер создаётся лениво: частота источника известна только из первого
    // декодированного пакета, а не из заголовка (у некоторых контейнеров её
    // там просто нет).
    let mut resampler: Option<Resampler> = None;

    while !shared.stop.load(Ordering::Relaxed) {
        // Устройство могли переключить — тогда у него другая частота, и
        // ресемплер, собранный под прежнюю, гнал бы музыку не с той скоростью.
        let now_rate = shared.device_rate.load(Ordering::Relaxed);
        let now_channels = shared.device_channels.load(Ordering::Relaxed) as usize;
        if now_rate != out_rate || now_channels != out_channels {
            out_rate = now_rate;
            out_channels = now_channels;
            capacity = (out_rate as f32 * BUFFER_SECONDS) as usize * out_channels;
            resampler = None;
        }

        // Перемотка: сносим всё, что уже насчитано вперёд, иначе после прыжка
        // ещё полторы секунды играл бы старый кусок.
        let requested = shared.seek_to.lock().unwrap().take();
        if let Some(sec) = requested {
            let time = Time::from_millis_u64((sec * 1000.0) as u64);
            let target = SeekTo::Time { time, track_id: Some(track_id) };
            if let Err(e) = format.seek(SeekMode::Accurate, target) {
                eprintln!("[audio] перемотка не удалась: {e}");
            }
            decoder.reset();
            shared.pcm.lock().unwrap().clear();
            shared.frames_out.store((sec * out_rate as f64) as u64, Ordering::Relaxed);
            shared.drained.store(false, Ordering::Relaxed);
            // Ресемплер копит кадры — его недосчитанный хвост принадлежит
            // прежней позиции и щёлкнул бы на стыке.
            resampler = None;
        }

        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => {
                shared.drained.store(true, Ordering::Relaxed);
                break; // файл кончился
            }
            Err(e) => return Err(format!("чтение пакета: {e}")),
        };
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue, // битый пакет — пропускаем, музыка важнее
        };
        let (samples, in_channels, in_rate) = flatten(&decoded);
        // Раскладка каналов делается ДО пересчёта частоты: моно идёт тем же
        // сэмплом в оба уха, лишние каналы источника отбрасываются (настоящее
        // сведение придёт с DSP-цепью).
        let mut mapped = Vec::with_capacity(samples.len() / in_channels.max(1) * out_channels);
        for frame in samples.chunks(in_channels.max(1)) {
            for ch in 0..out_channels {
                let src = if in_channels == 1 { 0 } else { ch.min(in_channels - 1) };
                mapped.push(frame[src]);
            }
        }

        let chunk = match resampler.as_mut() {
            Some(r) => r.push(&mapped),
            None if in_rate == out_rate => mapped, // частоты совпали — пересчёт не нужен
            None => {
                let mut r = Resampler::new(in_rate, out_rate, out_channels)?;
                let first = r.push(&mapped);
                resampler = Some(r);
                first
            }
        };
        if chunk.is_empty() {
            continue; // ресемплер копит кадры до полного окна
        }

        // Ждём, пока в буфере освободится место: держать весь трек в памяти
        // незачем, а колбэк вывода не должен упереться в пустоту.
        loop {
            if shared.stop.load(Ordering::Relaxed) {
                return Ok(());
            }
            let mut pcm = shared.pcm.lock().unwrap();
            if pcm.len() < capacity {
                pcm.extend(chunk.iter().copied());
                break;
            }
            drop(pcm);
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
    Ok(())
}

// ── Команды для фронта ───────────────────────────────────────────────
//
// Движок один на приложение: слот пока тоже один (второй придёт с кроссфейдом).
// Новый play глушит прежний через Drop — вывод останавливается сам.

static ENGINE: Mutex<Option<NativeAudio>> = Mutex::new(None);

/// Что плееру нужно знать каждый тик. Позиция и конец трека спрашиваются
/// вместе: фронт и так опрашивает позицию, отдельные события были бы лишним
/// каналом с собственными гонками.
#[derive(serde::Serialize)]
pub struct NativeStatus {
    position: f64,
    ended: bool,
    playing: bool,
}

#[tauri::command]
pub fn native_play(path: String, volume: f32) -> Result<(), String> {
    // Прежний трек гасим ПЛАВНО и только потом сносим: обрыв потока на
    // середине формы волны динамик отрабатывает низкочастотным щелчком —
    // «ударом баса» при каждом переключении. Рампа громкости в колбэке сводит
    // уровень за один буфер, ждём чуть дольше, чтобы он успел выйти.
    if let Some(old) = ENGINE.lock().unwrap().as_ref() {
        old.set_volume(0.0);
    }
    std::thread::sleep(std::time::Duration::from_millis(30));

    let audio = NativeAudio::play(Path::new(&path), volume)?;
    *ENGINE.lock().unwrap() = Some(audio);
    Ok(())
}

#[tauri::command]
pub fn native_set_paused(paused: bool) {
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_paused(paused);
    }
}

#[tauri::command]
pub fn native_seek(sec: f64) {
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.seek(sec);
    }
}

#[tauri::command]
pub fn native_set_volume(gain: f32) {
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_volume(gain);
    }
}

#[tauri::command]
pub fn native_status() -> NativeStatus {
    match ENGINE.lock().unwrap().as_ref() {
        Some(audio) => NativeStatus {
            position: audio.position(),
            ended: audio.ended(),
            playing: true,
        },
        None => NativeStatus { position: 0.0, ended: false, playing: false },
    }
}

#[tauri::command]
pub fn native_set_eq(on: bool, bands: Vec<f32>) {
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_eq(on, &bands);
    }
}

#[tauri::command]
pub fn native_stop() {
    *ENGINE.lock().unwrap() = None; // Drop останавливает вывод и декодер
}

/// Пересчёт частоты дискретизации под устройство.
///
/// rubato работает планарно (канал за каналом) и требует ровно столько кадров,
/// сколько скажет `input_frames_next` — а пакеты декодера приходят произвольной
/// длины. Поэтому вход копится здесь, и окно отдаётся ресемплеру целиком.
struct Resampler {
    inner: rubato::Fft<f32>,
    /// Накопленный вход, чередующийся.
    pending: Vec<f32>,
    /// Преаллоцированный выход: в реальном времени аллокаций быть не должно.
    out: Vec<f32>,
    out_max: usize,
    channels: usize,
}

impl Resampler {
    fn new(in_rate: u32, out_rate: u32, channels: usize) -> Result<Self, String> {
        const CHUNK: usize = 1024;
        let inner = rubato::Fft::<f32>::new(
            in_rate as usize,
            out_rate as usize,
            CHUNK,
            channels,
            rubato::FixedSync::Input,
        )
        .map_err(|e| format!("ресемплер {in_rate}→{out_rate}: {e}"))?;
        let out_max = rubato::Resampler::output_frames_max(&inner);
        Ok(Self {
            inner,
            pending: Vec::new(),
            out: vec![0.0; out_max * channels],
            out_max,
            channels,
        })
    }

    /// Скормить чередующиеся кадры и забрать готовые — тоже чередующиеся.
    /// Пусто, пока не набралось полное окно.
    fn push(&mut self, interleaved: &[f32]) -> Vec<f32> {
        let Self { inner, pending, out, out_max, channels } = self;
        pending.extend_from_slice(interleaved);
        let mut result = Vec::new();
        loop {
            let need_frames = rubato::Resampler::input_frames_next(inner);
            let need = need_frames * *channels;
            if pending.len() < need {
                break;
            }
            let written = {
                let Ok(input) = InterleavedSlice::new(&pending[..need], *channels, need_frames)
                else {
                    break;
                };
                let Ok(mut output) = InterleavedSlice::new_mut(&mut out[..], *channels, *out_max)
                else {
                    break;
                };
                match rubato::Resampler::process_into_buffer(inner, &input, &mut output, None) {
                    Ok((_, written)) => written,
                    Err(e) => {
                        eprintln!("[audio] ресемплер сбоил: {e}");
                        break;
                    }
                }
            };
            result.extend_from_slice(&out[..written * *channels]);
            pending.drain(..need);
        }
        result
    }
}

/// Привести буфер symphonia к плоскому f32-чередованию (L,R,L,R…).
/// Пересчёт форматов сэмплов (i16/i32/f64…) в f32 делает сама symphonia.
fn flatten(buf: &GenericAudioBufferRef<'_>) -> (Vec<f32>, usize, u32) {
    let spec = buf.spec();
    let channels = spec.channels().count();
    let rate = spec.rate();
    let mut out: Vec<f32> = Vec::with_capacity(buf.frames() * channels);
    buf.copy_to_vec_interleaved(&mut out);
    (out, channels, rate)
}
