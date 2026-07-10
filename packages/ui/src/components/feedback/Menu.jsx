import React, { useEffect, useState } from "react";
import { Icon } from "../core/Icon.jsx";

/** Context / dropdown menu — frosted panel anchored at a point. */
export function Menu({ open, x = 0, y = 0, items = [], onClose }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && onClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose && onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 150 }}>
      <div
        role="menu"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          left: x,
          top: y,
          minWidth: 220,
          padding: "var(--sp-2)",
          borderRadius: "var(--r-md)",
          background: "var(--glass-panel)",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          animation: "muzaMenuIn var(--dur-fast) var(--ease-out)",
        }}
      >
        <style>{"@keyframes muzaMenuIn{from{opacity:0;transform:translateY(6px) scale(.98)}}@media (prefers-reduced-motion: reduce){[role=menu]{animation:none!important}}"}</style>
        {items.map((it, i) =>
          it === "-" ? (
            <div key={i} aria-hidden="true" style={{ height: 1, flex: "none", background: "var(--surface-3)", margin: "var(--sp-1) var(--sp-2)" }}></div>
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => { if (it.onClick) it.onClick(); if (onClose) onClose(); }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                height: 42,
                padding: "0 var(--sp-3)",
                border: "none",
                borderRadius: "var(--r-xs)",
                background: hoverIdx === i ? "var(--surface-3)" : "transparent",
                color: it.danger ? "var(--danger)" : hoverIdx === i ? "var(--text-1)" : "var(--text-2)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-body)",
                fontWeight: "var(--fw-medium)",
                cursor: "pointer",
                textAlign: "left",
                transition: "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
              }}
            >
              {it.icon ? <Icon name={it.icon} size={18} /> : null}
              {it.label}
            </button>
          )
        )}
      </div>
    </div>
  );
}
