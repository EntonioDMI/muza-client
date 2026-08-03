// Шеринг-карточки (Stage 7): фронт рисует PNG на canvas, Rust пишет байты
// в путь из системного save-диалога (plugin-dialog). WebView-скачивания
// в Tauri ненадёжны — простая команда честнее.
//
// ⚠️ Аудит 2026-08: «путь пришёл из диалога» — НЕ гарантия, а привычка фронта.
// Диалог открывает JS (@tauri-apps/plugin-dialog), Rust его результат ничем
// не подписывает — команда видит просто строку. А в главном окне по дизайну
// исполняется ЧУЖОЙ код: плагин уровня 2 (plugins::run_full_access_plugin →
// main_window.eval), которому `invoke` доступен напрямую. Поэтому путь
// проверяется ПО СУЩЕСТВУ (check_share_path): запрещены расширения, которые
// система исполняет сама, и каталоги, где запись означает автозапуск или
// подмену настроек — включая AppData самой Музы (installed.json плагинов:
// запись туда выдала бы плагину «полный доступ» без единого вопроса).
// Полноценный гейт — одноразовый токен на путь, выданный при ОТКРЫТИИ
// диалога из Rust; он требует правки фронта и отложен сознательно.

use base64::Engine as _;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Расширения, которые Windows подхватывает САМА — двойным кликом, автозапуском
/// или загрузкой в чужой процесс. Записать такой файл — это уже не «сохранить
/// картинку»: .lnk/.url в автозагрузке, .dll рядом с чужим exe (hijack), .reg
/// в один клик правит реестр. Список — по смыслу «исполняется без явного
/// запуска пользователем», а не по формату файла.
const DANGEROUS_EXT: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "msi", "msp", "msc", "cpl", "dll", "sys", "drv", "ocx", "jar", "lnk", "url",
    "hta", "chm", "reg", "inf", "scf", "sh", "py", "pyw", "appx", "msix", "gadget", "application",
];

/// Имена, опасные независимо от расширения: проводник читает их из каталога
/// сам (оформление папки/автозапуск носителя).
const DANGEROUS_NAMES: &[&str] = &["desktop.ini", "autorun.inf", "ntuser.dat"];

/// Имя файла в том виде, в каком его СОЗДАСТ Windows: хвостовые точки и
/// пробелы отбрасываются файловой системой, т.е. `evil.exe. ` на диске станет
/// `evil.exe`. Нормализуем ДО разбора расширения — иначе весь список выше
/// обходится одной лишней точкой в конце.
fn normalized_file_name(path: &Path) -> Option<String> {
    let raw = path.file_name()?.to_string_lossy().to_string();
    let trimmed = raw.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_ascii_lowercase())
}

/// Проверка пути по существу. Возвращает путь, по которому МОЖНО писать
/// (каталог канонизирован — раскрыты `..`, симлинки, 8.3-имена; писать надо
/// именно по нему, чтобы между проверкой и записью путь не «переехал»).
/// `denied_roots` инъецируются вызывающим — так функция тестируется без
/// AppHandle и без зависимости от реального окружения машины.
fn check_share_path(path: &Path, denied_roots: &[PathBuf]) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("bad_args: путь обязан быть абсолютным".into());
    }
    let name = normalized_file_name(path).ok_or("bad_args: в пути нет имени файла")?;
    if DANGEROUS_NAMES.contains(&name.as_str()) {
        return Err("denied: такое имя файла запрещено".to_string());
    }
    if let Some((_, ext)) = name.rsplit_once('.') {
        if DANGEROUS_EXT.contains(&ext) {
            return Err(format!("denied: расширение «{ext}» запрещено"));
        }
    }
    let parent = path.parent().ok_or("bad_args: у пути нет каталога")?;
    // Каталог обязан существовать: save-диалог всегда отдаёт существующий, а
    // canonicalize по нему — единственный способ сравнить с запрещёнными
    // корнями честно (иначе проверка обходится одним `..` в середине пути).
    let parent_canon =
        fs::canonicalize(parent).map_err(|_| "bad_args: каталог не существует".to_string())?;
    for root in denied_roots {
        let Ok(root_canon) = fs::canonicalize(root) else {
            continue; // корня нет на этой машине — нечего и запрещать
        };
        if parent_canon.starts_with(&root_canon) {
            return Err("denied: в этот каталог запись запрещена".to_string());
        }
    }
    let file_name = path.file_name().ok_or("bad_args: в пути нет имени файла")?;
    Ok(parent_canon.join(file_name))
}

