import React, { useRef, useState, useCallback } from "react";

/** Progress / volume slider — thin pill track, accent fill, thumb on hover.
 *  Keyboard: Arrows step (Shift ×5), Home/End, PageUp/PageDown — full ARIA
 *  slider pattern. valueText announces a human value to screen readers.
 *  hoverLabel(v) включает скраб-превью: морозный пузырёк над курсором
 *  («куда я сикну») — прогресс-бары передают форматтер тайм-кода. */
export function Slider({ value = 0, max = 100, onChange, ariaLabel, valueText, hoverLabel, style }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);
  const [scrub, setScrub] = useState(null); // { pct, v } под курсором

  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  const scrubFromEvent = (e) => {
    if (!hoverLabel || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setScrub({ pct: p * 100, v: p * max });
  };

  const setFromEvent = useCallback(
    (e) => {
      if (!ref.current || !onChange) return;
      const r = ref.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      onChange(p * max);
    },
    [max, onChange]
  );

  const step = Math.max(max / 100, 1);
  const onKeyDown = (e) => {
    if (!onChange) return;
    const big = step * 5;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + (e.shiftKey ? big : step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - (e.shiftKey ? big : step);
    else if (e.key === "PageUp") next = value + big;
    else if (e.key === "PageDown") next = value - big;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // глобальные хоткеи (сик ←/→) не должны дублировать шаг
    onChange(Math.max(0, Math.min(max, next)));
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={valueText}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setScrub(null);
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        setFromEvent(e);
      }}
      onPointerMove={(e) => {
        scrubFromEvent(e);
        if (!drag) return;
        // pointerup мог потеряться (отпустили вне окна, потеря capture) —
        // без зажатой кнопки не «прилипаем» к мыши
        if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
          setDrag(false);
          return;
        }
        setFromEvent(e);
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onLostPointerCapture={() => setDrag(false)}
      style={{
        position: "relative",
        height: 20,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        touchAction: "none",
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          height: hover || drag ? 6 : 4,
          borderRadius: "var(--r-pill)",
          background: "var(--surface-3)",
          overflow: "hidden",
          transition: "height var(--dur-fast) var(--ease-out)",
        }}
      >
        <div
          style={{
            width: pct + "%",
            height: "100%",
            borderRadius: "var(--r-pill)",
            /* роль акцента «слайдеры»: свой цвет, фолбэк — общий акцент */
            background: "var(--accent-slider, var(--accent))",
          }}
        ></div>
      </div>
      <div
        style={{
          position: "absolute",
          left: "calc(" + pct + "% - 6px)",
          width: 12,
          height: 12,
          borderRadius: "var(--r-pill)",
          background: "var(--text-1)",
          opacity: hover || drag ? 1 : 0,
          transition: "opacity var(--dur-fast) var(--ease-out)",
          pointerEvents: "none",
        }}
      ></div>
      {hoverLabel && scrub && (hover || drag) ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: scrub.pct + "%",
            bottom: "calc(100% + 6px)",
            transform: "translateX(-50%)",
            padding: "3px 8px",
            borderRadius: "var(--r-xs)",
            background: "var(--glass-panel)",
            backdropFilter: "blur(var(--blur-glass))",
            WebkitBackdropFilter: "blur(var(--blur-glass))",
            color: "var(--text-1)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {hoverLabel(scrub.v)}
        </span>
      ) : null}
    </div>
  );
}
