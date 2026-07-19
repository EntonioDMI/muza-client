import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../core/Icon.jsx";
import { cssZoom } from "../../lib/cssZoom.js";

// Фолбэк-таймаут delayed-unmount: см. Dialog.jsx. Покрывает --dur-fast на
// максимальной скорости анимаций (170% → 150ms*1.7≈255ms) с запасом.
const EXIT_FALLBACK_MS = 400;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Context / dropdown menu — frosted panel anchored at a point.
 *  Keyboard: focus jumps into the menu on open (and back on close),
 *  Arrows/Home/End walk items, Enter activates, Escape closes.
 *  Закрытие — delayed-unmount (см. Dialog.jsx): узел остаётся в DOM на время
 *  exit-анимации (muzaMenuOut), снимается по onAnimationEnd с
 *  таймаут-фолбэком; reduced-motion и повторное открытие во время закрытия
 *  обрабатываются так же, как в Dialog. */
export function Menu({ open, x = 0, y = 0, items = [], onClose }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState({ left: x, top: y });

  // x/y приходят в ЭКРАННЫХ пикселях (clientX ПКМ), а панель внутри
  // зумленного корня (prefs.uiScale) позиционируется в зум-единицах — делим
  // на cssZoom, иначе меню уезжает вправо-вниз (жалоба 2026-07-17). Заодно
  // клампим в вьюпорт с полем 8px — раньше это делал (не всегда) вызыватель,
  // на глаз и без учёта зума. useLayoutEffect — до отрисовки, без миганий.
  useLayoutEffect(() => {
    if (!mounted) return;
    const el = panelRef.current;
    if (!el) return;
    const z = cssZoom(el);
    const w = el.offsetWidth * z; // offset* — зум-единицы; на экране их x z
    const h = el.offsetHeight * z;
    const sx = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    const sy = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    setPos({ left: sx / z, top: sy / z });
  }, [mounted, x, y]);

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setClosing(false);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      setClosing(false);
      setMounted(false);
      return;
    }
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setClosing(false);
      setMounted(false);
    }, EXIT_FALLBACK_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const finishClosing = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    setMounted(false);
  };

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

  if (!mounted) return null;
  return (
    <div
      onClick={closing ? undefined : onClose}
      onContextMenu={(e) => { e.preventDefault(); if (!closing && onClose) onClose(); }}
      inert={closing || undefined}
      style={{ position: "fixed", inset: 0, zIndex: 150 }}
    >
      <div
        ref={panelRef}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onMenuKeyDown}
        onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) finishClosing(); }}
        style={{
          position: "absolute",
          left: pos.left,
          top: pos.top,
          minWidth: 220,
          padding: "var(--sp-2)",
          borderRadius: "var(--r-md)",
          /* зональная прозрачность: своё стекло меню, фолбэк — общее */
          background: "var(--glass-menu, var(--glass-panel))",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          animation: closing
            ? "muzaMenuOut var(--dur-fast) var(--ease-out) forwards"
            : "muzaMenuIn var(--dur-fast) var(--ease-out)",
        }}
      >
        <style>{"@keyframes muzaMenuIn{from{opacity:0;transform:translateY(6px) scale(.98)}}@keyframes muzaMenuOut{to{opacity:0;transform:translateY(6px) scale(.98)}}@media (prefers-reduced-motion: reduce){[role=menu]{animation:none!important}}"}</style>
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
