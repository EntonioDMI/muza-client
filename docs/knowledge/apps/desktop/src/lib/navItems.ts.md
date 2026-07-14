# apps/desktop/src/lib/navItems.ts

Компоновка сайдбара: нормализация `prefs.navItems` (состав/порядок/свои имена вкладок) + `NAV_ITEM_META` — дефолтные метки+иконки вкладок home/search/favorites/library/stats.

---

`normalizeNavItems()` — не менялось. `NavItemPref.label` — СВОЙ текст
пользователя (override), это данные, не трогать.

**i18n (2026-07-14, эпик W5, T-media):** `NAV_ITEM_META[key].label` раньше
был захардкожен по-русски. Потребители — `shell/Sidebar.tsx` и
`views/SettingsView.tsx` (оба ВНЕ зоны этой правки: shell запрещён всегда,
views — зона другого параллельного агента) — читают `.label` как ПЛОСКОЕ
ПОЛЕ, без вызова `t()`. Раз потребителя менять было нельзя, дефолт вычислен
ОДИН РАЗ при импорте модуля через `translate(DEFAULT_LANG, "media.nav.<key>")`
— было RU, стало EN-константа; языковой переключатель для сайдбар-вкладок
сейчас НЕ работает живьём (проверено вручную: сайдбар остаётся "Home/Search/
Favorites/Library/Stats" при переключении на RU, пока весь остальной UI
переключается).

Добавлена `navItemLabel(key, lang)` — готовая точка для будущей правки
потребителя (заменить `NAV_ITEM_META[key].label` на
`navItemLabel(key, prefs.language)` в Sidebar.tsx/SettingsView.tsx).
