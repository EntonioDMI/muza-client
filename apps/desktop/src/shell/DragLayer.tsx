import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@muza/ui";
import {
  DRAG_THRESHOLD,
  DROP_ATTR,
  HOLD_MS,
  dist,
  dropTargetAt,
  shouldStart,
  type DragPayload,
} from "../lib/dragEngine";

/** Живой слой внутреннего переноса: состояние + плавающее превью под курсором.
 *
 *  Заменяет HTML5-путь (lib/dnd.ts) ВНУТРИ приложения — см. шапку dragEngine.ts,
 *  там же граница с drag-out наружу (Alt+drag остаётся HTML5/Tauri).
 *
 *  Превью рендерится ЗДЕСЬ, а не в строке-источнике: строка живёт внутри
 *  скроллящегося списка с overflow, и любой position:fixed потомок был бы им
 *  обрезан. Слой висит на корне дерева Player, поверх всего. */

interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  /** id зоны под курсором (data-muza-drop) — для подсветки цели */
  over: string | null;
}

interface DragCtx {
  /** null — ничего не тащим */
  drag: DragState | null;
  /** Повесить на строку-источник: {...dragSource(payload)}. Вешать на ТОТ ЖЕ
   *  элемент, что несёт `draggable` — обработчик правит его draggable на лету
   *  (см. onPointerDown). */
  dragSource: (payload: DragPayload) => { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  /** Зарегистрировать зону приёма; onDrop зовётся, если отпустили над ней. */
  registerDrop: (id: string, onDrop: (p: DragPayload) => void) => () => void;
  /** Тащат ли что-то, что эта зона примет (для подсветки «сюда можно») */
  isOver: (id: string) => boolean;
}

const Ctx = createContext<DragCtx | null>(null);

export function useDrag(): DragCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDrag вне <DragLayer>");
  return c;
}

export function DragLayer({ children }: { children: ReactNode }) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const drops = useRef(new Map<string, (p: DragPayload) => void>());
  /** Состояние жеста ДО подъёма — в ref, чтобы не гонять ререндер на каждый
   *  pointermove: пока карточка не поднята, перерисовывать нечего. */
  const pending = useRef<{ payload: DragPayload; x0: number; y0: number; timer: number; pointerId: number } | null>(null);
  /** Идёт ли перенос ПРЯМО СЕЙЧАС, с точки зрения обработчиков указателя.
   *
   *  Ref, а не `drag`, и заполняется СИНХРОННО в lift/up — не рендером. Раньше
   *  здесь стояло `dragRef.current = drag` в теле компонента, то есть признак
   *  появлялся только после перерисовки. Между pointermove и pointerup её может
   *  не быть вовсе: React назначает рендер, а события идут дальше в том же кадре.
   *  Тогда up видел пустоту, выходил вхолостую и не снимал перенос — а рендер
   *  потом всё равно рисовал карточку, и она залипала на курсоре навсегда.
   *  Симптом владельца 16.07.2026: «перестал удерживать мышку, а она до сих пор
   *  на мышке». Держим только payload: координаты обработчики берут из события,
   *  а состояние для отрисовки живёт в `drag`. */
  const dragging = useRef<DragPayload | null>(null);

  const registerDrop = useCallback((id: string, onDrop: (p: DragPayload) => void) => {
    drops.current.set(id, onDrop);
    return () => {
      drops.current.delete(id);
    };
  }, []);

  const cancelPending = useCallback(() => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current = null;
    }
  }, []);

  const lift = useCallback((x: number, y: number) => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    // Ожидание закончено — карточка поднята. Оба перехода СИНХРОННЫ и не ждут
    // рендера: pending гасим, чтобы следующий pointermove не поднял ту же
    // карточку второй раз, а dragging поднимаем, чтобы pointerup в том же кадре
    // увидел живой перенос и смог его завершить.
    pending.current = null;
    dragging.current = p.payload;
    // Выделение текста здесь не гасим: оно выключено на :root в app.css. Ставить
    // user-select на body при подъёме было бесполезно — браузер начинает
    // выделять на pointerdown, до подъёма, а начатое выделение этот запрет уже
    // не отменяет.
    setDrag({ payload: p.payload, x, y, over: dropTargetAt(x, y)?.id ?? null });
  }, []);

  const dragSource = useCallback(
    (payload: DragPayload) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        // Два пути переноса физически несовместимы: как только браузер стартует
        // нативный HTML5-drag, он шлёт pointercancel и перестаёт слать
        // pointermove — pointer-жест умирает на середине. Поэтому native drag
        // разрешён РОВНО тогда, когда он нужен: Alt = вынести файл наружу
        // (dragOut.ts → Tauri). В остальных случаях draggable гасится ДО того,
        // как браузер решит начать drag (pointerdown приходит раньше dragstart),
        // и конфликта не возникает вовсе — а не «мы его потом отменили».
        // Значение переживает ререндер: React не трогает атрибут, пока не
        // меняется JSX-проп, а следующий pointerdown выставит его заново.
        e.currentTarget.draggable = e.altKey;
        if (!shouldStart(e)) return; // Alt → drag-out наружу, правая → меню
        cancelPending();
        const timer = window.setTimeout(() => {
          // держал HOLD_MS не двигаясь — поднимаем
          const p = pending.current;
          if (p) lift(p.x0, p.y0);
        }, HOLD_MS);
        pending.current = { payload, x0: e.clientX, y0: e.clientY, timer, pointerId: e.pointerId };
      },
    }),
    [cancelPending, lift],
  );

  // Слушаем на window, а не на строке: курсор уходит за её пределы сразу же.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (p && !dragging.current) {
        const d = dist(p.x0, p.y0, e.clientX, e.clientY);
        // Курсор поехал — это перенос, а не клик; таймер ждать незачем. Ниже
        // порога не делаем НИЧЕГО: жест ещё жив, решит либо следующий сдвиг,
        // либо HOLD_MS, либо pointerup (тогда это был клик). Отменять здесь
        // нельзя — именно отмена и убивала любой перенос живой мышью.
        if (d >= DRAG_THRESHOLD) lift(e.clientX, e.clientY);
        return;
      }
      if (!dragging.current) return;
      e.preventDefault();
      const over = dropTargetAt(e.clientX, e.clientY)?.id ?? null;
      setDrag((s) => (s ? { ...s, x: e.clientX, y: e.clientY, over } : s));
    };

    const up = (e: PointerEvent) => {
      cancelPending();
      const payload = dragging.current;
      if (!payload) return;
      dragging.current = null;
      const hit = dropTargetAt(e.clientX, e.clientY);
      const cb = hit ? drops.current.get(hit.id) : undefined;
      setDrag(null);
      // после setDrag(null): обработчик может открыть диалог/тост, и делать это
      // при живом состоянии переноса — значит показать их поверх превью
      if (cb) cb(payload);
    };

    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      cancelPending();
      if (!dragging.current) return;
      dragging.current = null;
      setDrag(null); // Esc отменяет перенос — как в любом менеджере файлов
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
  }, [cancelPending, lift]);

  const value = useMemo<DragCtx>(
    () => ({
      drag,
      dragSource,
      registerDrop,
      isOver: (id: string) => drag?.over === id,
    }),
    [drag, dragSource, registerDrop],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {drag ? <DragPreview state={drag} /> : null}
    </Ctx.Provider>
  );
}

