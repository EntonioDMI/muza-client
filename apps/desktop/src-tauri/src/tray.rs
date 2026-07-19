// Иконка в трее + «закрыть = свернуть» (настройки → Система).
// Иконка строится один раз на старте; видимость и поведение закрытия окна
// конфигурирует фронт командой tray_configure из prefs (tray / closeToTray).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};

const TRAY_ID: &str = "muza-tray";

#[derive(Default)]
pub struct TrayState {
    /// Перехватывать закрытие окна (prevent_close + hide) вместо выхода.
    close_to_tray: AtomicBool,
}

/** pub(crate): та же «показать и сфокусировать» нужна single-instance
 *  (lib.rs) — второй запуск ярлыком поднимает уже живое окно из трея. */
pub(crate) fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Построить иконку трея (в setup). Пока фронт не сконфигурировал видимость,
/// иконка видима: дефолт prefs.tray = true, мигание на старте не страшно.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Открыть Muza", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().expect("bundled icon").clone())
        .tooltip("Muza")
        .menu(&menu)
        .show_menu_on_left_click(false) // ЛКМ — показать окно, меню только по ПКМ
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Закрытие главного окна: при close_to_tray прячем окно вместо выхода
/// (музыка продолжает играть — WebView живёт). Дёргается из on_window_event.
pub fn handle_close_requested(app: &AppHandle) -> bool {
    let hide = app
        .state::<TrayState>()
        .close_to_tray
        .load(Ordering::Relaxed);
    if hide {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
    hide
}

/// Конфигурация с фронта: видимость иконки + поведение закрытия.
/// close_to_tray без видимой иконки фронт не шлёт — окно было бы не вернуть.
#[tauri::command]
pub fn tray_configure(
    app: AppHandle,
    state: State<'_, TrayState>,
    visible: bool,
    close_to_tray: bool,
) -> Result<(), String> {
    state.close_to_tray.store(close_to_tray, Ordering::Relaxed);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}
