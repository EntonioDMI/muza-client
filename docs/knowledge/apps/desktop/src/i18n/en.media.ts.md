# apps/desktop/src/i18n/en.media.ts

Английский i18n-фрагмент зоны `media` (эпик W5) — строки `player/*` (audioEngine, usePlayback, useJam) и `lib/*` с пользовательскими строками. Подмешивается в `en.ts` как `en.media`.

---

Дата: 2026-07-14.

Заполнен задачей извлечения player+lib (параллельно с зоной `views`, отдельным
агентом, файл `en.views.ts` — не пересекаются).

Зоны верхнего уровня: `player.errors` (тосты audioEngine/usePlayback),
`jam` (тосты useJam), `nav` (дефолтные метки вкладок сайдбара —
`lib/navItems.ts`), `hotkeys.actions` (лейблы действий — `lib/hotkeys.ts`),
`engine.errors` (lib/engine.ts), `barButtons`/`statsBlocks` (метки+хинты
настроек), `search.variants`/`search.versions` (lib/searchGrouping.ts —
ключи variants буквально повторяют `VariantType` включая snake_case и `"8d"`),
`hour` (lib/hourLabel.ts), `shareCard`/`share` (lib/shareCard.ts — canvas-текст
и текст для копирования), `themes` (дефолтные имена тем), `localFiles`
(подписи нативного диалога выбора файлов), `dragOut` (фолбэк ошибки drag-out).

Английский вокабуляр сверен с главным `en.ts` (Home/Search/Favorites/
Library/Stats/Shuffle/Repeat/Queue/Radio/Jam) — синонимы не вводились.

См. также `docs/knowledge/apps/desktop/src/i18n/ru.media.ts.md` (форма
`typeof mediaEn` заставляет tsc ловить расхождение ключей) и шапку самого
файла — там подробно описан подход к non-React потребителям (`translate(lang,
key, params)` вместо `useT()`) и к статичным Record-константам, чьи
потребители (Sidebar.tsx, SettingsView.tsx, StatsView.tsx, SearchGroupCard.tsx,
WrappedOverlay.tsx, ShareDialog.tsx) лежат вне зоны этой правки (shell/views).
