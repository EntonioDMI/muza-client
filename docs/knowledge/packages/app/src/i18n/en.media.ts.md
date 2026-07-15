# packages/app/src/i18n/en.media.ts

Английский i18n-фрагмент зоны `media` (эпик W5) — строки `player/*` (audioEngine, usePlayback, useJam) и `lib/*` с пользовательскими строками. Подмешивается в `en.ts` как `en.media`. С Э0 веб-паритета (2026-07-15) живёт в `@muza/app`. Обновлено: 2026-07-15 (переезд).

---

Дата: 2026-07-14 (заполнение), 2026-07-15 (переезд в пакет).

Заполнен задачей извлечения player+lib (параллельно с зоной `views`, отдельным
агентом, файл `en.views.ts` — не пересекаются).

⚠️ **Все пути ниже — от корня десктопа (`apps/desktop/src/`), а не от этого
пакета.** Фрагмент уехал в `@muza/app` РАНЬШЕ своих потребителей: строки уже
здесь, а `player/*` и `lib/*` — ещё в `apps/desktop` (приезжают в Э2–Э4:
`lib/dragOut.ts` первым портом адаптера, движок плеера — Э4). Пока это так,
короткий путь `lib/navItems.ts` в документе под `packages/app/` читался бы как
`packages/app/src/lib/navItems.ts`, где кода нет.

Зоны верхнего уровня: `player.errors` (тосты `apps/desktop/src/player/`
audioEngine/usePlayback), `jam` (тосты `player/useJam.ts`), `nav` (дефолтные
метки вкладок сайдбара — `apps/desktop/src/lib/navItems.ts`), `hotkeys.actions`
(лейблы действий — `lib/hotkeys.ts`), `engine.errors` (`lib/engine.ts`),
`barButtons`/`statsBlocks` (метки+хинты настроек), `search.variants`/
`search.versions` (`lib/searchGrouping.ts` — ключи variants буквально повторяют
`VariantType` включая snake_case и `"8d"`), `hour` (`lib/hourLabel.ts`),
`shareCard`/`share` (`lib/shareCard.ts` — canvas-текст и текст для
копирования), `themes` (дефолтные имена тем), `localFiles` (подписи нативного
диалога выбора файлов), `dragOut` (фолбэк ошибки drag-out).

Английский вокабуляр сверен с главным `en.ts` (Home/Search/Favorites/
Library/Stats/Shuffle/Repeat/Queue/Radio/Jam) — синонимы не вводились.

См. также `docs/knowledge/packages/app/src/i18n/ru.media.ts.md` (форма
`typeof mediaEn` заставляет tsc ловить расхождение ключей) и шапку самого
файла — там подробно описан подход к non-React потребителям (`translate(lang,
key, params)` вместо `useT()`) и к статичным Record-константам, чьи
потребители (`shell/Sidebar.tsx`, `views/SettingsView.tsx`,
`views/StatsView.tsx`, `shell/SearchGroupCard.tsx`, `shell/WrappedOverlay.tsx`,
`shell/ShareDialog.tsx` — все в `apps/desktop/src/`) лежат вне зоны этой
правки (shell/views).

## Э0 веб-паритета (2026-07-15): переезд в `@muza/app`

Переехал `apps/desktop/src/i18n/en.media.ts` → `packages/app/src/i18n/en.media.ts`
вместе со всем модулем i18n, **без правок содержимого** (git: `R100` — чистое
переименование, 0 строк диффа). Приём «пенёк» на старом пути —
`docs/knowledge/apps/desktop/src/i18n/index.tsx.md`.

Для этого фрагмента у переезда есть отдельный смысл, помимо общего: приём
«язык в не-React коде передаётся параметром `lang: Lang = DEFAULT_LANG`»,
который здесь и обкатан, стал **опорой для `PlatformAdapter`** — план
веб-паритета ссылается именно на него, обосновывая инжект платформы явным
параметром, а не модульным синглтоном (модульный синглтон ломает тесты и
второе окно `mini`). То есть конвенция этого файла пережила свою зону и стала
общей для всего марафона Э0–Э9.
