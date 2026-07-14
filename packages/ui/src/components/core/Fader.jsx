import React, { useRef, useState, useCallback } from "react";

/** Vertical fader — эквалайзер, будущие миксер-панели. Значение в диапазоне
 *  min..max (по умолчанию −12..+12 дБ), ноль — посередине.
 *  Клавиатура: стрелки ±1 (Shift ±3), Home/End, 0 — сброс в ноль. */
export function Fader({ value = 0, min = -12, max = 12, onChange, ariaLabel, height = 140, disabled = false, style }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);

  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)); // 0 = низ

  const setFromEvent = useCallback(
    (e) => {
      if (!ref.current || !onChange || disabled) return;
      const r = ref.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height));
      onChange(min + p * (max - min));
    },
    [min, max, onChange, disabled]
  );

  const onKeyDown = (e) => {
    if (!onChange || disabled) return;
    let next = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = value + (e.shiftKey ? 3 : 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = value - (e.shiftKey ? 3 : 1);
    else if (e.key === "Home") next = max;
    else if (e.key === "End") next = min;
    else if (e.key === "0") next = 0;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(Math.max(min, Math.min(max, next)));
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${value > 0 ? "+" : ""}${Math.round(value)} dB`}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        setFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        // pointerup мог потеряться (отпустили вне окна) — не липнем к мыши
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
        width: 24,
        height,
        display: "flex",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        touchAction: "none",
        flex: "none",
        ...style,
      }}
    >
      <div
        style={{
          width: hover || drag ? 6 : 4,
          height: "100%",
          borderRadius: "var(--r-pill)",
          background: "var(--surface-3)",
          overflow: "hidden",
          display: "flex",
          alignItems: "flex-end",
          transition: "width var(--dur-fast) var(--ease-out)",
        }}
      >
        <div style={{ width: "100%", height: pct + "%", background: "var(--accent-slider, var(--accent))", borderRadius: "var(--r-pill)" }}></div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "calc(" + pct + "% - 7px)",
          width: 14,
          height: 14,
          borderRadius: "var(--r-pill)",
          background: "var(--text-1)",
          opacity: hover || drag ? 1 : 0,
          transition: "opacity var(--dur-fast) var(--ease-out)",
          pointerEvents: "none",
        }}
      ></div>
    </div>
  );
}
