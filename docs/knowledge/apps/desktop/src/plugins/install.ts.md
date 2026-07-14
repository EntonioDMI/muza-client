# apps/desktop/src/plugins/install.ts

Установка плагина из файла (эпик W8, T44): стейджинг (Rust) → Zod-валидация
манифеста + AST/CSS-скан (`@muza/core`) → согласие на права (UI в
`SettingsView.tsx`) → финализация (Rust). Плюс тонкие обёртки
list/enable/uninstall над командами `plugins.rs`. См. §6.1 дизайн-дока.

---

Не React-модуль — функции вызываются из `views/SettingsView.tsx`.
`pickAndStagePlugin`/`stagePluginFromMarket` бросают `Error` с
человекочитаемой причиной (`SettingsView.tsx` ловит и зовёт `onNotify`);
`null` из `pickAndStagePlugin` — пользователь отменил выбор файла.

**i18n (2026-07-14, T34a, эпик W5, общий свип):** все брошенные `Error` и
подписи нативного диалога выбора файла (`filters[].name`, `title`) были
захардкожены по-русски — найдены отдельным свипом (не входили в исходный
список T34a). Так как это не React-компонент, `useT()` недоступен —
добавлен параметр `lang: Lang = DEFAULT_LANG` в обе публичные функции
(`pickAndStagePlugin(lang?)`, `stagePluginFromMarket(payload, lang?)`),
сообщения строятся через `translate(lang, key, params)` (тот же паттерн, что
`lib/shareCard.ts::renderShareCard/shareText`). Единственный потребитель —
`views/SettingsView.tsx` — передаёт свой `lang` из `useT()` в обоих местах
вызова (`startInstall`/маркетплейс-инсталл). Ключи —
`plugins.install.{fileOnlyInApp,marketOnlyInApp,filePickerFilterName,
filePickerTitle,manifestRejected,scriptRejected,cssRejected}` (последние три
принимают параметр `{reason}` — текст ошибки валидации/скана из
`@muza/core`, он сам не переводится, т.к. приходит из библиотеки).