/// Каталоги, запись в которые «Поделиться» не нужна никогда, а вреда даёт
/// максимум: автозагрузка (Startup лежит внутри %APPDATA%, общий — внутри
/// %ProgramData%), системные каталоги, каталог установленной программы и
/// СВОИ данные Музы (installed.json плагинов, prefs, кэш).
fn denied_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for dir in [
        app.path().app_data_dir(),
        app.path().app_local_data_dir(),
        app.path().app_config_dir(),
    ] {
        if let Ok(d) = dir {
            roots.push(d);
        }
    }
    for var in [
        "APPDATA",
        "LOCALAPPDATA",
        "ProgramData",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "windir",
        "SystemRoot",
    ] {
        if let Ok(v) = std::env::var(var) {
            if !v.is_empty() {
                roots.push(PathBuf::from(v));
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    roots
}

/// Сохранить файл по пути, выбранному пользователем в save-диалоге.
/// data — base64 (Vec<u8> через serde гоняет массив чисел — на мегабайтном
/// PNG это заметно медленнее и толще).
#[tauri::command]
pub fn share_save_file(app: AppHandle, path: String, data_base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("битый base64: {e}"))?;
    let target = check_share_path(Path::new(&path), &denied_roots(&app))?;
    fs::write(&target, bytes).map_err(|e| format!("не записался файл: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_ordinary_png_and_json() {
        let dir = temp_dir("muza-share-ok");
        for name in ["карточка.png", "данные.json", "трек.jpeg", "список.txt"] {
            assert!(
                check_share_path(&dir.join(name), &[]).is_ok(),
                "{name} — обычное сохранение, обязано проходить"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// Главная угроза: чужой код в хост-окне пишет автозапуск/подменяет бинарь.
    #[test]
    fn rejects_executable_and_autorun_extensions() {
        let dir = temp_dir("muza-share-exe");
        for name in [
            "payload.exe",
            "payload.BAT",
            "hook.dll",
            "start.lnk",
            "run.ps1",
            "tweak.reg",
            "shortcut.url",
            "setup.msi",
        ] {
            assert!(
                check_share_path(&dir.join(name), &[]).is_err(),
                "{name} обязан быть отклонён"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// Windows отбрасывает хвостовые точки/пробелы при создании файла —
    /// `payload.exe.` лёг бы на диск как `payload.exe`.
    #[test]
    fn rejects_trailing_dot_extension_bypass() {
        let dir = temp_dir("muza-share-dots");
        for name in ["payload.exe.", "payload.exe ", "payload.exe... "] {
            assert!(
                check_share_path(&dir.join(name), &[]).is_err(),
                "{name:?} обязан быть отклонён — на диске это .exe"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_folder_hook_names() {
        let dir = temp_dir("muza-share-names");
        assert!(check_share_path(&dir.join("desktop.ini"), &[]).is_err());
        assert!(check_share_path(&dir.join("Desktop.INI"), &[]).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Запрещённый корень: своё AppData (installed.json плагинов), автозагрузка,
    /// системные каталоги. Проверяем и прямой путь, и обход через `..`.
    #[test]
    fn rejects_paths_inside_denied_root_including_traversal() {
        let root = temp_dir("muza-share-denied");
        let inner = root.join("sub");
        fs::create_dir_all(&inner).unwrap();
        let neighbour = temp_dir("muza-share-neighbour");

        assert!(check_share_path(&root.join("x.png"), &[root.clone()]).is_err());
        assert!(check_share_path(&inner.join("x.png"), &[root.clone()]).is_err());
        // `<сосед>/../<denied>/sub/x.png` — тот же каталог другим маршрутом
        let escaped = neighbour
            .join("..")
            .join(root.file_name().unwrap())
            .join("sub")
            .join("x.png");
        assert!(
            check_share_path(&escaped, &[root.clone()]).is_err(),
            "обход через .. обязан ловиться канонизацией"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&neighbour);
    }

    #[test]
    fn rejects_relative_path_and_missing_dir() {
        assert!(check_share_path(Path::new("card.png"), &[]).is_err());
        assert!(check_share_path(
            &std::env::temp_dir().join("muza-share-nope-dir").join("x.png"),
            &[]
        )
        .is_err());
    }

    /// Путь на запись — канонизированный: между проверкой и `fs::write`
    /// не должно оставаться неразобранных `..`.
    #[test]
    fn returns_canonical_target_path() {
        let dir = temp_dir("muza-share-canon");
        let sub = dir.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let tricky = sub.join("..").join("sub").join("card.png");
        let target = check_share_path(&tricky, &[]).unwrap();
        assert!(target.ends_with("sub\\card.png") || target.ends_with("sub/card.png"));
        assert!(!target.to_string_lossy().contains(".."));
        let _ = fs::remove_dir_all(&dir);
    }
}
