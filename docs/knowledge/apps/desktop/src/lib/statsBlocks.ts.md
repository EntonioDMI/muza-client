# apps/desktop/src/lib/statsBlocks.ts

Конфиг блоков страницы «Статистика»: нормализация `prefs.statsBlocks` + `STATS_BLOCK_META` — дефолтные метки+хинты (summary/activity/rhythm/top_tracks/top_artists/streaks/likes). Обновлено: 2026-07-16 — блок `wrapped` УДАЛЁН (вход во Wrapped только с главной, решение владельца); legacy-ключ из старых prefs вычищает `normalizeStatsBlocks` (тест в `statsBlocks.test.ts`).

---

Ключи `StatsBlockKey` (`types.ts`) — snake_case (`top_tracks`/`top_artists`),
это отражено в i18n-ключах `media.statsBlocks.top_tracks`/`top_artists`
(НЕ camelCase — легко ошибиться при добавлении новых ключей).

**i18n (2026-07-14, эпик W5, T-media):** та же схема, что у `NAV_ITEM_META`
(см. `docs/knowledge/apps/desktop/src/lib/navItems.ts.md`) — потребители
`views/StatsView.tsx` и `views/SettingsView.tsx` вне зоны этой правки, читают
`.label`/`.hint` плоскими полями. Дефолт — EN через `translate(DEFAULT_LANG,
...)` при импорте (было RU). Добавлена `statsBlockLabel(key, lang)` для
будущей правки потребителя.
