// Вся логика приложения живёт здесь (main.rs — тонкий проходной слой,
// это требование Tauri для будущих мобильных сборок).

mod engine;
mod local;
mod miniplayer;
mod plugins;
mod rpc;
mod share;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // Автообновление (Stage 8): подпись артефактов updater-ключом,
        // endpoint GitHub Releases — tauri.conf.json; process — relaunch
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // drag-out: трек из бара утаскивается на рабочий стол файлом
        .plugin(tauri_plugin_drag::init())
        // Плагины уровня 1 (T44): песочница на своём протоколе — bootstrap-
        // документ отдаёт СВОЙ CSP (не наследует глобальный, полноценный
        // origin), см. plugins.rs и tauri.conf.json (frame-src).
        .register_uri_scheme_protocol("muza-plugin", plugins::handle_plugin_request)
        .manage(engine::EngineState::default())
        .manage(local::LocalState::default())
        .manage(rpc::RpcState::default())
        .manage(tray::TrayState::default())
        .manage(plugins::PluginsState::default())
        .setup(|app| {
            // Последний доверенный рецепт из оффлайн-кэша (подпись перепроверяется)
            engine::init(app.handle());
            // Реестр локальных файлов + asset-scope для живых путей
            local::init(app.handle());
            // Иконка трея; видимость и «закрыть = свернуть» задаёт фронт из prefs
            tray::init(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if tray::handle_close_requested(window.app_handle()) {
                        api.prevent_close();
                    } else {
                        // Выходим по-настоящему. Мини-плеер — статическое окно
                        // (visible:false в конфиге), hide() его не уничтожает —
                        // значит оно останется «открытым», и Tauri не запустит
                        // авто-выход по нулю окон (см. RunEvent::ExitRequested).
                        // Поэтому тут именно close(), а не miniplayer_hide():
                        // мини-плеер не должен пережить main.
                        if let Some(mini) = window.app_handle().get_webview_window("mini") {
                            let _ = mini.close();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            engine::recipe_apply,
            engine::recipe_current,
            engine::engine_resolve,
            engine::engine_cache_stats,
            engine::engine_cache_remove,
            engine::engine_export_cached,
            engine::engine_cache_clear,
            engine::engine_set_cache_limit,
            engine::engine_pin,
            engine::engine_pins,
            engine::engine_stats_take,
            engine::engine_doctor,
            local::local_scan,
            local::local_list,
            local::local_resolve,
            local::local_forget,
            rpc::rpc_update,
            rpc::rpc_clear,
            rpc::rpc_available,
            share::share_save_file,
            tray::tray_configure,
            miniplayer::miniplayer_show,
            miniplayer::miniplayer_hide,
            plugins::list_installed,
            plugins::set_plugin_enabled,
            plugins::uninstall_plugin,
            plugins::plugin_stage_from_file,
            plugins::plugin_discard_staged,
            plugins::plugin_finalize_install,
            plugins::plugin_storage_get,
            plugins::plugin_storage_set,
            plugins::plugin_storage_remove,
            plugins::plugin_storage_keys,
            plugins::plugin_net_fetch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
