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

/// Окно преобразования Фурье. 2048 — то же значение, что стояло у AnalyserNode:
/// визуализатор рассчитан ровно на 1024 полосы, и менять его незачем.
const FFT_SIZE: usize = 2048;
/// Границы шкалы в дБ и сглаживание — тоже из AnalyserNode, иначе картинка
/// стала бы другой по яркости и резкости.
const MIN_DB: f32 = -100.0;
const MAX_DB: f32 = -30.0;
const SMOOTHING: f32 = 0.7;

/// Множитель кроссфейда в точке `pos` из `len` кадров.
///
/// Кривые равномощные (sin/cos): линейные дают провал −3 дБ на стыке разных
/// треков, потому что суммарная мощность в середине проседает. Вынесено из
/// колбэка отдельной функцией, чтобы равномощность можно было проверить.
fn xfade_gain(pos: u64, len: u64, fade_in: bool) -> f32 {
    if len == 0 {
        return 1.0;
    }
    let p = (pos as f32 / len as f32).min(1.0);
    let angle = p * std::f32::consts::FRAC_PI_2;
    if fade_in {
        angle.sin()
    } else {
        angle.cos()
    }
}

/// Сколько секунд звука держим готовыми. Меньше — риск подхрипываний на
/// загруженной машине, больше — задержка реакции на паузу и перемотку.
const BUFFER_SECONDS: f32 = 1.5;

/// Признак «трек доигран» отдельной функцией — чтобы его можно было проверить
/// без устройства вывода (см. NativeAudio::ended, там же разбор каждого из
/// трёх условий).
fn is_ended(drained: bool, seek_pending: bool, pcm_empty: bool) -> bool {
    drained && !seek_pending && pcm_empty
}

/// Предел тональности сдвига высоты: выше этой частоты вокодер тон не двигает.
///
/// Без предела опущенный трек звучит глухо (шипящие уезжают вниз вместе со
/// всем), а поднятый — стеклянно. Восемь килогерц — рекомендация самой
/// библиотеки: там кончается область, где ухо слышит ВЫСОТУ, и начинается та,
/// где оно слышит ШУМ, а шум двигать незачем.
const TONALITY_LIMIT_HZ: f32 = 8000.0;

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
    /// Скорость воспроизведения (биты f32). Тон при этом не едет: время
    /// растягивает фазовый вокодер, а не пересчёт частоты.
    speed: AtomicU32,
    /// Сдвиг высоты тона в полутонах, НЕЗАВИСИМО от скорости (биты f32).
    ///
    /// Это вторая половина «стретча» в смысле FL Studio: там время и высота —
    /// две отдельные ручки, а у нас до 11.08.2026 была одна. Прежний путь
    /// («замедление» пересчётом частоты) двигал их СЦЕПЛЕННО: медленнее — значит
    /// ниже, и иначе никак. Фазовый вокодер эту связь рвёт, и её надо было
    /// только вывести наружу.
    ///
    /// 0 — как записано. Плюс — выше, минус — ниже.
    pitch: AtomicU32,
    /// Характер растяжения темпа: false — фазовый вокодер, true — WSOLA.
    ///
    /// Два РАЗНЫХ по природе метода, а не «качество похуже/получше». Вокодер
    /// гладок на тянущемся, WSOLA держит удары. Выбор за человеком — ровно как
    /// в Music Speed Changer, где переключаются два обработчика (жалоба друга
    /// владельца 11.08.2026: «звук не такой, как там»). Разбор — src/wsola.rs.
    tempo_wsola: AtomicBool,
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
    /// Кроссфейд: сколько кадров кривой пройдено и сколько всего. Ноль в
    /// длине — фейда нет, множитель единица.
    xfade_pos: AtomicU64,
    xfade_len: AtomicU64,
    /// true — нарастаем (приходящий трек), false — гаснем (уходящий).
    xfade_in: AtomicBool,
    /// Дополнительные устройства вывода («вывод на устройства» в настройках).
    ///
    /// Кормятся УЖЕ ОБРАБОТАННЫМ сигналом — тем самым, что уходит в основной
    /// выход. Так эквалайзер и лимитер считаются один раз, а все устройства
    /// получают побитово одинаковый звук: посчитай мы каждому отдельно, они
    /// разъехались бы по времени, потому что тактируются своими генераторами.
    taps: Mutex<Vec<Arc<Tap>>>,
    /// Захват голоса, общий на движок.
    mic: Mutex<Option<Arc<Mic>>>,
    /// Последние кадры финального сигнала — сведённые в моно, для
    /// визуализатора. Ровно окно преобразования Фурье, ничего сверх.
    scope: Mutex<VecDeque<f32>>,
    /// Сглаженный спектр между запросами: без него столбики дёргаются.
    /// Постоянная 0.7 — та же, что стояла у AnalyserNode.
    spectrum_prev: Mutex<Vec<f32>>,
    /// Есть живые маршруты — системный выход молчит: звук идёт только туда,
    /// куда человек его направил. Инвариант прежнего движка.
    taps_active: AtomicBool,
    /// Почему декодер умер. До 12.08 эта строка уходила в `eprintln!` и не
    /// доезжала НИКУДА: файл чужого формата или битый давал «успешный»
    /// native_play, движок молчал, `drained` не выставлялся, конец трека не
    /// приходил — плеер вставал навсегда, а на экране всё было хорошо.
    /// Читает native_status, дальше фронт гасит нативный путь и падает на
    /// прежний движок (nativeEngine.ts).
    error: Mutex<Option<String>>,
}

/// Одно дополнительное устройство вывода.
struct Tap {
    device_name: String,
    pcm: Mutex<VecDeque<f32>>,
    /// Своя громкость, независимая от ползунка приложения.
    gain: AtomicU32,
    stop: AtomicBool,
    /// Подмешивать ли голос. Голос идёт МИМО музыкальной цепи: эквалайзер и
    /// нормализация настроены под музыку, и пропускать через них речь незачем.
    mix_mic: AtomicBool,
    /// Голос копится отдельно от музыки — у каждого маршрута свой запас,
    /// иначе первый же прочитавший съел бы его у остальных.
    mic_pcm: Mutex<VecDeque<f32>>,
}

