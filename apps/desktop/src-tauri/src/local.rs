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

/// Итог одного скана. Считает не только удачи: без `found` и `truncated`
/// «папка пустая», «все файлы чужого формата» и «файлов слишком много»
/// приходили на фронт одинаковым пустым массивом.
#[derive(Serialize)]
pub struct LocalScanOut {
    pub entries: Vec<LocalEntryOut>,
    /// Сколько файлов с подходящим расширением нашёл ОБХОД — до чтения тегов.
    /// Больше длины `entries` = столько-то файлов не открылись как аудио.
    pub found: usize,
    /// Обход упёрся в потолок: в папке есть ещё, показанное — не всё.
    pub truncated: bool,
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
///
/// ⚠️ СПИСОК ОБЯЗАН СОВПАДАТЬ С ФИЧАМИ symphonia в Cargo.toml. Теги читает
/// lofty, ей фичи движка не нужны — поэтому файл неподдерживаемого формата
/// спокойно попадал в реестр и потом МОЛЧА не играл. До 12.08 здесь стояли
/// `wma` и `ape`, которых symphonia не декодирует вовсе (её фича `ape` — это
/// чтение тегов APEv2, а не звук), а `aiff` и ALAC внутри `m4a` не были
/// включены на стороне движка. Первое убрано, второе включено.
/// Зеркало на фронте — фильтр диалога в apps/desktop/src/lib/localFiles.ts.
const AUDIO_EXT: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "aiff", "aif", "webm", "mka",
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
///
/// Папки обходятся вглубь на SCAN_MAX_DEPTH уровней, с пропуском скрытых и
/// служебных каталогов и без хождения по символическим ссылкам. Работу
/// ограничивает потолок файлов, а не глубина (см. SCAN_MAX_DEPTH).
///
/// ⚠️ Ответ РАЗЛИЧАЕТ три исхода, и это не украшение: «нашли и разобрали»,
/// «нашли, но не всё» (`truncated`) и «нашли файлы, но ни один не читается»
/// (`found > 0`, `entries` пуст — битые файлы или чужой формат). Раньше все три
/// приходили одинаковым пустым массивом, и человек видел один и тот же тост
/// «в папке не нашлось аудиофайлов».
#[tauri::command]
pub async fn local_scan(
    app: AppHandle,
    state: State<'_, LocalState>,
    paths: Vec<String>,
) -> Result<LocalScanOut, String> {
    // Сканирование (хэши больших файлов) — не на async-потоке Tauri
    let (files, truncated): (Vec<PathBuf>, bool) =
        tauri::async_runtime::spawn_blocking(move || {
            let mut files: Vec<PathBuf> = Vec::new();
            let mut truncated = false;
            for raw in paths {
                let path = PathBuf::from(&raw);
                if path.is_dir() {
                    truncated |= collect_audio(&path, SCAN_MAX_DEPTH, SCAN_FILE_CAP, &mut files);
                } else if is_audio(&path) {
                    files.push(path);
                }
            }
            (files, truncated)
        })
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))?;

    let found = files.len();
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
    Ok(LocalScanOut {
        entries: out,
        found,
        truncated,
    })
}

/// Глубина обхода папки.
///
/// ⚠️ ДО 12.08 ЗДЕСЬ СТОЯЛО 2, и это был главный дефект локальной библиотеки.
/// Два уровня находят файл только в `папка/*.mp3` и `папка/подпапка/*.mp3`.
/// Люди выбирают КОРЕНЬ медиатеки, а там `Музыка/Артист/Альбом/трек.mp3` —
/// третий уровень, до которого рекурсия не доходила. Результат: ноль файлов и
/// тост «в папке не нашлось аудиофайлов», снаружи неотличимый от «каталог
/// вообще нельзя выбрать» (жалоба 12.08).
///
/// Восьми уровней хватает и на `Музыка/Жанр/Артист/Альбом/CD1/трек.mp3`.
/// Защиту от «выбрал весь диск» теперь несёт не глубина, а потолок файлов
/// ниже — он честнее: ограничивает работу, а не область поиска.
const SCAN_MAX_DEPTH: u32 = 8;

/// Потолок файлов за один скан. Дальше каждый файл платится sha256 по всему
/// содержимому (hash_file), а прогресса у скана нет — без потолка выбор корня
/// диска выглядит как намертво зависшее приложение. Упёрлись — говорим об
/// этом вслух (LocalScanOut::truncated), а не молча обрезаем.
const SCAN_FILE_CAP: usize = 50_000;

/// Папки, в которые ходить незачем: служебные каталоги системы и мусор
/// сборщиков. Музыки там не бывает, а времени обход стоит.
fn skip_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return true; // имя не читается — безопаснее не ходить
    };
    // Точка в начале — скрытая папка на всех системах (.git, .cache, .Trash)
    name.starts_with('.')
        || matches!(
            name,
            "$RECYCLE.BIN" | "System Volume Information" | "node_modules" | "__MACOSX"
        )
}

