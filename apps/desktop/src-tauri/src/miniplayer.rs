//! Мини-плеер: компактное always-on-top окно (label "mini"). Грузит тот же
//! index.html, что и main; фронт по метке окна рендерит компакт-UI
//! (src/mini/MiniPlayer.tsx). Состояние/команды ходят tauri-событиями
//! (lib/miniBridge.ts) — движок звука живёт только в main-окне.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Показать мини-плеер (создать при первом вызове).
#[tauri::command]
pub fn miniplayer_show(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "mini", WebviewUrl::App("index.html".into()))
        .title("Muza мини")
        .inner_size(380.0, 148.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| format!("окно мини-плеера не создалось: {e}"))?;
    Ok(())
}

/// Закрыть мини-плеер (выключили настройку/крестик в самом мини).
#[tauri::command]
pub fn miniplayer_hide(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
