/** Горячие клавиши: data-driven биндинги с переназначением.
 *
 *  Общий модуль обоих клиентов (переехал из apps/desktop/src/lib/hotkeys.ts,
 *  эпик веб-паритета): про Tauri он не знал никогда — только `KeyboardEvent`,
 *  поэтому в вебе работает без единой правки. На старом месте — пенёк.
 *
 *  Combo кодируется по `e.code` (физическая клавиша) — layout-независимо:
 *  «KeyL» ловит и L, и Д, не нужен хак `k==="l"||k==="д"`. Модификаторы
 *  Ctrl/Alt/Shift в фиксированном порядке. Пример: "Ctrl+ArrowRight", "KeyL".
 *
 *  Обработчики живут в приложении (мапа actionId → колбэк); здесь —
 *  определения, дефолты, парс/матч/формат. Вкладка «Клавиши» и оверлей «?»
 *  десктопа читают отсюда, веб — providers.tsx (apps/web).
 *
 *  ⚠️ Ввод текста модуль не сторожит сам: проверка «фокус в поле» — на стороне
 *  слушателя (одинаковая в обоих клиентах: INPUT/TEXTAREA/contentEditable), а
 *  здесь нет доступа к тому, что вокруг события.
 *
 *  i18n (эпик W5, T-media): HOTKEY_ACTIONS[].label — та же ситуация, что у
 *  NAV_ITEM_META (см. apps/desktop/src/lib/navItems.ts) — потребители
 *  (App.tsx, SettingsView.tsx) вне зоны той правки читают `.label` плоским
 *  полем, дефолт вычислен через `translate(DEFAULT_LANG, key)` (было RU, стало
 *  EN); `hotkeyActionLabel()` ниже — готовая точка для будущей языковой правки
 *  потребителя. */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";

export type HotkeyAction =
  | "playPause"
  | "next"
  | "prev"
  | "seekFwd"
  | "seekBack"
  | "like"
  | "mute"
  | "search"
  | "navBack"
  | "navForward";

/** Порядок = порядок в настройках и справке. */
export const HOTKEY_ACTIONS: { id: HotkeyAction; label: string }[] = [
  { id: "playPause", label: translate(DEFAULT_LANG, "media.hotkeys.actions.playPause") },
  { id: "next", label: translate(DEFAULT_LANG, "media.hotkeys.actions.next") },
  { id: "prev", label: translate(DEFAULT_LANG, "media.hotkeys.actions.prev") },
  { id: "seekFwd", label: translate(DEFAULT_LANG, "media.hotkeys.actions.seekFwd") },
  { id: "seekBack", label: translate(DEFAULT_LANG, "media.hotkeys.actions.seekBack") },
  { id: "like", label: translate(DEFAULT_LANG, "media.hotkeys.actions.like") },
  { id: "mute", label: translate(DEFAULT_LANG, "media.hotkeys.actions.mute") },
  { id: "search", label: translate(DEFAULT_LANG, "media.hotkeys.actions.search") },
  { id: "navBack", label: translate(DEFAULT_LANG, "media.hotkeys.actions.navBack") },
  { id: "navForward", label: translate(DEFAULT_LANG, "media.hotkeys.actions.navForward") },
];

/** Локализованная метка действия — для будущей правки потребителя (App.tsx/
 *  SettingsView.tsx, вне зоны этого набора файлов). */
export function hotkeyActionLabel(id: HotkeyAction, lang: Lang): string {
  return translate(lang, `media.hotkeys.actions.${id}`);
}

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  playPause: "Space",
  next: "Ctrl+ArrowRight",
  prev: "Ctrl+ArrowLeft",
  seekFwd: "ArrowRight",
  seekBack: "ArrowLeft",
  like: "KeyL",
  mute: "KeyM",
  search: "Ctrl+KeyK",
  navBack: "Alt+ArrowLeft",
  navForward: "Alt+ArrowRight",
};

/** Combo из события: модификаторы (кроме Meta) + физический код. Голые
 *  модификаторы (Control/Shift/Alt) сами по себе не combo (пропускаем). */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(e.code)) {
    return null;
  }
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (!e.code) return null;
  parts.push(e.code);
  return parts.join("+");
}

/** actionId по нажатой combo (учёт кастомных биндингов); null — не назначено. */
export function matchAction(combo: string, bindings: Record<HotkeyAction, string>): HotkeyAction | null {
  for (const { id } of HOTKEY_ACTIONS) {
    if (bindings[id] === combo) return id;
  }
  return null;
}

const CODE_LABEL: Record<string, string> = {
  Space: "Space",
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "⌫",
  Tab: "Tab",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Minus: "−",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
};

/** Один токен кода → человеку. KeyL→L, Digit3→3, F5→F5. */
function tokenLabel(token: string): string {
  if (CODE_LABEL[token]) return CODE_LABEL[token];
  if (token.startsWith("Key")) return token.slice(3);
  if (token.startsWith("Digit")) return token.slice(5);
  if (token === "Ctrl" || token === "Alt" || token === "Shift") return token;
  return token; // F1..F12 и прочее — как есть
}

/** Combo → «Ctrl + →» для отображения. */
export function formatCombo(combo: string): string {
  if (!combo) return "—";
  return combo.split("+").map(tokenLabel).join(" + ");
}

/** Слить сохранённые биндинги с дефолтами (новые действия не ломают старые prefs). */
export function withDefaults(saved?: Partial<Record<HotkeyAction, string>>): Record<HotkeyAction, string> {
  return { ...DEFAULT_HOTKEYS, ...(saved ?? {}) };
}

/** Печатает ли человек прямо сейчас — тогда клавиши плеера молчат.
 *  Вынесено из App.tsx (десктоп) в общий модуль: правило одно на оба клиента,
 *  иначе веб рано или поздно разъедется с приложением (пробел в поиске начал
 *  бы ставить музыку на паузу). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}