/// Обход папки вглубь. Возвращает true, если упёрлись в потолок файлов —
/// тогда найденное НЕ ПОЛНОЕ и вызывающий обязан об этом сказать.
///
/// `cap` параметром, а не константой, ради тестов: проверять потолок на
/// настоящих 50 000 файлов — это создать 50 000 файлов.
fn collect_audio(dir: &Path, depth: u32, cap: usize, out: &mut Vec<PathBuf>) -> bool {
    if depth == 0 || out.len() >= cap {
        return out.len() >= cap;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return false; // нет прав на папку — не повод ронять весь скан
    };
    let mut truncated = false;
    for entry in entries.flatten() {
        if out.len() >= cap {
            return true;
        }
        // file_type() читает саму запись каталога и НЕ разыменовывает ссылку —
        // в отличие от path.is_dir(). Иначе симлинк на родителя закольцевал бы
        // обход, а «Мои документы» на сетевой диск подвесил бы его на минуты.
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            if skip_dir(&path) {
                continue;
            }
            truncated |= collect_audio(&path, depth - 1, cap, out);
        } else if is_audio(&path) {
            out.push(path);
        }
    }
    truncated
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Своя папка на прогон: тесты идут параллельно, общий каталог они бы
    /// затирали друг у друга.
    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("muza-local-scan-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"not really audio").unwrap();
    }

    /// РЕГРЕСС ЖАЛОБЫ 12.08 «невозможно даже выбрать каталог». Человек выбирает
    /// КОРЕНЬ медиатеки, а трек лежит на третьем уровне — при старой глубине 2
    /// обход возвращал ноль файлов, и интерфейс говорил «в папке не нашлось
    /// аудиофайлов». Проверяем именно тот случай, который был сломан.
    #[test]
    fn scans_music_root_three_levels_deep() {
        let root = temp_root("depth");
        touch(&root.join("Артист").join("Альбом").join("трек.mp3"));
        touch(&root.join("Жанр").join("Артист").join("Альбом").join("CD1").join("трек.flac"));

        let mut found = Vec::new();
        let truncated = collect_audio(&root, SCAN_MAX_DEPTH, SCAN_FILE_CAP, &mut found);

        assert!(!truncated, "два файла не могли упереться в потолок");
        assert_eq!(found.len(), 2, "оба трека обязаны найтись: {found:?}");

        // И контрольный выстрел: со старой глубиной 2 первый файл ещё виден,
        // а второй — уже нет. Так что тест выше проверяет РЕАЛЬНУЮ разницу.
        let mut shallow = Vec::new();
        collect_audio(&root, 2, SCAN_FILE_CAP, &mut shallow);
        assert_eq!(shallow.len(), 0, "глубина 2 не достаёт ни до одного из них");

        let _ = fs::remove_dir_all(&root);
    }

    /// Потолок обязан не просто обрезать, а СКАЗАТЬ, что обрезал.
    #[test]
    fn reports_truncation_when_cap_is_hit() {
        let root = temp_root("cap");
        for i in 0..10 {
            touch(&root.join(format!("трек-{i}.mp3")));
        }

        let mut found = Vec::new();
        let truncated = collect_audio(&root, SCAN_MAX_DEPTH, 4, &mut found);

        assert!(truncated, "упёрлись в потолок — обязаны об этом сообщить");
        assert_eq!(found.len(), 4, "больше потолка не берём");

        let _ = fs::remove_dir_all(&root);
    }

    /// Скрытые и служебные папки обходить незачем: музыки там нет, а время
    /// они стоят (у .git на большом репозитории — десятки тысяч файлов).
    #[test]
    fn skips_hidden_and_service_dirs() {
        let root = temp_root("skip");
        touch(&root.join("Альбом").join("нужный.mp3"));
        touch(&root.join(".cache").join("лишний.mp3"));
        touch(&root.join("node_modules").join("лишний.mp3"));

        let mut found = Vec::new();
        collect_audio(&root, SCAN_MAX_DEPTH, SCAN_FILE_CAP, &mut found);

        assert_eq!(found.len(), 1, "взять надо только «нужный.mp3»: {found:?}");
        assert!(found[0].ends_with("нужный.mp3"));

        let _ = fs::remove_dir_all(&root);
    }

    /// Форматы из AUDIO_EXT и фичи symphonia обязаны сходиться. Тест —
    /// напоминание тому, кто добавит расширение и забудет про Cargo.toml:
    /// wma и ape symphonia не декодирует, и место им не здесь.
    #[test]
    fn audio_ext_has_no_undecodable_formats() {
        for ext in ["wma", "ape"] {
            assert!(
                !AUDIO_EXT.contains(&ext),
                "{ext} нечем декодировать — файл добавится в реестр и будет молчать"
            );
        }
        assert!(AUDIO_EXT.contains(&"aiff"), "фича aiff включена — расширение должно быть");
    }
}
