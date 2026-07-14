# apps/desktop/src/mini/MiniPlayer.tsx

Мини-плеер: контент окна "mini" (380×148, без рамки, поверх всех). Данные
приходят событиями из main-окна (`lib/miniBridge`) — тут ни движка, ни API;
только обложка, строки и транспорт. Тема/акцент читаются из общих prefs
(`localStorage` один на origin у обоих окон, ключ `muza.prefs.v1`).

---

Отдельный webview/React-root (НЕ рендерится внутри App.tsx/Player.tsx) —
значит ВНЕ `<LanguageProvider>`. Строки читаются через
`translate(prefs.language, key, params)` из `../i18n`, а не `useT()`.

**i18n (2026-07-14, T34a, эпик W5):** `loadThemePrefs()` раньше типизировался
как `Pick<Prefs, "theme" | "accent" | "customAccent">` и не знал о языке.
Теперь:
- Тип расширен до `Pick<Prefs, "theme" | "accent" | "customAccent" |
  "language">`.
- При чтении `localStorage` язык мигрируется ТАК ЖЕ, как в
  `App.tsx::loadPrefs` — `resolveMigratedLanguage(stored.language)` (см.
  `i18n/index.tsx`): существующие профили без сохранённого `language`
  получают "ru" (привычный язык), а не дефолт "en" для новых профилей. Без
  этой миграции мини-плеер у старых пользователей молча переключился бы на
  английский, пока главное окно (уже мигрированное через `App.loadPrefs`)
  оставалось бы русским — расхождение между окнами одного и того же
  профиля.
- Строки переведены в зону `mini.*`: `waitingForMusic` и `closeMiniPlayer` —
  свои ключи; Предыдущий/Следующий/Пауза/Слушать/Нравится переиспользуют
  уже существующие `player.previous`/`player.next`/`player.pause`/
  `player.play`/`common.like` (идентичный текст, отдельные ключи не
  заводились).
