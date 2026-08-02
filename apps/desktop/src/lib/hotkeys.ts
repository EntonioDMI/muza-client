/** Пенёк: сам модуль переехал в @muza/app (эпик веб-паритета) — веб-клиенту
 *  нужны те же клавиши, а вторая копия рано или поздно разъехалась бы с
 *  приложением (история playlistIcon.ts / PlaylistIconPicker.tsx).
 *
 *  Файл существует, чтобы потребители (App.tsx, SettingsView.tsx, types.ts)
 *  не получили дифф в этапе, который к ним отношения не имеет. Новый код
 *  импортирует из "@muza/app/lib/hotkeys" напрямую (подпуть в exports пакета —
 *  той же породы, что "@muza/app/shell/*": бочонок не тащит в веб-бандл
 *  лишнего). */
export {
  HOTKEY_ACTIONS,
  DEFAULT_HOTKEYS,
  hotkeyActionLabel,
  comboFromEvent,
  matchAction,
  formatCombo,
  withDefaults,
  isTypingTarget,
  type HotkeyAction,
} from "@muza/app/lib/hotkeys";
