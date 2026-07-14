# apps/desktop/src/lib/themes.ts

Темы как объекты (Stage 6): именованный снапшот оформления (`THEME_KEYS` — подмножество `Prefs`) + CSS-тир. Хранение — localStorage, обмен — JSON.

---

`sanitizeTokens`/`applyTheme`/`parseTheme`/`serializeTheme` и весь
storage-слой (`listThemes`/`persist`) — не менялись.

**i18n (2026-07-14, эпик W5, T-media):** `saveTheme(name, prefs, lang?)` и
`addTheme(name, tokens, lang?)` получили опциональный `lang: Lang =
DEFAULT_LANG` — используется ТОЛЬКО как дефолтное имя темы, если пользователь
ничего не ввёл (`name.trim() || translate(lang, "media.themes.myTheme" |
"theme")`). Единственный потребитель — `views/SettingsView.tsx` (вкладка
Customize → Themes), вне зоны этой правки, зовёт без lang → дефолтное имя
новой безымянной темы теперь «My theme»/«Theme» (EN), было «Моя тема»/«Тема»
(RU).
