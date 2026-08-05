import { useRef } from "react";
import { IconButton, useLayerState } from "@muza/ui";

/** Плавающая панель массовых действий (2026-07-20): живёт при непустом
 *  выделении. fixed низ-центр над плеер-баром; zIndex 85 — ПОД тостом (90),
 *  они складываются стопкой, тост поверх. Каждый список рендерит СВОЮ панель
 *  со своим набором действий — четыре списка никогда не выделены
 *  одновременно, общий стор был бы скоупом ради скоупа.
 *
 *  Переехало из apps/desktop/src/shell/SelectionBar.tsx (Э3 веб-паритета,
 *  2026-08-02) БЕЗ единой правки кода: панель ничего не знает ни про Tauri,
 *  ни про площадку — только подписи и колбэки от вызывателя. На старом месте
 *  пенёк-ре-экспорт (потребители — QueuePanel и три экрана приложения).
 *
 *  ⚠️ УХОД БЫВАЕТ ТОЛЬКО У ТЕХ, КТО ПЕРЕДАЁТ `open` (2026-08-05). Панель — слой
 *  .muza-layer и умеет уезжать вниз, но снять себя с экрана она может только
 *  сама: вызыватель, который по-прежнему пишет `count > 0 ? <SelectionBar/> :
 *  null`, вырывает узел кадром, и уходить нечему. Такой вызыватель ничего не
 *  теряет по сравнению с прошлым поведением — но и не выигрывает.
 *
 *  ⚠️ ЦЕНТРИРОВАНИЕ — РАСКЛАДКОЙ, НЕ TRANSFORM'ом (починка 2026-08-05). Было
 *  left:50% + transform:translateX(-50%), и кадр входа (translateY(6px)) бил
 *  по тому же единственному свойству transform, перебивая центровку целиком:
 *  панель на КАЖДОМ появлении въезжала справа вместо всплытия по центру. У
 *  слоя transform занят позой и в открытом состоянии равен none — делить его
 *  не с чем, поэтому центровка уехала в left/right/margin. */
export function SelectionBar({
  open = true,
  label,
  actions,
  onClear,
  clearLabel,
}: {
  /** Нет — панель считается открытой всегда (старый контракт: вызыватель
   *  монтирует её условием и уход не играет). */
  open?: boolean;
  /** «Выбрано: 3» — собирает вызыватель через t. */
  label: string;
  actions: { icon: string; label: string; onClick: () => void; danger?: boolean }[];
  onClear: () => void;
  clearLabel: string;
}) {
  const { mounted, layerProps } = useLayerState(open);
  // Пока панель уезжает, выделение у вызывателя уже пусто: «Выбрано: 0» и
  // осыпавшийся ряд кнопок успели бы моргнуть на затухающем кадре. Держим
  // последний вид, который панель имела открытой, — уходит ровно то, что было.
  const lastOpenView = useRef({ label, actions, clearLabel });
  if (open) lastOpenView.current = { label, actions, clearLabel };
  const view = open ? { label, actions, clearLabel } : lastOpenView.current;

  if (!mounted) return null;
  return (
    <div
      {...layerProps}
      role="toolbar"
      aria-label={view.label}
      data-testid="selection-bar"
      className="muza-layer"
      style={{
        position: "fixed",
        // пара left/right + margin:auto = центр по горизонтали, transform свободен;
        // fit-content вдобавок прижимает панель к ширине содержимого, но не шире окна
        left: 0,
        right: 0,
        width: "fit-content",
        margin: "0 auto",
        bottom: "calc(var(--h-playerbar) + 2 * var(--gap-zone, 16px))",
        zIndex: 85,
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "var(--sp-2) var(--sp-4)",
        borderRadius: "var(--r-lg)",
        background: "var(--glass-panel)",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        // Уходящая панель ещё ~120 мс висит поверх списка, по которому в неё и
        // выделяли. inert из layerProps убирает её из хит-теста в браузере,
        // pointer-events делает то же самое свойством — проверяемо и в jsdom,
        // где inert не реализован вовсе.
        pointerEvents: mounted && !open ? "none" : undefined,
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-body)",
          fontWeight: "var(--fw-medium)",
          color: "var(--text-1)",
          marginRight: "var(--sp-2)",
          whiteSpace: "nowrap",
        }}
      >
        {view.label}
      </span>
      {view.actions.map((a) => (
        <IconButton
          key={a.label}
          icon={a.icon}
          size="sm"
          label={a.label}
          onClick={a.onClick}
          style={a.danger ? { color: "var(--danger)" } : undefined}
        />
      ))}
      <IconButton icon="x" size="sm" label={view.clearLabel} onClick={onClear} />
    </div>
  );
}
