import React from "react";
import { Icon } from "../core/Icon.jsx";

/** Toast — quiet frosted pill; slides up, never stacks more than one. */
export function Toast({ open, message, icon, style }) {
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
        pointerEvents: "none",
        transition: "opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={18} color="var(--accent-text)" /> : null}
      {message}
    </div>
  );
}
