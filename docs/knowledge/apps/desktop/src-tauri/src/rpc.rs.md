# apps/desktop/src-tauri/src/rpc.rs

Discord Rich Presence («Слушает Muza»): подключение к локальному Discord-IPC через крейт `discord-rich-presence`, сборка и отправка activity по данным трека из фронта. Тихо деградирует, если Discord не запущен или Application ID не задан — плеер работает дальше.

---

## Как работает
- **Application ID**: `const DEFAULT_CLIENT_ID` (строка 17) — id приложения из Discord Developer Portal. Значение `1515000829390749734` перенесено из старого проекта Muza (`Muza_проект/muza/main.js`, там RPC работал через `@xhayper/discord-rpc`, приложение называется «Muza»). `client_id()` резолвит `option_env!("MUZA_DISCORD_CLIENT_ID")` (компайл-тайм, НЕ рантайм-env) с фолбэком на константу — можно пересобрать с другим id, не трогая код.
- **`rpc_available()`** (tauri-команда): `!client_id().is_empty()` — фронт (под-панель настроек Discord, `SettingsView` вкладка «Интеграции») честно показывает статус «настроено / нужен Application ID». Теперь возвращает `true`, т.к. id непустой.
- **Соединение** (`rpc_connect`/внутренний guard под `Mutex`): `DiscordIpcClient::new(id)` → `connect()`; провал (Discord не запущен) = не ошибка, повтор при следующем апдейте. Клиент пересоздаётся после дисконнекта.
- **Activity**: тип `Listening`, `details`=payload.details (трек), `state`=payload.state (исполнитель). **Обложка**: `large_image` = `payload.cover_url` если есть, иначе фолбэк на арт-ассет `"logo"` (залит в приложение Discord под этим именем ещё в старом проекте — так RPC всегда показывает логотип без обложки). `large_text`="Muza". Опц. `start` timestamp (прогресс-таймер) и настраиваемая кнопка (`button_label`/`button_url` из prefs).

## На что обратить внимание
- Правка `src-tauri/` при РАБОТАЮЩЕМ приложении блокирует exe → пересборка падает (CLAUDE.md). `cargo check` изменения проходит (exit 0).
- `logo`-фолбэк предполагает, что арт-ассет с ключом `logo` реально залит в приложение `1515000829390749734` (Rich Presence → Art Assets). Если нет — Discord просто не покажет картинку (не ломается), нужно долить `assets/icon.png` под именем `logo`.
- Application ID НЕ секрет (публичный client_id для RPC) — в отличие от бот-токена/client secret, которых тут нет и быть не должно.
