/** ПЕРЕТАСКИВАНИЕ ЭЛЕМЕНТОВ В РЕЖИМЕ ПРАВКИ ВИДА (Ctrl+E).
 *
 *  ЗАЧЕМ. Дословная претензия владельца 04.08: «неприятно, что Ctrl+E не меняет
 *  абсолютно все… я хочу поменять расположение Home, Search, Library, Stats —
 *  просто поменять их местами; кто-то любит, когда поиск стоит первым». Режим
 *  правки умел тянуть только края зон (LookEditLayer.tsx) — то есть менял
 *  РАЗМЕРЫ, но не ПОРЯДОК, хотя рука в этом режиме уже настроена хватать.
 *
 *  ГЛАВНОЕ ОГРАНИЧЕНИЕ, тоже дословно: «только так, чтобы не переделывать
 *  иерархию — пункты не могут быть ниже или выше, они просто могут меняться
 *  между собой местами». Поэтому здесь НЕТ переноса между группами вообще:
 *  каждая группа знает свой список ключей и переставляет только внутри него.
 *  Ровно та же граница, что у реордера плейлистов (useLocalReorder): «сайдбар
 *  реордерится в сайдбаре, медиатека в медиатеке».
 *
 *  ПОЧЕМУ НЕ НОВЫЙ ДВИЖОК. Жест уже написан и обкатан на плейлистах:
 *  lib/useLocalReorder.ts тащит САМУ плашку, соседи разъезжаются transform'ом,
 *  геометрия снимается один раз на подъёме, курсор считается через cssZoom.
 *  Второй такой движок разошёлся бы с первым на первой же правке — здесь
 *  только обвязка: гейт по режиму правки, клавиатура и общий стек отмены.
 *
 *  ЧТО ЗДЕСЬ ЗА ПРИЗНАК РЕЖИМА. `active` приходит контекстом, а не пропсом,
 *  сознательно: режим правки — состояние ВСЕГО окна, и протаскивать булев флаг
 *  через пять слоёв пропсов ради него значило бы расписать одно знание по
 *  всему дереву. Данные (какой порядок и куда его писать) остаются пропсами —
 *  их у каждой группы свои. У веба провайдера нет вовсе: контекст отдаёт
 *  active=false, и ни один обработчик не вешается.
 *
 *  СТЕК ОТМЕНЫ ОДИН НА РЕЖИМ. Он живёт в провайдере, а не в слое ручек: Ctrl+Z
 *  обязан одинаково откатывать и «потянул край сайдбара», и «переставил
 *  вкладки». Кто коммитит порядок, тот и кладёт снимок ПРЕЖНЕГО значения
 *  pushUndo() — хук о форме Prefs не знает и знать не должен. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { gridInsertionIndex, insertionIndex, moveItem } from "../lib/dragEngine";
import { useLocalReorder } from "../lib/useLocalReorder";
import type { Prefs } from "../prefs/types";

export interface LookEditApi {
  /** Режим правки включён — только тогда элементы становятся хватаемыми. */
  active: boolean;
  /** Положить снимок ПРЕЖНИХ значений в общий стек отмены (Ctrl+Z). */
  pushUndo: (before: Partial<Prefs>) => void;
  /** Снять последний снимок. Зовёт только слой ручек по Ctrl+Z. */
  popUndo: () => Partial<Prefs> | undefined;
}

const NO_LOOK_EDIT: LookEditApi = {
  active: false,
  pushUndo: () => undefined,
  popUndo: () => undefined,
};

const Ctx = createContext<LookEditApi>(NO_LOOK_EDIT);

/** Признак режима правки и общий стек отмены. Вне провайдера (веб, тесты
 *  отдельных экранов) — «режим выключен», и вся обвязка молча выключается. */
export function useLookEdit(): LookEditApi {
  return useContext(Ctx);
}

/** Сколько шагов помним. Стек — страховка дрогнувшей руки, а не история
 *  версий: сотни шагов назад никто не отматывает, а память они держат. */
const UNDO_LIMIT = 64;