/// Захват голоса. Один на приложение: микрофон общий, а раздаётся он в те
/// маршруты, где включён.
struct Mic {
    device_name: Option<String>,
    gain: AtomicU32,
    stop: AtomicBool,
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
        // ⚠️ ФАЙЛ ОТКРЫВАЕМ ЗДЕСЬ, а не внутри потока декодера. Открытие — это
        // единственная проверка, которую можно сделать ДО возврата из этой
        // функции, и её результат обязан доехать до вызывающего: до 12.08
        // File::open жил в замыкании, отказ уходил в `eprintln!`, а
        // `native_play` отвечал `Ok` на несуществующий файл. Фронт к тому
        // моменту уже заглушил прежний движок — получалась вечная тишина.
        //
        // Отказ формата так поймать нельзя (его видит только проба внутри
        // decode_loop) — он приезжает позже через `shared.error`.
        drop(File::open(path).map_err(|e| format!("открыть файл: {e}"))?);
        // ⚠️ ФАБРИКА, А НЕ ОДИН ДЕСКРИПТОР. Источник строится заново каждый раз,
        // когда читатель не смог перемотаться (Outcome::Rebuild ниже) — держать
        // единственный File здесь значило бы «перемотки после конца файла не
        // будет никогда».
        let path = path.to_path_buf();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_string());
        Self::start(
            move || {
                let file = File::open(&path).map_err(|e| format!("открыть файл: {e}"))?;
                let mss = MediaSourceStream::new(Box::new(file), Default::default());
                let mut hint = Hint::new();
                if let Some(ext) = &ext {
                    hint.with_extension(ext);
                }
                Ok((mss, hint))
            },
            gain,
        )
    }

    /// Играть трек, который ЕЩЁ КАЧАЕТСЯ: читаем растущий файл напрямую, без
    /// HTTP-петли через muza-stream — та нужна только элементу `<audio>`.
    pub fn play_stream(live: crate::engine::LiveStream, gain: f32) -> Result<Self, String> {
        // Расширение достаём из имени `.part` (`<id>.<ext>.part`): демуксеру
        // подсказка нужна, а угадывать по содержимому дороже.
        let hint_ext = live
            .part
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.rsplit('.').next())
            .map(|s| s.to_string());
        Self::start(
            move || {
                let source = GrowingSource::open(live.clone())?;
                let mss = MediaSourceStream::new(Box::new(source), Default::default());
                let mut hint = Hint::new();
                if let Some(ext) = &hint_ext {
                    hint.with_extension(ext);
                }
                Ok((mss, hint))
            },
            gain,
        )
    }

    fn start<F>(make_source: F, gain: f32) -> Result<Self, String>
    where
        F: Fn() -> Result<(MediaSourceStream<'static>, Hint), String> + Send + 'static,
    {
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
            speed: AtomicU32::new(1.0f32.to_bits()),
            pitch: AtomicU32::new(0f32.to_bits()),
            tempo_wsola: AtomicBool::new(false),
            eq_on: AtomicBool::new(false),
            eq_gains: std::array::from_fn(|_| AtomicU32::new(0f32.to_bits())),
            seek_to: Mutex::new(None),
            drained: AtomicBool::new(false),
            xfade_pos: AtomicU64::new(0),
            xfade_len: AtomicU64::new(0),
            xfade_in: AtomicBool::new(true),
            taps: Mutex::new(Vec::new()),
            mic: Mutex::new(None),
            scope: Mutex::new(VecDeque::new()),
            spectrum_prev: Mutex::new(Vec::new()),
            taps_active: AtomicBool::new(false),
            error: Mutex::new(None),
        });

        // Декодер живёт в своём потоке: он спит, когда буфер полон, и не имеет
        // права блокировать колбэк вывода — тот реального времени.
        // ⚠️ ОШИБКА ДЕКОДЕРА ОБЯЗАНА КУДА-ТО ПРИЕХАТЬ. До 12.08 обе ветки ниже
        // писали в `eprintln!` — то есть в никуда: у собранного приложения
        // консоли нет. Файл чужого формата или битый выглядел как удачный
        // старт, звука не было, `drained` не выставлялся, конец трека не
        // приходил, и плеер вставал насмерть с бегущей полоской. Теперь
        // причина ложится в `shared.error`, откуда её забирает native_status.
        let decoder_shared = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("muza-decode".into())
            .spawn(move || {
                // ⚠️ ВНЕШНИЙ ЦИКЛ — ЭТО ПЕРЕСБОРКА ЧИТАТЕЛЯ (12.08.2026).
                //
                // Живой замер границы повтора: `format.seek` после конца файла
                // на webm/mkv отвечает «malformed stream: mkv (ebml): the
                // element is not an ancestor of the current element» — то есть
                // читатель, дочитавший сегмент до конца, отмотать себя уже НЕ
                // МОЖЕТ. А webm — наш основной контейнер (312 файлов из 423 в
                // кэше). Дальше всё выглядело так: декодер вставал обратно в
                // парковку с drained=true, фронт видел «трек кончился» ещё
                // раз, слал перемотку ещё раз — и так по кругу, пока сторож
                // замершего звука не перезапускал трек через 30 секунд. Это и
                // есть жалоба «повтор происходит только через полминуты».
                //
                // Лечится не «более удачной перемоткой», а СВЕЖИМ ЧИТАТЕЛЕМ:
                // запрос остаётся в `seek_to`, источник строится заново, и
                // новый decode_loop отматывает его первым же проходом — там
                // читатель ещё в начале сегмента, и перемотка законна.
                let mut failure: Option<String> = None;
                loop {
                    let built = match make_source() {
                        Ok(source) => source,
                        Err(e) => {
                            failure = Some(format!("источник не открылся: {e}"));
                            break;
                        }
                    };
                    match decode_loop(built.0, built.1, &decoder_shared) {
                        Ok(Outcome::Done) => break,
                        Ok(Outcome::Rebuild { progressed, why }) => {
                            // Свежий читатель не смог того же самого — пересборка
                            // не лечит, и крутить её вечно значит греть процессор
                            // вместо музыки. Причину наружу, дальше фронт свалится
                            // на прежний движок.
                            if !progressed {
                                failure = Some(format!("перемотка не удалась и на свежем читателе: {why}"));
                                break;
                            }
                            // Событие редкое (граница повтора, перемотка после
                            // конца трека) и объясняет целый класс жалоб —
                            // пусть будет видно, что сработало именно оно.
                            eprintln!("[audio] читатель пересобран: {why}");
                        }
                        Err(e) => {
                            failure = Some(format!("декодирование оборвалось: {e}"));
                            break;
                        }
                    }
                }
                if let Some(message) = failure {
                    eprintln!("[audio] {message}");
                    *decoder_shared.error.lock().unwrap() = Some(message);
                    // Иначе фронт ждал бы конца трека, которого не будет:
                    // сторож замершего звука должен увидеть и конец, и причину.
                    decoder_shared.drained.store(true, Ordering::Relaxed);
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
                        let mut xpos = cb.xfade_pos.load(Ordering::Relaxed);
                        let xlen = cb.xfade_len.load(Ordering::Relaxed);
                        let xin = cb.xfade_in.load(Ordering::Relaxed);
                        for (i, (slot, sample)) in
                            out.iter_mut().zip(pcm.drain(..ready)).enumerate()
                        {
                            // Нарастание на старте: множитель от 0 к 1.
                            let fade = if fade_left > 0 {
                                (fade_total - fade_left) as f32 / fade_total as f32
                            } else {
                                1.0
                            };
                            let xfade = xfade_gain(xpos, xlen, xin);
                            *slot = sample * gain * fade * xfade;
                            if (i + 1) % channels == 0 {
                                gain += step;
                                fade_left = fade_left.saturating_sub(1);
                                if xpos < xlen {
                                    xpos += 1;
                                }
                            }
                        }
                        cb.fade_in_left.store(fade_left, Ordering::Relaxed);
                        cb.xfade_pos.store(xpos, Ordering::Relaxed);
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

                        // Снимок для визуализатора: берём финальный сигнал —
                        // тот, что человек слышит, уже после эквалайзера и
                        // лимитера. Ровно как analyser стоял в конце цепи.
                        if let Ok(mut scope) = cb.scope.try_lock() {
                            for frame in out.chunks(channels) {
                                let mono = frame.iter().sum::<f32>() / channels as f32;
                                scope.push_back(mono);
                            }
                            while scope.len() > FFT_SIZE {
                                scope.pop_front();
                            }
                        }

                        // Раздача в дополнительные устройства. try_lock, а не
                        // lock: колбэк реального времени не имеет права ждать
                        // ни настройку маршрутов, ни чужое устройство —
                        // пропустить кадры в тапе не так страшно, как сорвать
                        // основной вывод.
                        if let Ok(taps) = cb.taps.try_lock() {
                            for tap in taps.iter() {
                                if let Ok(mut buf) = tap.pcm.try_lock() {
                                    buf.extend(out.iter().copied());
                                    // Устройство встало или отстаёт — не даём
                                    // буферу расти без предела, роняем старое.
                                    let cap = out.len() * 8;
                                    while buf.len() > cap {
                                        buf.pop_front();
                                    }
                                }
                            }
                        }
                        // Есть живые маршруты — системный выход молчит: звук
                        // идёт только туда, куда его направили. Считать цепь
                        // всё равно надо, этот поток кормит тапы.
                        if cb.taps_active.load(Ordering::Relaxed) {
                            out.fill(0.0);
                        }
                        // Пауза сюда не доходит — выше ранний возврат, и часы
                        // позиции на паузе честно стоят.
                        // Позиция считается по ИСХОДНОМУ треку: на удвоенной
                        // скорости секунда вывода — это две секунды песни,
                        // иначе полоса и текст отстали бы вдвое.
                        let speed = f32::from_bits(cb.speed.load(Ordering::Relaxed));
                        let played = out.len() as f32 / channels as f32 * speed;
                        cb.frames_out.fetch_add(played as u64, Ordering::Relaxed);
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

    /// Маршруты вывода: пары «имя устройства, громкость 0..1».
    ///
    /// Имя приходит с фронта как подпись устройства из браузерного списка, а
    /// cpal называет их по-своему — сверяем по вхождению подстроки в любую
    /// сторону. Точного соответствия между двумя перечислениями устройств в
    /// Windows не существует.
    pub fn set_outputs(&self, routes: &[(String, f32, bool)]) {
        {
            let mut taps = self.shared.taps.lock().unwrap();
            for tap in taps.iter() {
                tap.stop.store(true, Ordering::Relaxed);
            }
            taps.clear();
        }
        let mut created: Vec<Arc<Tap>> = Vec::new();
        for (name, gain, mix_mic) in routes {
            let tap = Arc::new(Tap {
                device_name: name.clone(),
                pcm: Mutex::new(VecDeque::new()),
                gain: AtomicU32::new(gain.clamp(0.0, 4.0).to_bits()),
                stop: AtomicBool::new(false),
                mix_mic: AtomicBool::new(*mix_mic),
                mic_pcm: Mutex::new(VecDeque::new()),
            });
            spawn_tap(&self.shared, Arc::clone(&tap));
            created.push(tap);
        }
        // ⚠️ ФЛАГ СЧИТАЕТСЯ ПО ЗАПРОШЕННЫМ МАРШРУТАМ, А НЕ ПО СОЗДАННЫМ
        // (11.08.2026, жалоба владельца «переставил вывод на устройство,
        // которого нет, а музыка продолжила играть в наушниках»).
        //
        // Было `!created.is_empty()`. Устройство ищется и открывается ПОЗЖЕ, в
        // потоке тапа (spawn_tap), и при неудаче тот просто пишет в stderr и
        // выходит. Любой отказ — устройства нет в списке cpal, имя не сошлось,
        // формат не открылся — оставлял флаг снятым, и системный выход
        // продолжал звучать. То есть человек направлял звук в одно место, а
        // слышал его в другом, без единого признака, что что-то не так.
        //
        // Инвариант прежнего движка звучит иначе: «есть маршруты — системный
        // выход молчит». Он про НАМЕРЕНИЕ, а не про успех. Отказ обязан
        // кончаться тишиной в выбранном устройстве — её видно и объяснимо, — а
        // не звуком в том устройстве, которое человек только что отключил.
        let active = !routes.is_empty();
        *self.shared.taps.lock().unwrap() = created;
        self.shared.taps_active.store(active, Ordering::Relaxed);
    }

    /// Скорость воспроизведения. 1.0 — как записано.
    pub fn set_speed(&self, speed: f32) {
        self.shared.speed.store(speed.clamp(0.25, 4.0).to_bits(), Ordering::Relaxed);
    }

    /// Высота тона в полутонах, независимо от скорости. Разбор — у поля `pitch`.
    ///
    /// Границы ±24 (две октавы) взяты не из библиотеки, а из смысла: дальше
    /// фазовый вокодер перестаёт звучать музыкой при любых настройках, и ручка
    /// с бесполезным ходом хуже, чем ручка без него.
    /// Характер темпа: true — WSOLA (держит удары), false — вокодер (гладок).
    pub fn set_tempo_mode(&self, wsola: bool) {
        self.shared.tempo_wsola.store(wsola, Ordering::Relaxed);
    }

    pub fn set_pitch(&self, semitones: f32) {
        self.shared.pitch.store(semitones.clamp(-24.0, 24.0).to_bits(), Ordering::Relaxed);
    }

    /// Микрофон для подмешивания. `None` в имени — системный по умолчанию.
    /// Поток захвата один на движок и живёт, пока есть хоть один маршрут.
    pub fn set_mic(&self, device_name: Option<String>, gain: f32) {
        let mut slot = self.shared.mic.lock().unwrap();
        if let Some(old) = slot.take() {
            old.stop.store(true, Ordering::Relaxed);
        }
        let mic = Arc::new(Mic {
            device_name,
            gain: AtomicU32::new(gain.clamp(0.0, 4.0).to_bits()),
            stop: AtomicBool::new(false),
        });
        spawn_mic(&self.shared, Arc::clone(&mic));
        *slot = Some(mic);
    }

    /// Запустить кривую кроссфейда: нарастание для приходящего трека,
    /// затухание для уходящего. Длительность в секундах.
    pub fn start_crossfade(&self, fade_in: bool, seconds: f64) {
        let rate = self.shared.device_rate.load(Ordering::Relaxed) as f64;
        let len = (seconds.max(0.0) * rate) as u64;
        self.shared.xfade_in.store(fade_in, Ordering::Relaxed);
        self.shared.xfade_pos.store(0, Ordering::Relaxed);
        self.shared.xfade_len.store(len, Ordering::Relaxed);
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

    /// Почему звука не будет; None — всё в порядке. Заполняет поток декодера.
    pub fn error(&self) -> Option<String> {
        self.shared.error.lock().unwrap().clone()
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
    ///
    /// ⚠️ ТРЕТЬЕ УСЛОВИЕ — ЗАКАЗАННАЯ ПЕРЕМОТКА (12.08.2026). Заказали
    /// перемотку — трек не «кончился», он сейчас поедет с новой точки, и
    /// объявлять конец нельзя, пока запрос не исполнен. Без этого получался
    /// шторм: `HybridAudioEngine.seek` снимает защёлку `endedSent` СИНХРОННО, а
    /// `drained` гаснет только когда до запроса дойдёт поток декодера. В окне
    /// между ними опрос (4 раза в секунду) видел конец ещё раз, слал ещё одну
    /// границу, та — ещё одну перемотку, и позиция топталась около нуля.
    /// Замер 12.08: 33 секунды такого круга на каждой границе повтора.
    pub fn ended(&self) -> bool {
        is_ended(
            self.shared.drained.load(Ordering::Relaxed),
            self.shared.seek_to.lock().unwrap().is_some(),
            self.shared.pcm.lock().unwrap().is_empty(),
        )
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

/// Чем кончился один проход декодера.
enum Outcome {
    /// Движок остановлен — поток больше не нужен.
    Done,
    /// Читатель не смог перемотаться и должен быть построен заново. Запрос
    /// перемотки при этом ОСТАВЛЕН в `seek_to`: его исполнит свежий читатель.
    Rebuild {
        /// Успел ли ЭТОТ читатель отдать хоть один пакет. false означает, что
        /// он и был свежим — пересобирать второй раз бессмысленно.
        progressed: bool,
        why: String,
    },
}

/// Декод файла до конца: symphonia отдаёт кадры, мы приводим их к частоте и
/// числу каналов устройства и складываем в общий буфер.
fn decode_loop(
    mss: MediaSourceStream<'static>,
    hint: Hint,
    shared: &Arc<Shared>,
) -> Result<Outcome, String> {
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
    // Растяжение времени. Заводится только когда скорость реально не 1x: на
    // обычном прослушивании оно не должно ни стоить такта, ни добавлять
    // задержку, а окно разложения её неизбежно вносит.
    let mut stretcher: Option<signalsmith_stretch::Stretch> = None;
    // Какая высота уже донесена до вокодера (биты f32). None — вокодера нет
    // или его пересобрали: настройки родились заново и их надо донести снова.
    let mut applied_pitch: Option<u32> = None;
    // Второй характер темпа. Живёт рядом с вокодером и никогда не работает
    // одновременно с ним: у каждого куска ровно один обработчик.
    let mut wsola: Option<crate::wsola::Wsola> = None;
    // Отдал ли ЭТОТ читатель хоть один пакет: по нему внешний цикл отличает
    // «читатель износился, дай свежий» от «свежий тоже не смог».
    let mut progressed = false;
    // Перемотку только что применили, а пакета после неё ещё не было. Нужен,
    // чтобы поймать вторую разновидность отказа: `seek` ответил «хорошо», а
    // читатель остался на конце и сразу отдал конец файла.
    let mut just_sought: Option<f64> = None;

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
            // Вокодер настроен на прежнюю частоту и число каналов — собираем
            // заново вместе с ресемплером. Настройки высоты рождаются вместе с
            // ним по умолчанию, поэтому их придётся донести снова.
            stretcher = None;
            applied_pitch = None;
            wsola = None;
        }

        // Перемотка: сносим всё, что уже насчитано вперёд, иначе после прыжка
        // ещё полторы секунды играл бы старый кусок.
        let requested = shared.seek_to.lock().unwrap().take();
        if let Some(sec) = requested {
            let time = Time::from_millis_u64((sec * 1000.0) as u64);
            let target = SeekTo::Time { time, track_id: Some(track_id) };
            if let Err(e) = format.seek(SeekMode::Accurate, target) {
                // ⚠️ НЕ `eprintln!`. Именно здесь ломался повтор: у дочитанного
                // до конца webm перемотка невозможна в принципе, а причина
                // уходила в консоль, которой у собранного приложения нет.
                // Возвращаем запрос на место и просим свежий читатель — его
                // построит внешний цикл потока декодера.
                *shared.seek_to.lock().unwrap() = Some(sec);
                return Ok(Outcome::Rebuild { progressed, why: e.to_string() });
            }
            just_sought = Some(sec);
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
                // ⚠️ ФАЙЛ КОНЧИЛСЯ — НО ПОТОК ДЕКОДЕРА НЕ УМИРАЕТ (11.08.2026).
                //
                // Здесь стоял `break`, и это ломало повтор трека намертво
                // (жалоба владельца: «после репита трек мёртвый, как ни
                // пролистывай — играть не будет»). Разбор:
                //
                // Перемотка обслуживается В ГОЛОВЕ ЭТОГО ЖЕ ЦИКЛА — только
                // здешний поток владеет читателем. Выйдя по `break`, поток
                // умирал, и `seek()` дальше клал запрос в `seek_to`, который
                // ЧИТАТЬ УЖЕ БЫЛО НЕКОМУ. Буфер при этом чистился, `drained`
                // оставался true, и трек замолкал навсегда. А `frames_out`
                // сбрасывался в ноль и продолжал тикать из потока вывода —
                // отсюда «прогресс идёт, но звука нет».
                //
                // Оживал трек только новым `native_play` (новый поток) — ровно
                // то, что владелец описал как «нужно зайти и нажать на трек».
                //
                // Теперь поток паркуется и продолжает ждать перемотку, пока
                // движок жив. Пришла — `continue` уводит в голову цикла, где
                // seek-блок отматывает читатель и сбрасывает `drained`.
                //
                // ⚠️ Вторая разновидность отказа (12.08.2026): перемотка ответила
                // «хорошо», а читатель с конца не сошёл и сразу отдал конец файла
                // снова. Парковаться тут нельзя — это тишина навсегда; нужен
                // свежий читатель, как и при явном отказе seek выше.
                if let Some(sec) = just_sought {
                    *shared.seek_to.lock().unwrap() = Some(sec);
                    return Ok(Outcome::Rebuild {
                        progressed,
                        why: "перемотка не сдвинула читатель с конца файла".to_string(),
                    });
                }
                shared.drained.store(true, Ordering::Relaxed);
                while !shared.stop.load(Ordering::Relaxed)
                    && shared.seek_to.lock().unwrap().is_none()
                {
                    // 50 мс: перемотка после конца — жест руками, доли секунды
                    // здесь незаметны, а спящий поток не стоит процессору ничего.
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                continue;
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
        // Звук пошёл: читатель жив и перемотка (если была) действительно
        // сдвинула его — пересобирать нечего.
        progressed = true;
        just_sought = None;
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

        // Скорость с сохранением тона. Фазовый вокодер растягивает время и
        // заново сшивает фазы — удары не размазываются, высота не едет. Это
        // не пересчёт частоты: тот сдвинул бы тон, как у прежнего движка.
        let speed = f32::from_bits(shared.speed.load(Ordering::Relaxed));
        let pitch = f32::from_bits(shared.pitch.load(Ordering::Relaxed));
        let neutral = (speed - 1.0).abs() < 0.001 && pitch.abs() < 0.01;
        // ВЫБОР ХАРАКТЕРА ТЕМПА. WSOLA берётся только когда высота не тронута:
        // он по устройству не умеет двигать тон, и просить его об этом нечестно.
        // Тронули высоту — работает вокодер, он умеет и то и другое разом.
        let use_wsola = !neutral && pitch.abs() < 0.01 && shared.tempo_wsola.load(Ordering::Relaxed);
        let chunk = if neutral {
            stretcher = None;
            applied_pitch = None;
            wsola = None;
            chunk
        } else if use_wsola {
            stretcher = None;
            applied_pitch = None;
            let w = wsola.get_or_insert_with(|| crate::wsola::Wsola::new(out_channels, out_rate));
            w.set_speed(speed);
            // Пусто — обработчик копит вход до полного окна склейки. Это не
            // потеря: кадры выйдут со следующим пакетом.
            w.push(&chunk)
        } else {
            wsola = None;
            let stretch = stretcher.get_or_insert_with(|| {
                signalsmith_stretch::Stretch::preset_default(out_channels as u32, out_rate)
            });
            // Высоту доносим только на изменение: сеттеры дёргают внутренние
            // таблицы вокодера, а сюда мы заходим на КАЖДЫЙ пакет.
            if applied_pitch != Some(pitch.to_bits()) {
                if pitch.abs() < 0.01 {
                    // ⚠️ ВЫСОТУ НЕ ТРОГАЛИ — ЗНАЧИТ НЕ ТРОГАЕМ И ФОРМАНТЫ
                    // (11.08.2026, жалоба: «при замедлении голос роботизируется,
                    // появляется хрип, поёт как будто дед»).
                    //
                    // Это была моя же ошибка того же дня. Блок настройки стоял
                    // без разбора: на первом пакете applied_pitch пуст, условие
                    // истинно ВСЕГДА, и при чистом замедлении мы всё равно
                    // включали анализ формант. А он не бесплатный: библиотека
                    // оценивает спектральную огибающую голоса и накладывает её
                    // заново. Ошибка оценки слышна ровно так, как описал
                    // владелец — тембр «стареет» и появляется хрип. При нулевом
                    // сдвиге компенсировать нечего, и вся эта ступень — чистый
                    // вред.
                    //
                    // Сбрасываем в нейтраль явно, а не «просто не включаем»:
                    // вокодер живёт между пакетами, и настройка от прошлого
                    // ненулевого сдвига осталась бы висеть на нём.
                    stretch.set_transpose_factor(1.0, None);
                    stretch.set_formant_factor(1.0, false);
                } else {
                    // tonality_limit: выше этой частоты сдвиг не применяется, и
                    // «воздух» с шипящими остаётся на месте. Без предела
                    // сдвинутый вниз трек звучит глухо, а вверх — стеклянно;
                    // 8 кГц — рекомендация библиотеки для музыки и речи.
                    stretch.set_transpose_factor_semitones(pitch, Some(TONALITY_LIMIT_HZ));
                    // Здесь форманты УМЕСТНЫ: при подъёме тона голос без них
                    // становится бурундуком, при спуске — великаном. Именно это
                    // отличает «стретч» от «ускорения плёнки».
                    stretch.set_formant_factor(1.0, true);
                }
                applied_pitch = Some(pitch.to_bits());
            }
            let in_frames = chunk.len() / out_channels.max(1);
            // Быстрее — выходных кадров меньше: то же время звучит короче.
            let out_frames = ((in_frames as f32) / speed).round() as usize;
            let mut stretched = vec![0.0f32; out_frames * out_channels];
            stretch.process(&chunk, &mut stretched);
            stretched
        };

        // Ждём, пока в буфере освободится место: держать весь трек в памяти
        // незачем, а колбэк вывода не должен упереться в пустоту.
        loop {
            if shared.stop.load(Ordering::Relaxed) {
                return Ok(Outcome::Done);
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
    Ok(Outcome::Done)
}

/// Поток захвата голоса: слушает микрофон и раздаёт его тем маршрутам, где
/// подмешивание включено.
///
/// Голос идёт МИМО музыкальной цепи — эквалайзер и нормализация настроены под
/// музыку, пропускать через них речь незачем. И мимо основного выхода тоже:
/// человек не должен слышать сам себя в наушниках, голос нужен собеседникам
/// на том конце виртуального кабеля.
fn spawn_mic(shared: &Arc<Shared>, mic: Arc<Mic>) {
    let shared = Arc::clone(shared);
    std::thread::Builder::new()
        .name("muza-mic".into())
        .spawn(move || {
            let host = cpal::default_host();
            let device = match &mic.device_name {
                Some(name) => {
                    let wanted = name.to_lowercase();
                    host.input_devices().ok().and_then(|list| {
                        list.into_iter().find(|d| {
                            d.name()
                                .map(|n| {
                                    let n = n.to_lowercase();
                                    n.contains(&wanted) || wanted.contains(&n)
                                })
                                .unwrap_or(false)
                        })
                    })
                }
                None => host.default_input_device(),
            };
            let Some(device) = device else {
                eprintln!("[audio] микрофон не найден");
                return;
            };

            // Частоту берём выводную, чтобы не ресемплить голос отдельно;
            // число каналов — родное для микрофона, их мы сведём сами.
            let want_rate = shared.device_rate.load(Ordering::Relaxed);
            let config = device
                .supported_input_configs()
                .ok()
                .and_then(|mut list| {
                    list.find(|c| {
                        c.min_sample_rate().0 <= want_rate && want_rate <= c.max_sample_rate().0
                    })
                })
                .map(|c| c.with_sample_rate(cpal::SampleRate(want_rate)));
            let Some(config) = config else {
                eprintln!("[audio] микрофон не умеет {want_rate} Гц");
                return;
            };
            let in_channels = config.channels() as usize;
            let out_channels = shared.device_channels.load(Ordering::Relaxed) as usize;

            let cb_shared = Arc::clone(&shared);
            let cb_mic = Arc::clone(&mic);
            // Буфер переиспользуется между вызовами: колбэк захвата тоже
            // реального времени, аллокации в нём ни к чему.
            let mut frame: Vec<f32> = Vec::new();
            let stream = device.build_input_stream(
                &config.into(),
                move |input: &[f32], _: &cpal::InputCallbackInfo| {
                    let Ok(taps) = cb_shared.taps.try_lock() else {
                        return;
                    };
                    if taps.is_empty() {
                        return;
                    }
                    let gain = f32::from_bits(cb_mic.gain.load(Ordering::Relaxed));
                    frame.clear();
                    for chunk in input.chunks(in_channels.max(1)) {
                        // Микрофон почти всегда моно — сводим и раскладываем
                        // по всем каналам вывода.
                        let mono = chunk.iter().sum::<f32>() / in_channels.max(1) as f32;
                        for _ in 0..out_channels.max(1) {
                            frame.push(mono * gain);
                        }
                    }
                    for tap in taps.iter() {
                        if !tap.mix_mic.load(Ordering::Relaxed) {
                            continue;
                        }
                        if let Ok(mut buf) = tap.mic_pcm.try_lock() {
                            buf.extend(frame.iter().copied());
                            let cap = frame.len().max(1) * 8;
                            while buf.len() > cap {
                                buf.pop_front();
                            }
                        }
                    }
                },
                |e| eprintln!("[audio] поток микрофона: {e}"),
                None,
            );
            let Ok(stream) = stream else {
                eprintln!("[audio] микрофон не открылся");
                return;
            };
            if stream.play().is_err() {
                return;
            }
            while !mic.stop.load(Ordering::Relaxed) && !shared.stop.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        })
        .ok();
}

/// Поток одного дополнительного устройства: читает свой буфер и отдаёт его
/// в железо. Никакой обработки — сигнал пришёл уже готовым.
fn spawn_tap(shared: &Arc<Shared>, tap: Arc<Tap>) {
    let shared = Arc::clone(shared);
    std::thread::Builder::new()
        .name("muza-tap".into())
        .spawn(move || {
            let host = cpal::default_host();
            let Ok(devices) = host.output_devices() else {
                return;
            };
            // Имена в браузерном списке и в cpal не совпадают дословно —
            // сверяем по вхождению в любую сторону.
            let wanted = tap.device_name.to_lowercase();
            let device = devices.into_iter().find(|d| {
                d.name()
                    .map(|n| {
                        let n = n.to_lowercase();
                        n.contains(&wanted) || wanted.contains(&n)
                    })
                    .unwrap_or(false)
            });
            let Some(device) = device else {
                eprintln!("[audio] устройство «{}» не найдено", tap.device_name);
                return;
            };

            // Открываем ровно в формате основного вывода: сигнал приходит уже
            // в его частоте, и пересчитывать его второй раз незачем. Если
            // устройство такого не умеет — маршрут молча не заводится, звук
            // при этом продолжает идти в остальные.
            let want_rate = shared.device_rate.load(Ordering::Relaxed);
            let want_channels = shared.device_channels.load(Ordering::Relaxed) as u16;
            let config = device
                .supported_output_configs()
                .ok()
                .and_then(|mut list| {
                    list.find(|c| {
                        c.channels() == want_channels
                            && c.min_sample_rate().0 <= want_rate
                            && want_rate <= c.max_sample_rate().0
                    })
                })
                .map(|c| c.with_sample_rate(cpal::SampleRate(want_rate)));
            let Some(config) = config else {
                eprintln!(
                    "[audio] «{}» не умеет {want_rate} Гц / {want_channels} кан.",
                    tap.device_name
                );
                return;
            };

            let cb = Arc::clone(&tap);
            let stream = device.build_output_stream(
                &config.into(),
                move |out: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let gain = f32::from_bits(cb.gain.load(Ordering::Relaxed));
                    let Ok(mut buf) = cb.pcm.try_lock() else {
                        out.fill(0.0);
                        return;
                    };
                    let ready = out.len().min(buf.len());
                    for (slot, sample) in out.iter_mut().zip(buf.drain(..ready)) {
                        *slot = sample * gain;
                    }
                    drop(buf);
                    out[ready..].fill(0.0);

                    // Голос поверх музыки. Складываем, а не заменяем: в
                    // виртуальный кабель должно уйти и то, и другое —
                    // собеседники слышат человека вместе с треком.
                    if cb.mix_mic.load(Ordering::Relaxed) {
                        if let Ok(mut voice) = cb.mic_pcm.try_lock() {
                            let n = out.len().min(voice.len());
                            for (slot, sample) in out.iter_mut().zip(voice.drain(..n)) {
                                *slot += sample;
                            }
                        }
                    }
                    // Клип срезаем здесь же: музыка уже прошла лимитер, а
                    // голос идёт мимо него и вдвоём они могут выйти за единицу.
                    for slot in out.iter_mut() {
                        *slot = slot.clamp(-1.0, 1.0);
                    }
                },
                |e| eprintln!("[audio] поток устройства: {e}"),
                None,
            );
            let Ok(stream) = stream else {
                eprintln!("[audio] не открылось «{}»", tap.device_name);
                return;
            };
            if stream.play().is_err() {
                return;
            }
            while !tap.stop.load(Ordering::Relaxed) && !shared.stop.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        })
        .ok();
}

// ── Команды для фронта ───────────────────────────────────────────────
//
// Движок один на приложение: слот пока тоже один (второй придёт с кроссфейдом).
// Новый play глушит прежний через Drop — вывод останавливается сам.

static ENGINE: Mutex<Option<NativeAudio>> = Mutex::new(None);

/// Маршруты живут дольше движка: движок рождается вместе с треком, а «вывод на
/// устройства» человек настраивает один раз. Без этого маршруты слетали бы на
/// каждом переключении песни.
static ROUTES: Mutex<Vec<(String, f32, bool)>> = Mutex::new(Vec::new());
/// Настройка микрофона тоже переживает смену трека.
static MIC_CONFIG: Mutex<Option<(Option<String>, f32)>> = Mutex::new(None);
/// И скорость: человек выставил 1.25x — она обязана пережить следующую песню.
static SPEED: Mutex<f32> = Mutex::new(1.0);
/// Высота тона — по той же причине: движок живёт один трек, настройка — сессию.
static PITCH: Mutex<f32> = Mutex::new(0.0);
/// Характер темпа: false — вокодер, true — WSOLA. Тоже переживает смену трека.
static TEMPO_WSOLA: Mutex<bool> = Mutex::new(false);

#[derive(serde::Deserialize)]
pub struct NativeRoute {
    /// Подпись устройства из браузерного списка — по ней ищем устройство cpal.
    name: String,
    /// Громкость маршрута 0..1, независимая от ползунка приложения.
    volume: f32,
    /// Подмешивать ли в этот маршрут голос.
    mix_mic: bool,
}

/// Донести до только что рождённого движка всё, что человек настроил раньше:
/// движок живёт один трек, а настройки — всю сессию.
fn apply_saved_routing(audio: &NativeAudio) {
    audio.set_speed(*SPEED.lock().unwrap());
    audio.set_pitch(*PITCH.lock().unwrap());
    audio.set_tempo_mode(*TEMPO_WSOLA.lock().unwrap());
    audio.set_outputs(&ROUTES.lock().unwrap().clone());
    if let Some((name, gain)) = MIC_CONFIG.lock().unwrap().clone() {
        audio.set_mic(name, gain);
    }
}

/// Что плееру нужно знать каждый тик. Позиция и конец трека спрашиваются
/// вместе: фронт и так опрашивает позицию, отдельные события были бы лишним
/// каналом с собственными гонками.
#[derive(serde::Serialize)]
pub struct NativeStatus {
    position: f64,
    ended: bool,
    playing: bool,
    /// Причина, по которой звука не будет: формат не поддерживается, файл
    /// повреждён, поток оборвался. None — всё в порядке.
    ///
    /// ⚠️ Это поле — единственный канал, по которому «нативный путь умер»
    /// доезжает до фронта. Без него отказ выглядел как играющий трек с
    /// бегущей полоской и без звука (жалоба 12.08).
    error: Option<String>,
}

#[tauri::command]
pub fn native_play(path: String, volume: f32, crossfade_sec: f64) -> Result<(), String> {
    // Кроссфейд сделан двумя независимыми выводами, а не двумя слотами внутри
    // одного: WASAPI в общем режиме спокойно держит два клиента и сводит их
    // сам, а нам остаются встречные кривые громкости. Слот-микс своими руками
    // дал бы ровно тот же звук ценой второго декодера, второго буфера и
    // общего состояния между ними.
    let fade = crossfade_sec.max(0.0);
    let previous = ENGINE.lock().unwrap().take();

    if fade > 0.0 {
        if let Some(old) = previous {
            old.start_crossfade(false, fade);
            // Отпускаем уходящий, только когда кривая доработает: раньше —
            // оборвём его на полуслове, позже — он будет впустую держать
            // устройство. Запас в 100 мс на дорогу буфера до колонок.
            let hold_ms = (fade * 1000.0) as u64 + 100;
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(hold_ms));
                drop(old);
            });
        }
        let audio = NativeAudio::play(Path::new(&path), volume)?;
        audio.start_crossfade(true, fade);
        apply_saved_routing(&audio);
        *ENGINE.lock().unwrap() = Some(audio);
        return Ok(());
    }

    // Без кроссфейда: прежний трек всё равно гасим ПЛАВНО и только потом
    // сносим — обрыв потока на середине формы волны динамик отрабатывает
    // низкочастотным щелчком. Рампа громкости в колбэке сводит уровень за
    // один буфер, ждём чуть дольше, чтобы он успел выйти.
    // ⚠️ ПРОВЕРЯЕМ ДО ТОГО, КАК СНОСИТЬ ПРЕЖНИЙ. Раньше старый движок дропался
    // безусловно, и отказ нового (файла нет, формат чужой) оставлял ENGINE
    // пустым: `native_status` начинал отвечать `playing: false`, позиция
    // замирала — к одному видимому отказу добавлялся второй, невидимый.
    let audio = match NativeAudio::play(Path::new(&path), volume) {
        Ok(audio) => audio,
        Err(e) => {
            *ENGINE.lock().unwrap() = previous;
            return Err(e);
        }
    };
    if let Some(old) = previous {
        // Прежний трек гасим ПЛАВНО и только потом сносим — обрыв потока на
        // середине формы волны динамик отрабатывает низкочастотным щелчком.
        old.set_volume(0.0);
        std::thread::sleep(std::time::Duration::from_millis(30));
        drop(old);
    }
    apply_saved_routing(&audio);
    *ENGINE.lock().unwrap() = Some(audio);
    Ok(())
}

/// Играть ещё качающийся трек. Возвращает false, если живой закачки с таким
/// ключом нет — фронт тогда отдаёт трек прежнему движку, как раньше.
#[tauri::command]
pub fn native_play_stream(
    app: tauri::AppHandle,
    ns: String,
    id: String,
    volume: f32,
    crossfade_sec: f64,
) -> Result<bool, String> {
    let Some(live) = crate::engine::live_stream(&app, &ns, &id) else {
        return Ok(false);
    };
    let fade = crossfade_sec.max(0.0);
    let previous = ENGINE.lock().unwrap().take();
    if let Some(old) = previous {
        if fade > 0.0 {
            old.start_crossfade(false, fade);
            let hold_ms = (fade * 1000.0) as u64 + 100;
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(hold_ms));
                drop(old);
            });
        } else {
            old.set_volume(0.0);
            std::thread::sleep(std::time::Duration::from_millis(30));
            drop(old);
        }
    }
    let audio = NativeAudio::play_stream(live, volume)?;
    if fade > 0.0 {
        audio.start_crossfade(true, fade);
    }
    apply_saved_routing(&audio);
    *ENGINE.lock().unwrap() = Some(audio);
    Ok(true)
}

#[tauri::command]
pub fn native_set_speed(speed: f32) {
    *SPEED.lock().unwrap() = speed;
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_speed(speed);
    }
}

/// Высота тона в полутонах, НЕЗАВИСИМО от скорости («стретч»).
///
/// Пара к native_set_speed и живёт рядом с ней намеренно: вместе они и есть
/// то, что в FL Studio одной ручкой не выражается — время и высота развязаны.
#[tauri::command]
pub fn native_set_pitch(semitones: f32) {
    *PITCH.lock().unwrap() = semitones;
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_pitch(semitones);
    }
}