/** Карточка под курсором. Держится на transform (композитится GPU, не вызывает
 *  layout на каждый кадр) и слегка наклонена — чтобы читалась как «поднятая»,
 *  а не как часть списка.
 *
 *  ⚠️ Материал — ТОЛЬКО размытие. `tokens/effects.css` запрещает прямым текстом:
 *  «NO box-shadows. NO glows. NO gradients. Blur is the only material». Здесь
 *  раньше были и рамка `1px solid var(--accent)` на принятии, и тень
 *  `0 12px 32px` — единственные во всём десктопе (проверено grep'ом), потому
 *  владелец их и заметил сразу, едва перенос начал работать. Приём показываем
 *  тем же языком, что и вся ДС: сменой иконки и масштабом («Press feedback —
 *  scale, no color flash»), не линией.
 *
 *  Фон — `--surface-4`, а не `--glass-panel`: последний завязан на ползунок
 *  прозрачности (App.tsx: `--glass-panel` из `prefs.glassOpacity`), и на нуле
 *  карточка стала бы невидимой. Зона может себе это позволить, движущийся
 *  объект — нет. */
function DragPreview({ state }: { state: DragState }) {
  const accepted = state.over !== null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        // -50%/-50% по Y даёт ощущение «схватил за то место, где держал»
        transform: `translate3d(${state.x + 14}px, ${state.y - 18}px, 0) rotate(${accepted ? -1.5 : -3}deg) scale(${accepted ? 1.06 : 1})`,
        zIndex: 300,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        maxWidth: 320,
        padding: "var(--sp-2) var(--sp-3)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-4)",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        transition: "transform 90ms var(--ease-out)",
        willChange: "transform",
      }}
    >
      {state.payload.cover ? (
        <img src={state.payload.cover} alt="" width={32} height={32} style={{ width: 32, height: 32, borderRadius: "var(--r-xs)", objectFit: "cover", flex: "none" }} />
      ) : (
        <span style={{ width: 32, height: 32, borderRadius: "var(--r-xs)", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name="music-2" size={16} color="var(--text-3)" />
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {state.payload.title}
        </span>
        {state.payload.artist ? (
          <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {state.payload.artist}
          </span>
        ) : null}
      </span>
      <Icon name={accepted ? "plus" : "grip-vertical"} size={16} color={accepted ? "var(--accent-text)" : "var(--text-3)"} style={{ flex: "none" }} />
    </div>
  );
}

/** Пропсы зоны приёма: {...dropZone(id)} + useDropZone(id, onDrop) для колбэка. */
export function dropZone(id: string): Record<string, string> {
  return { [DROP_ATTR]: id };
}

export function useDropZone(id: string | null, onDrop: (p: DragPayload) => void): { over: boolean; props: Record<string, string> } {
  const { registerDrop, isOver } = useDrag();
  const cb = useRef(onDrop);
  cb.current = onDrop;
  useEffect(() => {
    if (!id) return;
    return registerDrop(id, (p) => cb.current(p));
  }, [id, registerDrop]);
  return { over: id ? isOver(id) : false, props: id ? dropZone(id) : {} };
}
