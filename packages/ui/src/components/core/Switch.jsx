import React from "react";

/** Toggle switch — accent when on, surface track when off. No borders. */
export function Switch({ checked = false, onChange, disabled = false, label, style }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange && onChange(!checked)}
      style={{
        position: "relative",
        width: 46,
        height: 28,
        flex: "none",
        border: "none",
        borderRadius: "var(--r-pill)",
        background: checked ? "var(--accent)" : "var(--surface-4)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background var(--dur-base) var(--ease-out)",
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 4,
          left: checked ? 22 : 4,
          width: 20,
          height: 20,
          borderRadius: "var(--r-pill)",
          background: "var(--text-1)",
          transition: "left var(--dur-base) var(--ease-out)",
        }}
      ></span>
    </button>
  );
}