/// Характер растяжения темпа: true — WSOLA (держит удары), false — фазовый
/// вокодер (гладок на тянущемся). Два разных метода, а не «лучше/хуже» —
/// разбор в шапке src/wsola.rs.
#[tauri::command]
pub fn native_set_tempo_mode(wsola: bool) {
    *TEMPO_WSOLA.lock().unwrap() = wsola;
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_tempo_mode(wsola);
    }
}

#[tauri::command]
pub fn native_set_mic(name: Option<String>, gain: f32) {
    *MIC_CONFIG.lock().unwrap() = Some((name.clone(), gain));
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_mic(name, gain);
    }
}

/// ⚠️ ОТВЕЧАЕТ Result, А НЕ МОЛЧИТ (12.08.2026). Пауза и перемотка — команды
/// природы «получилось или нет»: на них опирается повтор трека, который при
/// неудачном рестарте обязан позвать самолечение. Пока они отвечали `()` на
/// пустой движок, фронт получал «успех» на команду, которую никто не исполнил,
/// и страховка повтора не срабатывала НИКОГДА — отказ доживал до сторожа
/// замершего звука, то есть до тридцатой секунды тишины.
#[tauri::command]
pub fn native_set_paused(paused: bool) -> Result<(), String> {
    match ENGINE.lock().unwrap().as_ref() {
        Some(audio) => {
            audio.set_paused(paused);
            Ok(())
        }
        None => Err("нативного движка нет".to_string()),
    }
}

