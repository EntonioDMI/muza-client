# apps/desktop/src/shell/AddLinkDialog.tsx

«Добавить по ссылке» (Stage 4): YT/YTM/SoundCloud/Bandcamp — как есть,
Spotify/Apple Music — сервер сопоставит через Odesli. Добавленная ссылка
становится выбранным источником трека.

---

**i18n (2026-07-14, T34a, эпик W5):** строки извлечены в `dialogs.addLink.*`
через `const { t } = useT();`. Кнопка «Отмена» переиспользует `common.cancel`.
Плейсхолдер `"https://…"` остался нетронутым литералом — не языко-зависимый
текст, а пример формата URL.
