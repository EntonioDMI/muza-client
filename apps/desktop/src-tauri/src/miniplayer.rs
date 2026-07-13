//! Мини-плеер: компактное always-on-top окно (label "mini"), объявленное
//! СТАТИЧЕСКИ в tauri.conf.json (visible:false) — смонтировано и загружено
//! со старта приложения, просто скрыто. Грузит тот же index.html, что и
//! main; фронт по метке окна рендерит компакт-UI (src/mini/MiniPlayer.tsx).
//! Состояние/команды ходят tauri-событиями (lib/miniBridge.ts) — движок
//! звука живёт только в main-окне.
//!
//! Раньше окно создавалось ДИНАМИЧЕСКИ через WebviewWindowBuilder уже после
//! старта — это давало белое неотвечающее окно (сбой инициализации вебвью
//! на лету). Статическое окно из конфига создаётся тем же кодом Tauri, что
//! и main, поэтому надёжно. show/hide теперь просто переключают видимость
//! уже существующего окна, а не создают/уничтожают его.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Показать мини-плеер (окно уже существует со старта — просто показываем).
#[tauri::command]
pub fn miniplayer_show(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    // Фолбэк на случай, если статическое окно из конфига почему-то не
    // поднялось (например, старый конфиг без записи "mini") — не оставляем
    // пользователя с нерабочим свитчом.
    let win = WebviewWindowBuilder::new(&app, "mini", WebviewUrl::App("index.html".into()))
        .title("Muza mini")
        .inner_size(380.0, 148.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| format!("окно мини-плеера не создалось: {e}"))?;
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Спрятать мини-плеер (выключили настройку/крестик в самом мини).
/// hide(), НЕ close() — окно статическое, закрытое пересоздать штатно нельзя.
#[tauri::command]
pub fn miniplayer_hide(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
