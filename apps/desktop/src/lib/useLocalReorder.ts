/** Локальный реордер списка/сетки: тащится САМА плашка, а не превью-карточка.
 *
 *  Чем отличается от глобального DragLayer и почему не он:
 *  DragLayer — про перенос МЕЖДУ областями (трек → плейлист): под курсором
 *  плавает отдельная карточка-превью, а исходная строка стоит на месте.
 *  Владелец для реордера плейлистов попросил обратное (2026-07-16): плашка
 *  следует за мышкой «настолько, насколько может в рамках ограниченной ей
 *  области», соседи раздвигаются, показывая будущий порядок, и НИКАКИХ
 *  переносов между областями — сайдбар реордерится в сайдбаре, медиатека в
 *  медиатеке. Жест тот же, что у DragLayer (HOLD_MS/DRAG_THRESHOLD/Escape),
 *  чтобы рука не различала «какой это из drag'ов».
 *
 *  Механика: на подъёме один раз снимаются прямоугольники всех элементов
 *  (СТАТИЧНЫЕ — transform входит в getBoundingClientRect, живой пересчёт
 *  раскачивал бы сам себя, см. PlaylistView); тащимый получает transform по
 *  дельте курсора с клампом в габарит области (clampShift/unionBox), соседи —
 *  reorderOffset до прямоугольника своей будущей позиции. Отпустили — commit
 *  splice-индексом, Escape — отмена. Чистая геометрия — в dragEngine.ts. */

import { useCallback, useEffect, useRef, useState } from "react";
import { cssZoom } from "@muza/ui";
import {
  DRAG_THRESHOLD,
  HOLD_MS,
  clampShift,
  dist,
  reorderOffset,
  shouldStart,
  unionBox,
  type Box,
} from "./dragEngine";

interface DragState {
  id: string;
  from: number;
  /** Splice-индекс будущей позиции (термины массива после удаления from). */
  to: number;
  /** Клампнутая дельта курсора от точки захвата — transform тащимой плашки. */
  dx: number;
  dy: number;
  /** Фаза посадки: плашку отпустили, она ДОЕЗЖАЕТ до слота с transition —
   *  без неё плашка телепортировалась в слот рывком (жалоба 2026-07-17). */
  settling?: boolean;
}

/** Длительность посадки: transition соседей (160мс) + кадр запаса — коммит
 *  порядка происходит, когда всё уже видимо стоит по местам. */
const SETTLE_MS = 180;