/// Пара к native_set_paused — см. разбор там же.
#[tauri::command]
pub fn native_seek(sec: f64) -> Result<(), String> {
    match ENGINE.lock().unwrap().as_ref() {
        Some(audio) => {
            audio.seek(sec);
            Ok(())
        }
        None => Err("нативного движка нет".to_string()),
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
            error: audio.error(),
        },
        None => NativeStatus { position: 0.0, ended: false, playing: false, error: None },
    }
}

#[tauri::command]
pub fn native_set_outputs(routes: Vec<NativeRoute>) {
    let list: Vec<(String, f32, bool)> =
        routes.into_iter().map(|r| (r.name, r.volume, r.mix_mic)).collect();
    *ROUTES.lock().unwrap() = list.clone();
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_outputs(&list);
    }
}

#[tauri::command]
pub fn native_set_eq(on: bool, bands: Vec<f32>) {
    if let Some(audio) = ENGINE.lock().unwrap().as_ref() {
        audio.set_eq(on, &bands);
    }
}

/// Снимок для визуализатора: спектр и форма волны в тех же байтах, что отдавал
/// AnalyserNode — 1024 полосы и 2048 точек, 128 = ноль.
#[derive(serde::Serialize)]
pub struct NativeScope {
    freq: Vec<u8>,
    wave: Vec<u8>,
    /// Частота дискретизации вывода. Визуализатор раскладывает полосы по
    /// частотам и без неё промахнётся: у AnalyserNode она бралась из
    /// AudioContext, здесь её неоткуда взять, кроме как отсюда.
    rate: u32,
}

