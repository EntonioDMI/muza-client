// Вся логика приложения живёт здесь (main.rs — тонкий проходной слой,
// это требование Tauri для будущих мобильных сборок).

mod engine;
mod local;
mod rpc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(engine::EngineState::default())
        .manage(local::LocalState::default())
        .manage(rpc::RpcState::default())
        .setup(|app| {
            // Последний доверенный рецепт из оффлайн-кэша (подпись перепроверяется)
            engine::init(app.handle());
            // Реестр локальных файлов + asset-scope для живых путей
            local::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::recipe_apply,
            engine::recipe_current,
            engine::engine_resolve,
            engine::engine_cache_stats,
            engine::engine_cache_remove,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
