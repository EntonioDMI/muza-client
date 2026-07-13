// Discord Rich Presence (Stage 3, слайс 7): статус «слушает Muza» с треком,
// обложкой и настраиваемой кнопкой (prefs). Discord не запущен или client_id
// не задан — молча no-op (возвращаем connected=false, UI не ругается).
//
// ⚠️ Для реальной активности владелец должен создать приложение в Discord
// Developer Portal и вписать его id (env MUZA_DISCORD_CLIENT_ID или константа).

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::State;

/// Application ID из Discord Developer Portal. Пусто = RPC выключен
/// (владелец ещё не создал приложение «Muza»). Когда ID появится — либо
/// впиши его сюда значением константы, либо собери с
/// `MUZA_DISCORD_CLIENT_ID=<id> cargo build` (компайл-тайм, не env рантайма).
const DEFAULT_CLIENT_ID: &str = "";

fn client_id() -> &'static str {
    option_env!("MUZA_DISCORD_CLIENT_ID").unwrap_or(DEFAULT_CLIENT_ID)
}

/// Настроен ли Application ID. Пока пусто — RPC осознанно заглушен;
/// клиент честно показывает это в под-панели настроек Discord.
#[tauri::command]
pub fn rpc_available() -> bool {
    !client_id().is_empty()
}

#[derive(Default)]
pub struct RpcState {
    client: Mutex<Option<DiscordIpcClient>>,
}

#[derive(Debug, Deserialize)]
pub struct RpcPayload {
    /// Первая строка (название трека).
    pub details: String,
    /// Вторая строка (артист).
    pub state: String,
    /// https-URL обложки (Discord умеет внешние URL); None — без картинки.
    pub cover_url: Option<String>,
    /// Unix-время старта трека (прогресс-бар «слушает N минут»).
    pub start_ts: Option<i64>,
    /// Настраиваемая кнопка активности (prefs.discordBtn*).
    pub button_label: Option<String>,
    pub button_url: Option<String>,
}

/// Обновить активность. Возвращает false, если Discord недоступен/не настроен —
/// это штатный случай, не ошибка.
#[tauri::command]
pub fn rpc_update(state: State<'_, RpcState>, payload: RpcPayload) -> bool {
    let id = client_id();
    if id.is_empty() {
        return false;
    }
    let mut guard = state.client.lock().unwrap();
    if guard.is_none() {
        let Ok(mut client) = DiscordIpcClient::new(id) else {
            return false;
        };
        if client.connect().is_err() {
            return false; // Discord не запущен — попробуем в следующий раз
        }
        *guard = Some(client);
    }
    let client = guard.as_mut().unwrap();

    let mut act = activity::Activity::new()
        .activity_type(activity::ActivityType::Listening)
        .details(&payload.details)
        .state(&payload.state);
    let assets = payload
        .cover_url
        .as_deref()
        .map(|url| activity::Assets::new().large_image(url).large_text("Muza"));
    if let Some(assets) = assets {
        act = act.assets(assets);
    }
    if let Some(ts) = payload.start_ts {
        act = act.timestamps(activity::Timestamps::new().start(ts));
    }
    let buttons: Vec<activity::Button> = match (&payload.button_label, &payload.button_url) {
        (Some(label), Some(url)) if !label.is_empty() && url.starts_with("http") => {
            vec![activity::Button::new(label, url)]
        }
        _ => vec![],
    };
    if !buttons.is_empty() {
        act = act.buttons(buttons);
    }

    if client.set_activity(act).is_err() {
        // соединение умерло (Discord перезапустили) — сбросим, переподключимся потом
        let _ = client.close();
        *guard = None;
        return false;
    }
    true
}

/// Убрать активность (пауза/выключение в настройках/выход).
#[tauri::command]
pub fn rpc_clear(state: State<'_, RpcState>) {
    let mut guard = state.client.lock().unwrap();
    if let Some(client) = guard.as_mut() {
        if client.clear_activity().is_err() {
            let _ = client.close();
            *guard = None;
        }
    }
}
