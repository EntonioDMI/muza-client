import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY, click, enterMode, prune, selectAll, type SelectionState } from "./selection";

/** Обвязка выделения для ОДНОГО списка (математика — lib/selection.ts).
 *
 *  Переехало из apps/desktop/src/lib/useMultiSelect.ts (Э3 веб-паритета,
 *  2026-08-02) вместе с панелью очереди. Хук знает только про window и
 *  клавиатуру — ни Tauri, ни Next в нём нет, обе программы живут с ним
 *  одинаково. На старом месте пенёк-ре-экспорт.
 *
 *  Esc (снять) и Ctrl+A (выделить всё) слушаются самим хуком, но только пока
 *  выделение живо или включён режим: несколько списков на экране (страница
 *  плейлиста + панель очереди) не дерутся за горячие клавиши — отвечает тот,
 *  чьё выделение активно. Вход «с нуля» — всегда Ctrl/Shift-клик или пункт
 *  меню, не Ctrl+A. Ctrl+A — по e.code: раскладка (KeyA/«Ф») не важна. */
export interface MultiSelect {
  ids: string[];
  count: number;
  /** Есть выделение ИЛИ включён режим — спутник панели действий и кликов. */
  active: boolean;
  mode: boolean;
  has: (id: string) => boolean;
  /** true — клик съеден выделением; обычное действие списка не выполнять. */
  onItemClick: (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => boolean;
  selectAll: () => void;
  enterMode: () => void;
  clear: () => void;
}

/** Разделитель ключа списка — нулевой символ: такого не бывает внутри id, —
 *  иначе два разных списка склеились бы в одну строку и «список перечитали»
 *  не сработало бы (["a b"] и ["a","b"] дали бы один ключ).
 *
 *  ⚠️ Записан ЭКРАНИРОВАННО намеренно (чистка 2026-08-02): раньше здесь стоял
 *  сырой байт 0x00 прямо в исходнике — невидимая мина. Любой инструмент,
 *  «чистящий» управляющие символы (редактор, линтер, копипаста через буфер),
 *  тихо заменил бы его на пробел и сломал бы сравнение списков. Поведение от
 *  этой записи не меняется — это тот же символ. */
const KEY_SEP = "\u0000";

export function useMultiSelect(order: string[]): MultiSelect {
  const [state, setState] = useState<SelectionState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const orderRef = useRef(order);
  orderRef.current = order;

  // список перечитали → выкинуть исчезнувшие id, иначе массовое действие
  // применилось бы к трекам, которых больше нет (тот же приём, что гашение
  // живого переноса при смене списка в useLocalReorder)
  const orderKey = order.join(KEY_SEP);
  useEffect(() => {
    setState((s) => prune(s, orderRef.current));
  }, [orderKey]);

  const active = state.ids.length > 0 || state.mode;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") {
        // Пометка «событие взято» — по ней режим правки вида не выходит заодно
        // со снятием выделения (см. shell/LookEditLayer.tsx).
        e.preventDefault();
        setState(EMPTY);
      } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyA") {
        e.preventDefault();
        setState((s) => selectAll(s, orderRef.current));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const onItemClick = useCallback<MultiSelect["onItemClick"]>((id, e) => {
    const next = click(stateRef.current, orderRef.current, id, {
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
    });
    if (next === null) return false;
    setState(next);
    return true;
  }, []);

  return {
    ids: state.ids,
    count: state.ids.length,
    active,
    mode: state.mode,
    has: (id) => state.ids.includes(id),
    onItemClick,
    selectAll: () => setState((s) => selectAll(s, orderRef.current)),
    enterMode: () => setState((s) => enterMode(s)),
    clear: () => setState(EMPTY),
  };
}
