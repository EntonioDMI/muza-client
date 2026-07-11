/** Единый список горячих клавиш: вкладка «Клавиши» в настройках и
 *  оверлей по «?» (UX-доводка) читают отсюда — списки не расходятся.
 *  Сами обработчики живут в App (hotkeysRef). */

export const HOTKEYS: { action: string; combo: string }[] = [
  { action: "Играть / пауза", combo: "Space" },
  { action: "Следующий трек", combo: "Ctrl + →" },
  { action: "Предыдущий трек", combo: "Ctrl + ←" },
  { action: "Перемотка +5 с", combo: "→" },
  { action: "Перемотка −5 с", combo: "←" },
  { action: "Лайк", combo: "L" },
  { action: "Без звука", combo: "M" },
  { action: "Поиск", combo: "Ctrl + K" },
  { action: "Закрыть очередь / оверлей", combo: "Esc" },
  { action: "Эта справка", combo: "?" },
];
