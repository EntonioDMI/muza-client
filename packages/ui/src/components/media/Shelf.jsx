import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../core/Button.jsx";
import { IconButton } from "../core/IconButton.jsx";

/** Home-feed shelf: section header + horizontally scrolling row of tiles.
 *  Листается стрелками ‹ › (появляются по краям на hover; гаснут на упоре) —
 *  раньше ряд скроллился только колёсиком/тачпадом, без видимого способа
 *  пролистать (жалоба владельца 2026-07-16). Колёсико/драг по-прежнему работают. */
export function Shelf({ title, action = "Show all", onAction, prevLabel = "Back", nextLabel = "Forward", children, style }) {
  const rowRef = useRef(null);
  // atStart/atEnd — на упоре стрелку прячем (нечего листать в ту сторону).
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [hover, setHover] = useState(false);

  const sync = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    sync();
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // ряд меняется (пришли реки/сузили окно) — пересчитываем упоры
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync, children]);

  const page = (dir) => {
    const el = rowRef.current;
    if (!el) return;
    // ~80% ширины — почти полный экран карточек, но с нахлёстом для контекста
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  const arrow = (dir, hidden, label) => (
    <div
      style={{
        position: "absolute",
        // по вертикали центрируем над обложкой (верхний квадрат карточки),
        // а не над всей плиткой с подписью — так стрелка не наезжает на текст
        top: 0,
        bottom: "var(--sp-7)",
        [dir < 0 ? "left" : "right"]: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: dir < 0 ? "flex-start" : "flex-end",
        // клики мимо кнопки не крадём у карточек; без широкого градиента-«тени»
        // (из-за неё крайняя обложка «выпирала» — жалоба 2026-07-16): просто
        // плавающая кнопка со своей мягкой тенью, слегка над краем.
        pointerEvents: "none",
        padding: "0 2px",
        zIndex: 2,
        opacity: hover && !hidden ? 1 : 0,
        transition: "opacity var(--dur-fast) var(--ease-out)",
      }}
    >
      <span
        style={{
          pointerEvents: hidden ? "none" : "auto",
          borderRadius: "var(--r-pill)",
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.5)",
        }}
      >
        <IconButton
          icon={dir < 0 ? "chevron-left" : "chevron-right"}
          variant="surface"
          label={label}
          onClick={() => page(dir)}
        />
      </span>
    </div>
  );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--sp-1)" }}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-title)",
            fontWeight: "var(--fw-bold)",
            color: "var(--text-1)",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        {onAction ? (
          <Button variant="ghost" onClick={onAction} style={{ height: 36, padding: "0 var(--sp-4)", fontSize: "var(--fs-caption)" }}>
            {action}
          </Button>
        ) : null}
      </div>
      <div style={{ position: "relative" }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <div
          ref={rowRef}
          onScroll={sync}
          style={{
            display: "flex",
            gap: "var(--sp-4)",
            overflowX: "auto",
            scrollbarWidth: "none",
            scrollBehavior: "smooth",
            margin: "0 calc(-1 * var(--sp-1))",
            padding: "var(--sp-1)",
          }}
        >
          {children}
        </div>
        {arrow(-1, atStart, prevLabel)}
        {arrow(1, atEnd, nextLabel)}
      </div>
    </section>
  );
}
