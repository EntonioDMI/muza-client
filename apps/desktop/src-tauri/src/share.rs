// Шеринг-карточки (Stage 7): фронт рисует PNG на canvas, Rust пишет байты
// в путь из системного save-диалога (plugin-dialog). WebView-скачивания
// в Tauri ненадёжны — простая команда честнее.

use base64::Engine as _;
use std::fs;

/// Сохранить файл по пути, выбранному пользователем в save-диалоге.
/// data — base64 (Vec<u8> через serde гоняет массив чисел — на мегабайтном
/// PNG это заметно медленнее и толще).
#[tauri::command]
pub fn share_save_file(path: String, data_base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("битый base64: {e}"))?;
    fs::write(&path, bytes).map_err(|e| format!("не записался файл: {e}"))
}