#[tauri::command]
pub fn native_scope() -> NativeScope {
    let empty = NativeScope {
        freq: vec![0; FFT_SIZE / 2],
        wave: vec![128; FFT_SIZE],
        rate: 48_000,
    };
    let guard = ENGINE.lock().unwrap();
    let Some(audio) = guard.as_ref() else {
        return empty;
    };
    let samples: Vec<f32> = {
        let scope = audio.shared.scope.lock().unwrap();
        if scope.len() < FFT_SIZE {
            return empty;
        }
        scope.iter().copied().collect()
    };

    // Форма волны: байты вокруг 128, как getByteTimeDomainData.
    let wave: Vec<u8> = samples
        .iter()
        .map(|s| (((s * 128.0) + 128.0).clamp(0.0, 255.0)) as u8)
        .collect();

    // Окно Блэкмана — им же окно накладывает AnalyserNode перед разложением.
    let mut buffer: Vec<rustfft::num_complex::Complex<f32>> = samples
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let x = i as f32 / (FFT_SIZE - 1) as f32;
            let w = 0.42 - 0.5 * (2.0 * std::f32::consts::PI * x).cos()
                + 0.08 * (4.0 * std::f32::consts::PI * x).cos();
            rustfft::num_complex::Complex::new(s * w, 0.0)
        })
        .collect();
    let mut planner = rustfft::FftPlanner::new();
    planner.plan_fft_forward(FFT_SIZE).process(&mut buffer);

    let bins = FFT_SIZE / 2;
    let mut prev = audio.shared.spectrum_prev.lock().unwrap();
    if prev.len() != bins {
        *prev = vec![MIN_DB; bins];
    }
    let freq: Vec<u8> = (0..bins)
        .map(|i| {
            let magnitude = buffer[i].norm() / bins as f32;
            let db = 20.0 * magnitude.max(1e-9).log10();
            // Сглаживание по времени: без него столбики дёргаются покадрово.
            prev[i] = SMOOTHING * prev[i] + (1.0 - SMOOTHING) * db;
            let normalized = (prev[i] - MIN_DB) / (MAX_DB - MIN_DB);
            (normalized.clamp(0.0, 1.0) * 255.0) as u8
        })
        .collect();
    NativeScope { freq, wave, rate: audio.shared.device_rate.load(Ordering::Relaxed) }
}

