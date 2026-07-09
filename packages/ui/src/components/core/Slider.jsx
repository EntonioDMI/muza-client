import React, { useRef, useState, useCallback } from "react";

/** Progress / volume slider — thin pill track, accent fill, thumb on hover. */
export function Slider({ value = 0, max = 100, onChange, ariaLabel, style }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);

  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  const setFromEvent = useCallback(
    (e) => {
      if (!ref.current || !onChange) return;
      const r = ref.current.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      onChange(p * max);
    },
    [max, onChange]
  );

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        setFromEvent(e);
      }}
      onPointerMove={(e) => drag && setFromEvent(e)}
      onPointerUp={() => setDrag(false)}
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
            background: "var(--accent)",
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
    </div>
  );
}
