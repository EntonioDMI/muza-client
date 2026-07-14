# apps/desktop/src/shell/JoinPlaylistDialog.tsx

Вход в совместный плейлист по инвайт-коду (Stage 7). Код выдаёт владелец
через `CollabDialog.tsx` («Совместный доступ»).

---

**i18n (2026-07-14, T34a, эпик W5):** строки извлечены в
`dialogs.joinPlaylist.*` через `const { t } = useT();`. «Код короче 4
символов…» переиспользует общий `dialogs.codeTooShort` — идентичный текст
уже был в `JamDialog.tsx`. Кнопка «Отмена» — `common.cancel`.