#[tauri::command]
pub fn native_stop() {
    *ENGINE.lock().unwrap() = None; // Drop останавливает вывод и декодер
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Seek, SeekFrom, Write};

    /// Регресс 12.08: конец трека не объявляется поверх заказанной перемотки.
    ///
    /// Живой замер границы повтора: `HybridAudioEngine.seek` снимает защёлку
    /// `endedSent` синхронно, а `drained` гаснет только когда до запроса дойдёт
    /// поток декодера. Пока в этом окне `ended()` отвечал «да», опрос (4 раза в
    /// секунду) слал границу ещё раз, та — ещё одну перемотку, и позиция
    /// топталась около нуля все тридцать секунд до сторожа.
    #[test]
    fn seek_request_suppresses_end_of_track() {
        // Обычный конец: декодер дочитал, буфер пуст, перемотки не заказано.
        assert!(is_ended(true, false, true));
        // Ровно тот же конец, но перемотка уже заказана — трек не «кончился»,
        // он сейчас поедет с новой точки.
        assert!(!is_ended(true, true, true));
        // Буфер ещё звучит — конец объявлять рано (это условие было и раньше).
        assert!(!is_ended(true, false, false));
        // Декодер до конца не дошёл — конца нет ни при каких перемотках.
        assert!(!is_ended(false, false, true));
    }

    /// Равномощность кроссфейда: сумма квадратов встречных кривых обязана
    /// держаться около единицы. Линейные кривые дают в середине провал −3 дБ —
    /// именно он слышится «дырой» между треками.
    #[test]
    fn crossfade_keeps_power_constant() {
        let len = 1000u64;
        for pos in (0..=len).step_by(50) {
            let fade_in = xfade_gain(pos, len, true);
            let fade_out = xfade_gain(pos, len, false);
            let power = fade_in * fade_in + fade_out * fade_out;
            assert!(
                (power - 1.0).abs() < 0.001,
                "на {pos}/{len} мощность {power}, а должна быть около 1"
            );
        }
    }

    /// Границы: приходящий начинается с тишины и доходит до полной громкости,
    /// уходящий — наоборот. Перепутанные концы дали бы щелчок на стыке.
    #[test]
    fn crossfade_endpoints_are_exact() {
        assert!(xfade_gain(0, 100, true).abs() < 0.001);
        assert!((xfade_gain(100, 100, true) - 1.0).abs() < 0.001);
        assert!((xfade_gain(0, 100, false) - 1.0).abs() < 0.001);
        assert!(xfade_gain(100, 100, false).abs() < 0.001);
        // Нулевая длина — фейда нет вовсе, звук идёт как есть.
        assert!((xfade_gain(0, 0, true) - 1.0).abs() < 0.001);
    }

    /// Ресемплер обязан отдавать примерно столько кадров, сколько требует
    /// соотношение частот: ошибка здесь звучит как неверная скорость трека.
    #[test]
    fn resampler_output_matches_ratio() {
        let mut resampler = Resampler::new(44100, 48000, 2).expect("ресемплер не собрался");
        let frames_in = 44100; // ровно секунда источника
        let input: Vec<f32> = (0..frames_in * 2).map(|i| (i as f32 * 0.001).sin()).collect();
        let out = resampler.push(&input);
        let frames_out = out.len() / 2;
        // Допуск — на кадры, оставшиеся во внутреннем окне ресемплера.
        assert!(
            (frames_out as i64 - 48000).abs() < 2048,
            "на секунду 44.1 кГц получили {frames_out} кадров вместо ~48000"
        );
    }

    fn temp_file(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("muza-test-{name}"));
        path
    }

    /// Растущий файл: читаем записанное, у границы ЖДЁМ новых байт вместо
    /// конца файла. Без ожидания декодер решил бы, что трек кончился на первой
    /// же секунде.
    #[test]
    fn growing_source_waits_for_more_bytes() {
        let part = temp_file("growing.part");
        let final_path = temp_file("growing.webm");
        let mut file = File::create(&part).expect("файл не создался");
        file.write_all(&[1u8; 16]).unwrap();
        file.flush().unwrap();

        let (live, writer) = crate::engine::live_stream_for_test(part.clone(), final_path);
        writer.wrote(16);
        let mut source = GrowingSource::open(live).expect("источник не открылся");

        let mut buf = [0u8; 16];
        assert_eq!(source.read(&mut buf).unwrap(), 16, "первые байты не прочитались");

        // Дописываем из другого потока — чтение обязано разблокироваться само.
        let writer_thread = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(60));
            let mut more = std::fs::OpenOptions::new().append(true).open(&part).unwrap();
            more.write_all(&[2u8; 8]).unwrap();
            more.flush().unwrap();
            writer.finish(24);
        });

        let mut tail = [0u8; 8];
        let read = source.read(&mut tail).unwrap();
        writer_thread.join().unwrap();
        assert_eq!(read, 8, "дописанные байты не дождались");
        assert_eq!(tail, [2u8; 8], "прочитали не то, что дописали");

        // Файл закончен — дальше честный конец, а не вечное ожидание.
        assert_eq!(source.read(&mut tail).unwrap(), 0, "после завершения должен быть конец");
    }

    /// Сорванная закачка не должна подвешивать декодер навсегда.
    #[test]
    fn growing_source_gives_up_when_download_fails() {
        let part = temp_file("failed.part");
        File::create(&part).unwrap().write_all(&[7u8; 4]).unwrap();
        let (live, writer) = crate::engine::live_stream_for_test(part, temp_file("failed.webm"));
        writer.wrote(4);
        let mut source = GrowingSource::open(live).unwrap();

        let mut buf = [0u8; 4];
        assert_eq!(source.read(&mut buf).unwrap(), 4);
        writer.fail();
        assert!(source.read(&mut buf).is_err(), "после срыва ожидался отказ, а не зависание");
    }

    /// Перемотка внутри уже скачанного куска не должна ничего ждать.
    #[test]
    fn growing_source_seeks_inside_written_part() {
        let part = temp_file("seek.part");
        File::create(&part).unwrap().write_all(&[0, 1, 2, 3, 4, 5, 6, 7]).unwrap();
        let (live, writer) = crate::engine::live_stream_for_test(part, temp_file("seek.webm"));
        writer.finish(8);
        let mut source = GrowingSource::open(live).unwrap();

        source.seek(SeekFrom::Start(4)).unwrap();
        let mut buf = [0u8; 4];
        source.read_exact(&mut buf).unwrap();
        assert_eq!(buf, [4, 5, 6, 7], "перемотка привела не туда");
    }
}

