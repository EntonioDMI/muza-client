# apps/desktop/src/shell/JamDialog.tsx

Jam — «слушать вместе» (Stage 7): вне jam — создать или войти по коду; в
jam — код, список слушателей, у гостя подпись «управляет {host}». Рендерится
из `App.tsx` внутри `<LanguageProvider>`.

---

**i18n (2026-07-14, T34a, эпик W5):** строки извлечены в `dialogs.jam.*`
через `const { t } = useT();`. Особенности:
- Кнопка «Свернуть» (когда jam активен) переиспользует `listeningMode.minimize`
  — идентичный текст в обоих языках, не заводился отдельный ключ.
- `dialogs.jam.guestDescription` содержит параметр `{host}` (имя хоста).
- `dialogs.jam.hostUnavailable` содержит параметр `{track}` — сама подстрока
  с названием трека собирается в коде (`jam.hostState ? \`"${title}"\` :
  t("dialogs.jam.genericTrack")`), т.к. кавычки вокруг названия трека не
  часть перевода. Оригинальный код использовал русские «ёлочки» — сейчас
  везде обычные прямые кавычки (упрощение, не языко-зависимая деталь).
- `dialogs.codeTooShort` и `dialogs.copyFailed`/`dialogs.copyCode` — общие
  ключи, используемые и в `JoinPlaylistDialog.tsx`/`CollabDialog.tsx`
  (идентичный текст).