export function LookEditProvider({
  active,
  apiRef,
  children,
}: {
  active: boolean;
  /** Тот же приём, что у провайдера меню в App.tsx: сам провайдер стоит ВЫШЕ
   *  того, кто его заводит, поэтому хуком до него не дотянуться — а класть
   *  снимок в стек отмены нужно и там (перестановка полок Главной живёт в
   *  App.tsx). Ссылка отдаёт ровно тот же api, что и useLookEdit(). */
  apiRef?: { current: LookEditApi | null };
  children: ReactNode;
}) {
  const stack = useRef<Partial<Prefs>[]>([]);

  // Вышел из режима — стек пуст. Иначе Ctrl+Z, нажатый в следующем заходе,
  // отматывал бы правку, сделанную полчаса назад и уже забытую: до этой
  // правки стек жил в самом слое ручек и умирал вместе с ним, и это
  // поведение менять незачем.
  useEffect(() => {
    if (!active) stack.current = [];
  }, [active]);

  const value = useMemo<LookEditApi>(
    () => ({
      active,
      pushUndo: (before) => {
        stack.current.push(before);
        if (stack.current.length > UNDO_LIMIT) stack.current.shift();
      },
      popUndo: () => stack.current.pop(),
    }),
    [active],
  );

  if (apiRef) apiRef.current = value;

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Пропсы на обёртку элемента группы. Стиль отдаётся ОТДЕЛЬНО и его надо
 *  слить со своим: `<div {...p} style={{ ...своё, ...p.style }} />` — иначе
 *  спред затрёт стиль самого элемента.
 *
 *  ⚠️ ЗДЕСЬ НЕТ И НЕ ДОЛЖНО БЫТЬ transform/transition/zIndex. Движение
 *  перестановки движок пишет в DOM напрямую, чтобы не платить ререндером за
 *  каждый кадр (см. шапку lib/useLocalReorder.ts). Вернуть их в JSX — значит
 *  начать стирать чужие записи через кадр. */
export interface LookItemProps {
  ref: (el: HTMLElement | null) => void;
  style: CSSProperties;
  tabIndex?: number;
  "aria-label"?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  onClickCapture?: (e: React.MouseEvent<HTMLElement>) => void;
}

export interface LookReorderGroup {
  /** Режим правки включён И группе есть что переставлять. */
  active: boolean;
  /** ПОРЯДОК КЛЮЧЕЙ ДЛЯ ОТРИСОВКИ. Вне жеста совпадает с переданным `ids`, во
   *  время жеста показывает будущий порядок — перестановка видна СРАЗУ, а не
   *  после отпускания. Раскладывать свои элементы по нему обязательно
   *  (pickByOrder из lib/dragEngine). */
  order: readonly string[];
  /** id элемента под пальцем; null — жест не идёт. */
  draggingId: string | null;
  itemProps: (id: string) => LookItemProps;
}

export function useLookReorder({
  ids,
  axis,
  onReorder,
  labelOf,
}: {
  /** Ключи элементов В ТОМ ПОРЯДКЕ, В КАКОМ ОНИ НА ЭКРАНЕ. */
  ids: readonly string[];
  /** Столбец (вкладки, полки, блоки лентой) или сетка (карточки настроек). */
  axis: "column" | "grid";
  /** Новый порядок целиком. Зовущий обязан ПЕРЕД записью положить прежнее
   *  значение в стек отмены — pushUndo() из useLookEdit(). Нет обработчика —
   *  группа не переставляется вовсе (у веба так и есть). */
  onReorder?: (next: string[]) => void;
  /** Имя элемента: обёртке-<div> без него нечем представиться скринридеру. */
  labelOf?: (id: string) => string;
}): LookReorderGroup {
  const look = useLookEdit();
  const on = look.active && !!onReorder && ids.length > 1;

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const commitRef = useRef(onReorder);
  commitRef.current = onReorder;

  const reorder = useLocalReorder({
    ids,
    resolveTo: (rects, from, x, y) =>
      axis === "grid" ? gridInsertionIndex(rects, from, x, y) : insertionIndex(rects, from, y),
    onCommit: (id, to) => {
      const list = idsRef.current;
      const from = list.indexOf(id);
      if (from < 0) return;
      commitRef.current?.(moveItem(list, from, to));
    },
  });

  /** Перестановка с соседом — клавиатурный эквивалент жеста. Без неё функция
   *  недоступна всем, кто не берёт мышь: держать её «на потом» нельзя, потому
   *  что порядок вкладок — это навигация. */
  const swap = useCallback((id: string, delta: -1 | 1) => {
    const list = idsRef.current;
    const from = list.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    commitRef.current?.(moveItem(list, from, to));
  }, []);

  const itemProps = useCallback(
    (id: string): LookItemProps => {
      const dragged = on && reorder.draggingId === id;
      // Ключи добавляются ПО ОДНОМУ, а не объектным литералом с undefined:
      // спред `{...своё, ...look.style}` копирует ключ и со значением
      // undefined, и такой стиль стирал бы у пункта его собственный transition
      // фона. Здесь чего нет — того нет вовсе.
      const style: CSSProperties = {};
      if (on) {
        style.cursor = dragged ? "grabbing" : "grab";
        // Палец обязан таскать элемент, а не прокручивать под ним экран.
        style.touchAction = "none";
        style.userSelect = "none";
        style.WebkitUserSelect = "none";
      }
      if (!on) return { ref: reorder.itemRef(id), style };
      return {
        ref: reorder.itemRef(id),
        style,
        tabIndex: 0,
        "aria-label": labelOf?.(id),
        onPointerDown: reorder.grip(id).onPointerDown,
        onKeyDown: (e) => {
          const back = axis === "grid" ? "ArrowLeft" : "ArrowUp";
          const fwd = axis === "grid" ? "ArrowRight" : "ArrowDown";
          if (e.key !== back && e.key !== fwd) return;
          // stopPropagation обязателен: под слоем живое приложение со своими
          // сочетаниями, и стрелка в режиме правки не должна заодно листать
          // очередь или перематывать трек.
          e.preventDefault();
          e.stopPropagation();
          swap(id, e.key === back ? -1 : 1);
        },
        // В режиме правки клик НЕ делает то, что делал: вкладка не уводит на
        // экран, карточка настроек не открывает раздел. Гасим на захвате —
        // обработчик самого элемента до вызова не доходит. Вне режима этого
        // обработчика нет вовсе, и клик работает как всегда.
        onClickCapture: (e) => {
          e.preventDefault();
          e.stopPropagation();
        },
      };
    },
    [axis, labelOf, on, reorder, swap],
  );

  return {
    active: on,
    // Вне режима правки предпросмотра быть не может — отдаём исходный порядок
    // как есть, чтобы экран не зависел от состояния выключенного жеста.
    order: on ? reorder.order : ids,
    draggingId: on ? reorder.draggingId : null,
    itemProps,
  };
}
