/** Множественное выделение (2026-07-20) — чистая математика, без React
 *  (образец — dragEngine.ts). Порядок id (order) приходит от списка-хозяина:
 *  диапазоны Shift считаются по нему, а не по DOM.
 *
 *  Жесты (решение владельца 20.07 — ОБА пути):
 *  - без режима: Ctrl+клик — точечно, Shift+клик — диапазон от якоря;
 *    обычный клик списку не принадлежит (click() → null — «жест не про нас»);
 *  - режим (mode, вход из контекстного меню «Выбрать…»): обычный клик ТОЖЕ
 *    выделяет — как «выбрать плейлисты» в мобильных приложениях.
 *  Отдельного переключателя режима в UI нет: режим гаснет вместе с
 *  выделением (Esc / «Снять выделение»). */

export interface SelectionState {
  ids: string[];
  /** Последний точечный клик — начало Shift-диапазона. */
  anchor: string | null;
  /** «Режим выбора»: обычный клик выделяет. */
  mode: boolean;
}

export const EMPTY: SelectionState = { ids: [], anchor: null, mode: false };

export function isSelected(s: SelectionState, id: string): boolean {
  return s.ids.includes(id);
}

/** Диапазон по порядку списка, границы включительно, направление любое. */
export function rangeIds(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i === -1 || j === -1) return [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Клик по элементу. null — жест не про выделение (обычный клик без режима):
 *  список делает своё обычное дело (играть/открыть).
 *  Shift-диапазон ЗАМЕНЯЕТ выделение и не двигает якорь — последовательные
 *  Shift-клики переигрывают диапазон от того же якоря (поведение проводника). */
export function click(
  s: SelectionState,
  order: string[],
  id: string,
  mods: { ctrl: boolean; shift: boolean },
): SelectionState | null {
  if (mods.shift) {
    const from = s.anchor ?? order[0];
    if (from === undefined) return null;
    return { ...s, ids: rangeIds(order, from, id) };
  }
  if (mods.ctrl || s.mode) {
    const has = s.ids.includes(id);
    return { ...s, ids: has ? s.ids.filter((x) => x !== id) : [...s.ids, id], anchor: id };
  }
  return null;
}

export function selectAll(s: SelectionState, order: string[]): SelectionState {
  return { ...s, ids: [...order], anchor: order[0] ?? null };
}

export function enterMode(s: SelectionState): SelectionState {
  return { ...s, mode: true };
}

/** Список перечитан — выкинуть исчезнувшие id; тот же объект, если ничего
 *  не пропало (лишний setState не будит рендер). */
export function prune(s: SelectionState, order: string[]): SelectionState {
  if (s.ids.length === 0) return s;
  const live = new Set(order);
  const ids = s.ids.filter((id) => live.has(id));
  if (ids.length === s.ids.length) return s;
  return { ...s, ids, anchor: s.anchor !== null && live.has(s.anchor) ? s.anchor : null };
}
