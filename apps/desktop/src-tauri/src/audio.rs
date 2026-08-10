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
//! ⚠️ Ресемплинг здесь линейный, временный. WASAPI в общем режиме держит
//! частоту миксера (обычно 48 кГц), а mp3 в кэше — 44.1 кГц, без пересчёта
//! музыка играла бы быстрее. Линейная интерполяция даёт слышимые артефакты на
//! верхах — заменить на rubato вместе с задачей 2.

use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use symphonia::core::audio::GenericAudioBufferRef;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// Сколько секунд звука держим готовыми. Меньше — риск подхрипываний на
/// загруженной машине, больше — задержка реакции на паузу и перемотку.
const BUFFER_SECONDS: f32 = 1.5;

struct Shared {
    /// Готовые к выводу сэмплы, уже в частоте и каналах устройства.
    pcm: Mutex<VecDeque<f32>>,
    paused: AtomicBool,
    stop: AtomicBool,
    /// Сколько кадров отдано устройству — из этого считается позиция.
    frames_out: AtomicU64,
    device_rate: u32,
    device_channels: u16,
}

pub struct NativeAudio {
    shared: Arc<Shared>,
}

impl NativeAudio {
    /// Открыть устройство вывода и начать проигрывать файл.
    pub fn play(path: &Path) -> Result<Self, String> {
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
            device_rate: config.sample_rate().0,
            device_channels: config.channels(),
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
        let stream_shared = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("muza-output".into())
            .spawn(move || {
                // Отдельный клон для колбэка: он забирает владение, а самому
                // потоку ссылка нужна дальше — держать стрим живым.
                let cb = Arc::clone(&stream_shared);
                let stream = device.build_output_stream(
                    &config.into(),
                    move |out: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        let paused = cb.paused.load(Ordering::Relaxed);
                        let mut pcm = cb.pcm.lock().unwrap();
                        for slot in out.iter_mut() {
                            *slot = if paused { 0.0 } else { pcm.pop_front().unwrap_or(0.0) };
                        }
                        if !paused {
                            let frames = out.len() as u64 / cb.device_channels.max(1) as u64;
                            cb.frames_out.fetch_add(frames, Ordering::Relaxed);
                        }
                    },
                    |e| eprintln!("[audio] поток вывода: {e}"),
                    None,
                );
                match stream {
                    Ok(stream) => {
                        if let Err(e) = stream.play() {
                            eprintln!("[audio] старт вывода: {e}");
                            return;
                        }
                        // Держим стрим живым, пока не попросят остановиться.
                        while !stream_shared.stop.load(Ordering::Relaxed) {
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                    }
                    Err(e) => eprintln!("[audio] не открылся вывод: {e}"),
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
        frames / self.shared.device_rate.max(1) as f64
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

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
        .map_err(|e| format!("кодек не поддержан: {e}"))?;

    let out_rate = shared.device_rate as f32;
    let out_channels = shared.device_channels as usize;
    let capacity = (out_rate * BUFFER_SECONDS) as usize * out_channels;
    // Дробный остаток шага ресемплинга между пакетами — иначе на стыках
    // накапливался бы сдвиг и раз в несколько секунд щёлкало.
    let mut resample_pos = 0f32;

    while !shared.stop.load(Ordering::Relaxed) {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break, // файл кончился
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
        let step = in_rate as f32 / out_rate;
        let in_frames = samples.len() / in_channels.max(1);

        let mut chunk: Vec<f32> = Vec::new();
        while resample_pos < in_frames as f32 {
            let idx = resample_pos as usize;
            for ch in 0..out_channels {
                // Моно в стерео — тем же сэмплом в оба уха; лишние каналы
                // источника отбрасываем (сведение придёт с задачей 2).
                let src_ch = if in_channels == 1 { 0 } else { ch.min(in_channels - 1) };
                chunk.push(samples[idx * in_channels + src_ch]);
            }
            resample_pos += step;
        }
        resample_pos -= in_frames as f32;

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
