import React, { useEffect, useRef } from "react";

/** Synced lyrics — the product's signature. Full, uncensored, and NEVER blurred:
 *  inactive lines only dim. Active line is full-strength (accent in panel mode). */
export function Lyrics({ lines, activeIndex = 0, mode = "panel", onSeek, style }) {
  const wrapRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const el = activeRef.current;
    if (!wrap || !el) return;
    const target = el.offsetTop - wrap.clientHeight / 2 + el.clientHeight / 2;
    wrap.scrollTo({ top: target, behavior: "smooth" });
  }, [activeIndex]);

  const karaoke = mode === "karaoke";

  return (
    <div
      ref={wrapRef}
      style={{
        overflowY: "auto",
        scrollbarWidth: "none",
        display: "flex",
        flexDirection: "column",
        gap: karaoke ? "var(--sp-5)" : "var(--sp-4)",
        padding: karaoke ? "40vh 0" : "var(--sp-6) 0",
        ...style,
      }}
    >
      {lines.map((line, i) => {
        const isActive = i === activeIndex;
        const isPast = i < activeIndex;
        return (
          <div
            key={i}
            ref={isActive ? activeRef : null}
            onClick={() => onSeek && onSeek(i)}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: karaoke ? "var(--fs-karaoke)" : "var(--fs-lyric)",
              fontWeight: "var(--fw-bold)",
              lineHeight: "var(--lh-lyrics)",
              letterSpacing: "-0.01em",
              color: isActive
                ? karaoke ? "var(--text-1)" : "var(--accent-text)"
                : isPast ? "var(--text-3)" : "var(--text-2)",
              opacity: isActive ? 1 : karaoke ? 0.45 : 0.8,
              transform: karaoke && isActive ? "scale(1.02)" : "scale(1)",
              transformOrigin: "left center",
              cursor: onSeek ? "pointer" : "default",
              transition: "color var(--dur-slow) var(--ease-out), opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out)",
              textWrap: "balance",
            }}
          >
            {line.text || "•••"}
          </div>
        );
      })}
    </div>
  );
}