/// Источник поверх ЕЩЁ КАЧАЮЩЕГОСЯ файла.
///
/// Трек, которого нет в кэше, начинает играть с первых килобайт: закачка пишет
/// `.part`, а мы читаем его следом. Дошли до конца записанного — ждём, пока
/// придут новые байты, вместо того чтобы объявлять конец файла. Без этого
/// декодер решил бы, что трек кончился на первой же секунде.
struct GrowingSource {
    file: File,
    pos: u64,
    live: crate::engine::LiveStream,
}

impl GrowingSource {
    fn open(live: crate::engine::LiveStream) -> Result<Self, String> {
        let mut opts = std::fs::OpenOptions::new();
        opts.read(true);
        // ⚠️ Windows: без разрешения на удаление наш открытый дескриптор не даст
        // закачке переименовать .part в готовый файл, и она сорвётся на самом
        // финише. С этим флагом rename проходит, а дескриптор остаётся живым.
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            opts.share_mode(0x7); // READ | WRITE | DELETE
        }
        let file = opts
            .open(&live.part)
            .or_else(|_| opts.open(&live.final_path))
            .map_err(|e| format!("открыть растущий файл: {e}"))?;
        Ok(Self { file, pos: 0, live })
    }

    /// Дождаться, пока на диске окажется байт `offset`. Возвращает false, если
    /// ждать больше нечего: файл дописан или закачка сорвалась.
    fn wait_for(&self, offset: u64) -> bool {
        loop {
            if self.live.written() > offset {
                return true;
            }
            if self.live.finalized() || self.live.failed() {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}

impl std::io::Read for GrowingSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if !self.wait_for(self.pos) && !self.live.finalized() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "закачка сорвалась",
            ));
        }
        // Не заглядываем дальше записанного: за границей лежит не тишина, а
        // ничто, и декодер принял бы это за конец потока.
        let available = self.live.written().saturating_sub(self.pos) as usize;
        let want = if self.live.finalized() {
            buf.len()
        } else {
            buf.len().min(available)
        };
        if want == 0 {
            return Ok(0);
        }
        let read = self.file.read(&mut buf[..want])?;
        self.pos += read as u64;
        Ok(read)
    }
}

impl std::io::Seek for GrowingSource {
    fn seek(&mut self, from: std::io::SeekFrom) -> std::io::Result<u64> {
        // Перемотка вперёд по ещё не скачанному — ждём, пока байты приедут.
        if let std::io::SeekFrom::Start(target) = from {
            self.wait_for(target);
        }
        self.pos = self.file.seek(from)?;
        Ok(self.pos)
    }
}

impl symphonia::core::io::MediaSource for GrowingSource {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        let total = self.live.total();
        // Пока размер неизвестен, честнее сказать «не знаю»: соврав, мы
        // заставили бы демуксер искать конец там, где его ещё нет.
        if total > 0 {
            Some(total)
        } else {
            None
        }
    }
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
