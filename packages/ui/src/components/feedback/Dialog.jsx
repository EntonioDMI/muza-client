import React, { useEffect, useRef, useState } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
// Фолбэк-таймаут delayed-unmount: страхует на случай, если onAnimationEnd не
// долетит (напр. окно/вкладка в фоне). С запасом покрывает --dur-base на
// максимальной пользовательской скорости анимаций (170% → 220ms*1.7≈374ms).
const EXIT_FALLBACK_MS = 500;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Modal dialog — frosted glass panel over a deep scrim. Use sparingly.
 *  Focus: jumps inside on open (first field or button), Tab loops within,
 *  Escape closes, focus returns to the opener on close.
 *  Закрытие — delayed-unmount: узел остаётся в DOM на время exit-анимации
 *  (muzaFadeOut/muzaRiseOut), снимается по onAnimationEnd с таймаут-фолбэком.
 *  Повторное открытие во время закрытия отменяет exit и возвращает узел в
 *  открытое состояние без ремаунта; prefers-reduced-motion закрывает мгновенно. */
export function Dialog({ open, title, headerAction, children, actions, onClose, width = 440 }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  // Delayed-unmount: при open=false узел остаётся смонтированным, пока не
  // доиграет exit-анимация (или не истечёт фолбэк-таймаут).
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
    if (!mounted) return; // никогда не был открыт — закрывать нечего
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
    // mounted намеренно не в deps: реагируем только на смену open, читаем
    // mounted из замыкания последнего рендера.
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
    const onKey = (e) => {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // Capture: модалка перехватывает Escape раньше оверлеев под ней.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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

  if (!mounted) return null;
  return (
    <div
      onClick={closing ? undefined : onClose}
      onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) finishClosing(); }}
      inert={closing || undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        background: "var(--glass-deep)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        animation: closing
          ? "muzaFadeOut var(--dur-base) var(--ease-out) forwards"
          : "muzaFadeIn var(--dur-base) var(--ease-out)",
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
          /* зональная прозрачность: диалог может стать стеклом (дефолт — глухой bg-1) */
          background: "var(--glass-dialog, var(--bg-1))",
          backdropFilter: "var(--bf-zone, none)",
          WebkitBackdropFilter: "var(--bf-zone, none)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
          animation: closing
            ? "muzaRiseOut var(--dur-base) var(--ease-out) forwards"
            : "muzaRiseIn var(--dur-base) var(--ease-out)",
        }}
      >
        <style>{"@keyframes muzaFadeIn{from{opacity:0}}@keyframes muzaFadeOut{to{opacity:0}}@keyframes muzaRiseIn{from{opacity:0;transform:translateY(14px) scale(.98)}}@keyframes muzaRiseOut{to{opacity:0;transform:translateY(14px) scale(.98)}}@media (prefers-reduced-motion: reduce){[role=dialog]{animation:none!important}}"}</style>
        {title || headerAction ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <div style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--fs-title)", fontWeight: "var(--fw-bold)", color: "var(--text-1)", letterSpacing: "-0.01em" }}>{title}</div>
            {headerAction}
          </div>
        ) : null}
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>{children}</div>
        {actions ? (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-3)" }}>{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
