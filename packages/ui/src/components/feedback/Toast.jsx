import React from "react";
import { Icon } from "../core/Icon.jsx";

/** Toast — quiet frosted pill; slides up, never stacks more than one.
 *  Optional action (undo etc.): actionLabel + onAction render a button —
 *  the pill becomes interactive while open. */
export function Toast({ open, message, icon, actionLabel, onAction, style }) {
  const interactive = open && actionLabel && onAction;
  return (
    <div
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 48,
        padding: "0 var(--sp-5)",
        borderRadius: "var(--r-pill)",
        background: "var(--glass-panel)",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        color: "var(--text-1)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        fontWeight: "var(--fw-medium)",
        whiteSpace: "nowrap",
        opacity: open ? 1 : 0,
        transform: open ? "translateY(0)" : "translateY(12px)",
        pointerEvents: interactive ? "auto" : "none",
        transition: "opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={18} color="var(--accent-text)" /> : null}
      {message}
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          style={{
            border: "none",
            background: "var(--surface-3)",
            color: "var(--accent-text)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            fontWeight: "var(--fw-semibold)",
            borderRadius: "var(--r-pill)",
            padding: "6px 12px",
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
