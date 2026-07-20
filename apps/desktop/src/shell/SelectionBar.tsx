import { IconButton } from "@muza/ui";

/** Плавающая панель массовых действий (2026-07-20): живёт при непустом
 *  выделении. fixed низ-центр над плеер-баром; zIndex 85 — ПОД тостом (90),
 *  они складываются стопкой, тост поверх. Каждый список рендерит СВОЮ панель
 *  со своим набором действий — четыре списка никогда не выделены
 *  одновременно, общий стор был бы скоупом ради скоупа. */
export function SelectionBar({
  label,
  actions,
  onClear,
  clearLabel,
}: {
  /** «Выбрано: 3» — собирает вызыватель через t. */
  label: string;
  actions: { icon: string; label: string; onClick: () => void; danger?: boolean }[];
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-testid="selection-bar"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
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
        animation: "muzaMenuIn var(--dur-fast) var(--ease-out)",
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
        {label}
      </span>
      {actions.map((a) => (
        <IconButton
          key={a.label}
          icon={a.icon}
          size="sm"
          label={a.label}
          onClick={a.onClick}
          style={a.danger ? { color: "var(--danger)" } : undefined}
        />
      ))}
      <IconButton icon="x" size="sm" label={clearLabel} onClick={onClear} />
    </div>
  );
}
