import React, { useEffect, useRef } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Modal dialog — frosted glass panel over a deep scrim. Use sparingly.
 *  Focus: jumps inside on open (first field or button), Tab loops within,
 *  Escape closes, focus returns to the opener on close. */
export function Dialog({ open, title, children, actions, onClose, width = 440 }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && onClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // фокус внутрь при открытии (первое поле, иначе первая кнопка) и назад при закрытии
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const field = panel?.querySelector("input, textarea, select");
    const target = field ?? panel?.querySelector(FOCUSABLE);
    if (target) target.focus();
    return () => {
      const el = restoreRef.current;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
    };
  }, [open]);

  // Tab не убегает под модалку: зацикливаем внутри панели
  const onTrapKeyDown = (e) => {
    if (e.key !== "Tab") return;
    const nodes = [...(panelRef.current?.querySelectorAll(FOCUSABLE) ?? [])].filter((n) => !n.disabled);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        background: "var(--glass-deep)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        animation: "muzaFadeIn var(--dur-base) var(--ease-out)",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onTrapKeyDown}
        style={{
          width,
          maxWidth: "calc(100% - 48px)",
          padding: "var(--sp-6)",
          borderRadius: "var(--r-xl)",
          background: "var(--bg-1)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
          animation: "muzaRiseIn var(--dur-base) var(--ease-out)",
        }}
      >
        <style>{"@keyframes muzaFadeIn{from{opacity:0}}@keyframes muzaRiseIn{from{opacity:0;transform:translateY(14px) scale(.98)}}@media (prefers-reduced-motion: reduce){[role=dialog]{animation:none!important}}"}</style>
        {title ? (
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-title)", fontWeight: "var(--fw-bold)", color: "var(--text-1)", letterSpacing: "-0.01em" }}>{title}</div>
        ) : null}
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>{children}</div>
        {actions ? (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-3)" }}>{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
