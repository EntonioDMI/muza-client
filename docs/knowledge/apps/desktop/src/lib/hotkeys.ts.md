# apps/desktop/src/lib/hotkeys.ts

Горячие клавиши: data-driven биндинги (`HOTKEY_ACTIONS`, `DEFAULT_HOTKEYS`) + парс/матч/формат combo по `e.code` (layout-независимо).

---

Combo-логика (`comboFromEvent`/`matchAction`/`formatCombo`/`withDefaults`) —
не менялась.

**i18n (2026-07-14, эпик W5, T-media):** та же ситуация, что у
`NAV_ITEM_META` (см. `docs/knowledge/apps/desktop/src/lib/navItems.ts.md`):
`HOTKEY_ACTIONS[].label` потребляют `App.tsx` (оверлей «?») и
`views/SettingsView.tsx` (вкладка «Клавиши») — оба вне зоны этой правки,
читают `.label` плоским полем. Дефолт вычислен через
`translate(DEFAULT_LANG, "media.hotkeys.actions.<id>")` при импорте — было
RU, стало EN, живого переключения языка для этих меток нет без правки
потребителя. Добавлена `hotkeyActionLabel(id, lang)` — готовая точка для
будущей правки потребителя.
