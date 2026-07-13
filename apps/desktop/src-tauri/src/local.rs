// Локальные файлы (Stage 4): device-bound треки из файлов пользователя.
// Файл никуда не загружается — на сервер уходят только теги и sha256-хэш
// (идентичность файла между устройствами). Реестр hash→путь живёт в
// app_data/local-tracks.json; asset-scope расширяется в рантайме, чтобы
// WebView мог играть файлы вне app_data.

use lofty::prelude::*;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Запись реестра: всё, что нужно, чтобы показать и сыграть локальный трек.
#[derive(Clone, Serialize, Deserialize)]
pub struct LocalEntry {
    pub hash: String,
    pub path: String,
    pub artist: String,
    pub title: String,
    pub duration_sec: u32,
}

/// Ответ сканера: запись + жив ли файл прямо сейчас.
#[derive(Serialize)]
pub struct LocalEntryOut {
    #[serde(flatten)]
    pub entry: LocalEntry,
    pub available: bool,
}

#[derive(Default)]
pub struct LocalState {
    entries: Mutex<Vec<LocalEntry>>,
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("нет app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("не создался app_data: {e}"))?;
    Ok(dir.join("local-tracks.json"))
}

fn persist(app: &AppHandle, entries: &[LocalEntry]) {
    if let Ok(path) = registry_path(app) {
        if let Ok(raw) = serde_json::to_string_pretty(entries) {
            let _ = fs::write(path, raw);
        }
    }
}

/// На старте: поднять реестр и открыть asset-scope для живых файлов
/// (scope не персистится между запусками — открываем заново).
pub fn init(app: &AppHandle) {
    let Ok(path) = registry_path(app) else { return };
    let Ok(raw) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(entries) = serde_json::from_str::<Vec<LocalEntry>>(&raw) else {
        return;
    };
    for entry in &entries {
        let p = Path::new(&entry.path);
        if p.exists() {
            let _ = app.asset_protocol_scope().allow_file(p);
        }
    }
    let state = app.state::<LocalState>();
    *state.entries.lock().unwrap() = entries;
}

/// sha256 файла потоково (файлы бывают и по сотне МБ — не в память целиком).
fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("файл не открылся: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("файл не читается: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    // sha2 0.11: у digest-массива нет LowerHex — кодируем сами
    let mut hex = String::with_capacity(64);
    for byte in hasher.finalize() {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok(hex)
}

/// Расширения, которые пытаемся читать как аудио.
const AUDIO_EXT: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma", "aiff", "ape", "webm",
];

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXT.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Теги + длительность через lofty; без тегов — имя файла вместо названия.
fn scan_one(path: &Path) -> Result<LocalEntry, String> {
    let tagged = Probe::open(path)
        .map_err(|e| format!("не открылся: {e}"))?
        .read()
        .map_err(|e| format!("не читается как аудио: {e}"))?;
    let duration_sec = tagged.properties().duration().as_secs() as u32;
    if duration_sec == 0 {
        return Err("нулевая длительность".into());
    }
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Без названия".into());
    // Часто имя файла — «Артист - Название»: используем как фолбэк без тегов
    let (stem_artist, stem_title) = match stem.split_once(" - ") {
        Some((a, t)) if !a.trim().is_empty() && !t.trim().is_empty() => {
            (Some(a.trim().to_string()), t.trim().to_string())
        }
        _ => (None, stem.clone()),
    };
    let title = tag
        .and_then(|t| t.title().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or(stem_title);
    let artist = tag
        .and_then(|t| t.artist().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .or(stem_artist)
        .unwrap_or_else(|| "Неизвестный артист".into());
    Ok(LocalEntry {
        hash: hash_file(path)?,
        path: path.to_string_lossy().into_owned(),
        artist,
        title,
        duration_sec,
    })
}

/// Просканировать выбранные файлы/папки: теги, хэш, реестр, asset-scope.
/// Папки обходятся на один уровень вглубь без рекурсии в подпапки подпапок
/// (защита от «выбрал весь диск»): вложенность 2 уровня покрывает
/// «Артист/Альбом/трек.mp3».
#[tauri::command]
pub async fn local_scan(
    app: AppHandle,
    state: State<'_, LocalState>,
    paths: Vec<String>,
) -> Result<Vec<LocalEntryOut>, String> {
    // Сканирование (хэши больших файлов) — не на async-потоке Tauri
    let files: Vec<PathBuf> = tauri::async_runtime::spawn_blocking(move || {
        let mut files: Vec<PathBuf> = Vec::new();
        for raw in paths {
            let path = PathBuf::from(&raw);
            if path.is_dir() {
                collect_audio(&path, 2, &mut files);
            } else if is_audio(&path) {
                files.push(path);
            }
        }
        files
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?;

    let scanned: Vec<LocalEntry> = tauri::async_runtime::spawn_blocking(move || {
        files.iter().filter_map(|p| scan_one(p).ok()).collect()
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?;

    let mut out: Vec<LocalEntryOut> = Vec::new();
    {
        let mut entries = state.entries.lock().unwrap();
        for entry in scanned {
            let _ = app
                .asset_protocol_scope()
                .allow_file(Path::new(&entry.path));
            // тот же файл (hash) — обновляем путь/теги, не плодим дубли
            if let Some(existing) = entries.iter_mut().find(|e| e.hash == entry.hash) {
                *existing = entry.clone();
            } else {
                entries.push(entry.clone());
            }
            out.push(LocalEntryOut {
                entry,
                available: true,
            });
        }
        persist(&app, &entries);
    }
    Ok(out)
}

fn collect_audio(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_audio(&path, depth - 1, out);
        } else if is_audio(&path) {
            out.push(path);
        }
    }
}

/// Реестр целиком (для вкладки «Локальные»): available = файл на месте.
#[tauri::command]
pub fn local_list(state: State<'_, LocalState>) -> Vec<LocalEntryOut> {
    state
        .entries
        .lock()
        .unwrap()
        .iter()
        .map(|e| LocalEntryOut {
            entry: e.clone(),
            available: Path::new(&e.path).exists(),
        })
        .collect()
}

/// Путь к файлу по хэшу — для воспроизведения. None — файла на устройстве нет.
#[tauri::command]
pub fn local_resolve(app: AppHandle, state: State<'_, LocalState>, hash: String) -> Option<String> {
    let entries = state.entries.lock().unwrap();
    let entry = entries.iter().find(|e| e.hash == hash)?;
    let path = Path::new(&entry.path);
    if !path.exists() {
        return None;
    }
    let _ = app.asset_protocol_scope().allow_file(path);
    Some(entry.path.clone())
}

/// Убрать запись из реестра (файл на диске не трогаем — он пользовательский).
#[tauri::command]
pub fn local_forget(
    app: AppHandle,
    state: State<'_, LocalState>,
    hash: String,
) -> Result<(), String> {
    let mut entries = state.entries.lock().unwrap();
    entries.retain(|e| e.hash != hash);
    persist(&app, &entries);
    Ok(())
}
