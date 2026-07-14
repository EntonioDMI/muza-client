# apps/desktop/src/lib/barButtons.ts

Компоновка плеер-бара: нормализация `prefs.barButtons` + `BAR_BUTTON_META` — дефолтные метки+хинты настраиваемых кнопок бара (shuffle/repeat/sleep/speed/equalizer/lyrics/jam/volume/queue/fullscreen).

---

`normalizeBarButtons()` — не менялось.

**i18n (2026-07-14, эпик W5, T-media):** та же схема, что у `NAV_ITEM_META`
(см. `docs/knowledge/apps/desktop/src/lib/navItems.ts.md`) — единственный
потребитель `BAR_BUTTON_META`, `views/SettingsView.tsx`, вне зоны этой
правки, читает `.label`/`.hint` плоскими полями. Дефолт — EN через
`translate(DEFAULT_LANG, "media.barButtons.<key>.label|hint")` при импорте
(было RU). Добавлена `barButtonLabel(key, lang)` для будущей правки
потребителя.
