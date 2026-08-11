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

/// Application ID из Discord Developer Portal. Пусто = RPC выключен.
/// Значение перенесено из старого проекта Muza (там RPC работал: приложение
/// «Muza», `@xhayper/discord-rpc`). Переопределяется компайл-тайм-env
/// `MUZA_DISCORD_CLIENT_ID=<id> cargo build`, если понадобится другой ID.
const DEFAULT_CLIENT_ID: &str = "1515000829390749734";

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
    /// Unix-время старта трека (счётчик «слушает N минут»).
    pub start_ts: Option<i64>,
    /// Unix-время конца трека: вместе со start Discord рисует нативную
    /// прогресс-линию начала/конца (prefs.discordProgressOn). None — только счётчик.
    pub end_ts: Option<i64>,
    /// Настраиваемая кнопка активности (prefs.discordBtn*).
    pub button_label: Option<String>,
    pub button_url: Option<String>,
}

/// Чем кончилась попытка показать активность.
///
/// ⚠️ ДО 12.08 ЗДЕСЬ БЫЛ ГОЛЫЙ `bool` НА ПЯТЬ РАЗНЫХ ИСХОДОВ: пустой
/// application id, клиент не создался, Discord не запущен, Discord отклонил
/// активность, всё хорошо. Наружу они приходили неотличимо, а текст ошибки от
/// самого Discord (кривой адрес кнопки, слишком длинная подпись, отклонённая
/// активность) выбрасывался. Из-за этого жалоба «у меня RPC не работает вообще»
/// (5 из семи) не поддавалась разбору в принципе: и человек, и мы переключали
/// тумблеры вслепую. `stage` говорит, ГДЕ оборвалось, `message` — что сказала
/// система.
#[derive(Debug, Default, serde::Serialize)]
pub struct RpcOutcome {
    pub ok: bool,
    /// Машинная метка шага: "off" | "no_client" | "no_discord" | "rejected" | "ok".
    /// Текст для человека собирает фронт — переводы живут там.
    pub stage: &'static str,
    /// Что сказали система или Discord. Пусто — сказать нечего.
    pub message: Option<String>,
}

impl RpcOutcome {
    fn fail(stage: &'static str, message: impl Into<String>) -> Self {
        Self { ok: false, stage, message: Some(message.into()) }
    }
    fn done() -> Self {
        Self { ok: true, stage: "ok", message: None }
    }
}

/// Обновить активность. Отказ — штатный случай (Discord может быть не запущен),
/// но теперь он ИМЕНОВАННЫЙ: см. RpcOutcome.
#[tauri::command]
pub fn rpc_update(state: State<'_, RpcState>, payload: RpcPayload) -> RpcOutcome {
    let id = client_id();
    if id.is_empty() {
        return RpcOutcome::fail("off", "application id не задан при сборке");
    }
    let mut guard = state.client.lock().unwrap();
    if guard.is_none() {
        let mut client = match DiscordIpcClient::new(id) {
            Ok(client) => client,
            Err(e) => return RpcOutcome::fail("no_client", e.to_string()),
        };
        if let Err(e) = client.connect() {
            // Discord не запущен, запущен от другого пользователя, стоит из
            // Microsoft Store (там он живёт в изолированном контейнере, и
            // именованный канал \\?\pipe\discord-ipc-N из обычного процесса
            // недостижим) — здесь всё это выглядит одинаково, поэтому важен
            // текст: без него разбирать нечего.
            return RpcOutcome::fail("no_discord", e.to_string());
        }
        *guard = Some(client);
    }
    let client = guard.as_mut().unwrap();

    let buttons: Vec<activity::Button> = match (&payload.button_label, &payload.button_url) {
        // Полная схема, а не голое "http": Discord прячет активность с кривым
        // URL кнопки. Зеркало isValidButtonUrl (lib/discord.ts) — предпросмотр
        // и реальная отправка обязаны сходиться.
        (Some(label), Some(url))
            if !label.is_empty()
                && (url.starts_with("http://") || url.starts_with("https://")) =>
        {
            vec![activity::Button::new(label, url)]
        }
        _ => vec![],
    };
    // ⚠️ Кнопки Discord рендерит только у Playing-активности. Кнопка на
    // Listening (type 2) — известная ломающая комбинация: автор видит свой
    // статус (без кнопки — своих кнопок не видно by design), а у ОСТАЛЬНЫХ
    // presence не отображается вовсе (жалоба 2026-07-20). Поэтому: кнопка
    // включена → честный Playing («Играет в Muza»), выключена → Listening.
    // Предпросмотр в настройках зеркалит это переключение (SettingsView).
    let activity_type = if buttons.is_empty() {
        activity::ActivityType::Listening
    } else {
        activity::ActivityType::Playing
    };
    let mut act = activity::Activity::new()
        .activity_type(activity_type)
        .details(&payload.details)
        .state(&payload.state);
    // Обложка трека (каталог/iTunes) как large_image; нет её — фолбэк на арт-ассет
    // `logo`, залитый в приложение Discord (как в старом проекте Muza — там RPC
    // всегда показывал логотип, когда обложка не находилась).
    let large_image = payload.cover_url.as_deref().unwrap_or("logo");
    act = act.assets(
        activity::Assets::new()
            .large_image(large_image)
            .large_text("Muza"),
    );
    if let Some(ts) = payload.start_ts {
        let mut timestamps = activity::Timestamps::new().start(ts);
        // start+end = нативная прогресс-линия трека (у Listening); один start —
        // просто счётчик «N минут». Управляется prefs.discordProgressOn на фронте.
        if let Some(end) = payload.end_ts {
            timestamps = timestamps.end(end);
        }
        act = act.timestamps(timestamps);
    }
    if !buttons.is_empty() {
        act = act.buttons(buttons);
    }

    if let Err(e) = client.set_activity(act) {
        // соединение умерло (Discord перезапустили) — сбросим, переподключимся
        // потом. Текст сохраняем: сюда же приходит и содержательный отказ
        // самого Discord — например, отклонённый адрес кнопки.
        let message = e.to_string();
        let _ = client.close();
        *guard = None;
        return RpcOutcome::fail("rejected", message);
    }
    RpcOutcome::done()
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
