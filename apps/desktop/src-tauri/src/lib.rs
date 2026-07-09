// Вся логика приложения живёт здесь (main.rs — тонкий проходной слой,
// это требование Tauri для будущих мобильных сборок).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
