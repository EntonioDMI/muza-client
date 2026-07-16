// Долговечное зеркало критичного состояния фронта (сессия, prefs).
//
// Зачем: localStorage живёт в LevelDB WebView2, который коммитит мутации
// на диск ЛЕНИВО (батч в памяти browser-процесса). «Завершить задачу» в
// диспетчере убивает процессы до коммита — свежие записи пропадают. Для
// prefs это «настройки сбросились», для сессии — хуже: ротация refresh-
// токена уже прошла на сервере, а на диске остался СТАРЫЙ токен; его
// повтор после grace-окна сервер трактует как кражу и отзывает все сессии
// пользователя (жалоба 2026-07-16 «после завершения задачи вход слетает»).
//
// Схема: фронт зеркалит каждый setItem/removeItem белого списка ключей в
// обычный файл app_data/state/<key>.json (durableState.ts), а на старте
// восстанавливает localStorage из файлов — файл всегда не старее LevelDB.
// Запись через временный файл + rename: убийство посреди записи оставляет
// либо старую, либо новую версию, но не огрызок.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Ключ — строго [a-z0-9._-], 1..=64: имя файла без сюрпризов
/// (никаких путей, точек-точек и юникода).
fn valid_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-'))
        && !key.contains("..")
}

fn state_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if !valid_key(key) {
        return Err("недопустимый ключ состояния".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("нет app_data_dir: {e}"))?
        .join("state");
    fs::create_dir_all(&dir).map_err(|e| format!("state dir: {e}"))?;
    Ok(dir.join(format!("{key}.json")))
}

/// Значение по ключу; None — файла нет (ключ никогда не писался или удалён).
#[tauri::command]
pub fn state_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = state_path(&app, &key)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("чтение состояния: {e}")),
    }
}

/// Записать значение (атомарно через tmp+rename). Потолок 1 МиБ —
/// prefs с запасом, а мусор гигабайтами сюда не затолкать.
#[tauri::command]
pub fn state_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    if value.len() > 1024 * 1024 {
        return Err("значение слишком велико".into());
    }
    let path = state_path(&app, &key)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, value.as_bytes()).map_err(|e| format!("запись состояния: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename состояния: {e}"))?;
    Ok(())
}

/// Удалить ключ (logout и т.п.). Отсутствие файла — не ошибка.
#[tauri::command]
pub fn state_del(app: AppHandle, key: String) -> Result<(), String> {
    let path = state_path(&app, &key)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("удаление состояния: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::valid_key;

    #[test]
    fn keys_are_strict_slugs() {
        assert!(valid_key("muza.session.v1"));
        assert!(valid_key("muza.prefs.v1"));
        assert!(!valid_key(""));
        assert!(!valid_key("Muza.Session"));
        assert!(!valid_key("../etc/passwd"));
        assert!(!valid_key("a/b"));
        assert!(!valid_key("a\\b"));
        assert!(!valid_key(&"x".repeat(65)));
    }
}
