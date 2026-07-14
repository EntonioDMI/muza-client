/** Английский словарь (T28, эпик W5 i18n) — ДЕФОЛТНЫЙ язык интерфейса.
 *  Источник структуры: `ru.ts` типизируется через `typeof en` (см. его файл),
 *  так что расхождение форм между словарями — ошибка типов, а не рантайма.
 *
 *  Конвенция ключей (см. docs/notes/2026-07-14-i18n-план.md):
 *  - Вложенные зоны через точку: `<зона>.<подзона>.<имя>`.
 *  - `common.*` — переиспользуемые общие строки (кнопки, статусы).
 *  - `settings.tabs.<tabKey>` — подписи вкладок настроек, `<tabKey>` = ключ
 *    из SettingsView TABS (совпадает буквально, чтобы t(`settings.tabs.${key}`)
 *    работал без ручного маппинга).
 *  - `settings.<tabKey>.<группа>.<имя>` — строки внутри конкретной вкладки.
 *  - Это ТОЛЬКО стартовый набор для T28 (механика + переключатель); основная
 *    масса ключей появится по ходу T29-T33 (извлечение остальных ~2260 строк).
 */
export const en = {
  common: {
    ok: "OK",
    cancel: "Cancel",
    save: "Save",
  },
  settings: {
    title: "Settings",
    tabs: {
      account: "Account",
      appearance: "Appearance",
      playback: "Playback",
      sources: "Sources",
      lyrics: "Lyrics",
      library: "Library",
      integrations: "Integrations",
      hotkeys: "Hotkeys",
      extensions: "Extensions",
      system: "System",
    },
    appearance: {
      language: {
        title: "Interface language",
        hint: "Switches translated parts of the interface instantly, no restart",
        // Названия языков традиционно не переводятся (показываются на себе же).
        optionEn: "English",
        optionRu: "Русский",
      },
    },
  },
};
