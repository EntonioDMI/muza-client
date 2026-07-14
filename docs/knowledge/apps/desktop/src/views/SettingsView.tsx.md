# apps/desktop/src/views/SettingsView.tsx

Экран «Настройки»: все вкладки (`settings.tabs.*`) и под-экраны
(customize/equalizer/discord/market/data/sessions/privacy/licenses/bar/nav/
stats — см. `i18n/en.ts` за списком зон `settings.*`). Большой файл, несколько
компонентов-секций внутри, каждый со своим `const { t } = useT();` (и местами
`lang`). Полностью переведён в T29/T30 (i18n эпик W5) — эта заметка НЕ
покрывает файл целиком, только зафиксированное далее.

---

`type T = (key: TranslationKey, params?: TParams) => string;` (строка ~51) —
тип функции перевода, передаётся параметром в свободные module-level
хелперы без доступа к React-контексту (напр. `discordPreviewVars(t: T)`) —
паттерн для переиспользования `t()` вне компонента.

**T34a (2026-07-14, эпик W5, общий свип):** `plugins/install.ts` получил
параметр `lang: Lang` в `pickAndStagePlugin`/`stagePluginFromMarket` (раньше
эти функции сами бросали захардкоженные русские `Error` и задавали текст
нативного диалога выбора файла). Оба места вызова здесь обновлены передать
свой `lang` (уже был в `const { t, lang } = useT();`, строка ~848):
- `startInstall()` (около строки 871): `pickAndStagePlugin(lang)`.
- маркетплейс-путь установки (около строки 1366):
  `stagePluginFromMarket({ manifest, code, css, strings }, lang)`.

Без этой правки установка плохого файла плагина показывала бы русский тост
об ошибке даже в EN-интерфейсе (текст ошибки шёл из `e.message`, который
`catch`-блок предпочитает переведённому фолбэку —
`e instanceof Error ? e.message : t(...)`).

Известный документированный трейд-офф (НЕ тронуто в T34a): `EQ_PRESETS`
(около строки 810) и литерал `"Свой"` (кастомный пресет эквалайзера,
строка ~1435/2099) — персистентные значения `Prefs`, общая схема с
`apps/web`; перевод сломал бы совместимость сохранённых профилей. См.
`docs/knowledge/apps/desktop/src/i18n/en.ts.md`.
