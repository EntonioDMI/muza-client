import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../core/Icon.jsx";

/** Context / dropdown menu — frosted panel anchored at a point.
 *  Keyboard: focus jumps into the menu on open (and back on close),
 *  Arrows/Home/End walk items, Enter activates, Escape closes. */
export function Menu({ open, x = 0, y = 0, items = [], onClose }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && onClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // фокус: на открытии — в первый пункт, на закрытии — туда, откуда пришли
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const first = panelRef.current?.querySelector('[role="menuitem"]');
    if (first) first.focus();
    return () => {
      const el = restoreRef.current;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
    };
  }, [open]);

  const moveFocus = (delta, edge) => {
    const nodes = [...(panelRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    if (nodes.length === 0) return;
    if (edge === "first") { nodes[0].focus(); return; }
    if (edge === "last") { nodes[nodes.length - 1].focus(); return; }
    const i = nodes.indexOf(document.activeElement);
    nodes[(i + delta + nodes.length) % nodes.length].focus();
  };

  const onMenuKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
    else if (e.key === "Home") { e.preventDefault(); moveFocus(0, "first"); }
    else if (e.key === "End") { e.preventDefault(); moveFocus(0, "last"); }
    else if (e.key === "Tab") { e.preventDefault(); moveFocus(e.shiftKey ? -1 : 1); }
  };

  if (!open) return null;
  return (
    <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose && onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 150 }}>
      <div
        ref={panelRef}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onMenuKeyDown}
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
              onFocus={() => setHoverIdx(i)}
              onBlur={() => setHoverIdx(null)}
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