export interface LocalReorder {
  /** id тащимого элемента; null — реордер не идёт. */
  draggingId: string | null;
  /** Плашку отпустили и она доезжает до слота — тащимой нужен transition. */
  settling: boolean;
  /** Повесить на ручку элемента: {...grip(id)}. */
  grip: (id: string) => { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  /** Ref-колбэк на ОБЁРТКУ элемента (то, что двигается transform'ом). */
  itemRef: (id: string) => (el: HTMLElement | null) => void;
  /** Transform элемента во время реордера; null — не идёт (сбросить стиль). */
  shiftFor: (id: string) => { x: number; y: number } | null;
}

export function useLocalReorder({
  ids,
  resolveTo,
  onCommit,
}: {
  /** Порядок элементов — ровно тот, что на экране. */
  ids: readonly string[];
  /** Куда встанет плашка: splice-индекс из статичных rects и позиции курсора
   *  (столбец — insertionIndex по Y, сетка — gridInsertionIndex). */
  resolveTo: (rects: readonly Box[], from: number, x: number, y: number) => number;
  onCommit: (id: string, toIndex: number) => void;
}): LocalReorder {
  const els = useRef(new Map<string, HTMLElement>());
  const rectsRef = useRef<Box[]>([]);
  const boundsRef = useRef<Box | null>(null);
  /** Экранные пиксели → зум-единицы transform'а: вся геометрия (rects, clientX)
   *  экранная, а transform внутри зумленного корня (prefs.uiScale) движок
   *  умножает на zoom — выдаваемые сдвиги делим, иначе плашка обгоняет мышку. */
  const zoomRef = useRef(1);
  const pending = useRef<{ id: string; x0: number; y0: number; timer: number } | null>(null);
  /** Синхронный признак живого переноса для up-обработчика: setState не успевает
   *  между pointermove и pointerup в одном кадре (та же гоча, что в DragLayer). */
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const resolveRef = useRef(resolveTo);
  resolveRef.current = resolveTo;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  /** Точка захвата переживает pending (нужна и после lift — дельта курсора). */
  const pendingStart = useRef<{ x0: number; y0: number }>({ x0: 0, y0: 0 });

  const cancelPending = useCallback(() => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current = null;
    }
  }, []);

  /** Таймер посадки: пока он жив, новый захват не стартует (180мс). */
  const settleTimer = useRef<number | null>(null);

  const settle = useCallback((d: DragState, target: { x: number; y: number }) => {
    setDrag({ ...d, dx: target.x, dy: target.y, settling: true });
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      setDrag(null);
      if (d.to !== d.from) commitRef.current(d.id, d.to);
    }, SETTLE_MS);
  }, []);

  const lift = useCallback((x: number, y: number) => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    const list = idsRef.current;
    const from = list.indexOf(p.id);
    if (from < 0) return;
    // Прямоугольники — ОДИН раз на подъёме, до любых transform'ов.
    const rects = list.map((id) => {
      const el = els.current.get(id);
      const r = el?.getBoundingClientRect();
      return { top: r?.top ?? 0, left: r?.left ?? 0, right: r?.right ?? 0, bottom: r?.bottom ?? 0 };
    });
    rectsRef.current = rects;
    boundsRef.current = unionBox(rects);
    zoomRef.current = cssZoom(els.current.get(p.id) ?? null);
    const shift = clampShift(rects[from], boundsRef.current, x - p.x0, y - p.y0);
    const next: DragState = { id: p.id, from, to: from, dx: shift.x, dy: shift.y };
    dragRef.current = next;
    setDrag(next);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (p && !dragRef.current) {
        if (dist(p.x0, p.y0, e.clientX, e.clientY) >= DRAG_THRESHOLD) lift(e.clientX, e.clientY);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const start = pendingStart.current;
      const shift = clampShift(
        rectsRef.current[d.from],
        boundsRef.current ?? rectsRef.current[d.from],
        e.clientX - start.x0,
        e.clientY - start.y0,
      );
      const to = resolveRef.current(rectsRef.current, d.from, e.clientX, e.clientY);
      const next = { ...d, dx: shift.x, dy: shift.y, to };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      cancelPending();
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null; // курсор больше не рулит — началась посадка
      // Плашка ДОЕЗЖАЕТ до своего слота (rects[to] — финальная ячейка и есть),
      // и только когда встала — коммитим порядок: DOM пересобирается в той же
      // геометрии, глазу не видно подмены. Без посадки был рывок на место.
      settle(d, {
        x: rectsRef.current[d.to].left - rectsRef.current[d.from].left,
        y: rectsRef.current[d.to].top - rectsRef.current[d.from].top,
      });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      cancelPending();
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      // Esc отменяет — плашка так же плавно возвращается на исходное место
      settle({ ...d, to: d.from }, { x: 0, y: 0 });
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
    };
  }, [cancelPending, lift, settle]);

  // Список сменился под живым переносом (перечитка с сервера) — переносу
  // больше нечего двигать честно; тихо отменяем.
  useEffect(() => {
    if (dragRef.current && !ids.includes(dragRef.current.id)) {
      dragRef.current = null;
      setDrag(null);
    }
  }, [ids]);

  const grip = useCallback(
    (id: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (!shouldStart(e)) return; // Alt/Ctrl/правая — не наш жест
        // Прошлая плашка ещё доезжает до слота — rects сейчас врут, ждём коммита
        if (dragRef.current || settleTimer.current) return;
        cancelPending();
        pendingStart.current = { x0: e.clientX, y0: e.clientY };
        const timer = window.setTimeout(() => {
          const p = pending.current;
          if (p) lift(p.x0, p.y0); // держал не двигаясь — поднимаем
        }, HOLD_MS);
        pending.current = { id, x0: e.clientX, y0: e.clientY, timer };
      },
    }),
    [cancelPending, lift],
  );

  const itemRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) els.current.set(id, el);
      else els.current.delete(id);
    },
    [],
  );

  const shiftFor = useCallback(
    (id: string) => {
      if (!drag) return null;
      const z = zoomRef.current;
      if (id === drag.id) return { x: drag.dx / z, y: drag.dy / z };
      const i = idsRef.current.indexOf(id);
      if (i < 0) return null;
      const o = reorderOffset(rectsRef.current, drag.from, drag.to, i);
      return { x: o.x / z, y: o.y / z };
    },
    [drag],
  );

  return { draggingId: drag?.id ?? null, settling: drag?.settling ?? false, grip, itemRef, shiftFor };
}
