import React, { useEffect, useRef, useState } from "react";

/** Synced lyrics — the product's signature. Full, uncensored, and NEVER blurred.
 *
 *  Окно вокруг активной строки (спека владельца, 2026-07-10): активная всегда
 *  ПО ЦЕНТРУ; видно 3 строки в панели (radius 1) и 5 в караоке (radius 2);
 *  масштаб по удалению — 100% / 90% / 80%; дальние строки скрыты. Ручной
 *  скролл показывает весь текст, через 2.5с бездействия окно возвращается
 *  к активной строке. */
export function Lyrics({ lines, activeIndex = 0, mode = "panel", onSeek, onExplain, style }) {
  const wrapRef = useRef(null);
  const activeRef = useRef(null);
  // Пользователь листает сам: показываем весь текст и не дёргаем автоскролл
  const [manual, setManual] = useState(false);
  const manualTimer = useRef(null);

  const karaoke = mode === "karaoke";
  const synced = activeIndex >= 0; // plain-текст без таймкодов — обычный список
  const radius = karaoke ? 2 : 1;

  const centerActive = (behavior) => {
    const wrap = wrapRef.current;
    const el = activeRef.current;
    if (!wrap || !el) return;
    const target = el.offsetTop - wrap.clientHeight / 2 + el.clientHeight / 2;
    wrap.scrollTo({ top: target, behavior: behavior || "smooth" });
  };

  useEffect(() => {
    if (synced && !manual) centerActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, manual, synced]);

  const wake = () => {
    if (!synced) return;
    setManual(true);
    if (manualTimer.current) clearTimeout(manualTimer.current);
    manualTimer.current = setTimeout(() => setManual(false), 2500);
  };
  useEffect(() => () => {
    if (manualTimer.current) clearTimeout(manualTimer.current);
  }, []);

  return (
    <div
      ref={wrapRef}
      onWheel={wake}
      onTouchMove={wake}
      style={{
        overflowY: "auto",
        scrollbarWidth: "none",
        display: "flex",
        flexDirection: "column",
        gap: karaoke ? "var(--sp-5)" : "var(--sp-4)",
        ...(synced ? {} : { padding: karaoke ? "40vh 0" : "var(--sp-6) 0" }),
        ...style,
      }}
    >
      {/* спейсеры: первая/последняя строка тоже могут встать в центр */}
      {synced ? <div aria-hidden style={{ flex: "none", height: "50%" }} /> : null}
      {lines.map((line, i) => {
        const d = synced ? Math.abs(i - activeIndex) : 1;
        const isActive = synced && i === activeIndex;
        const isPast = synced && i < activeIndex;
        // строка с объяснением («режим смысла»): пунктир, клик открывает смысл вместо seek
        const hasNote = !!line.note && !!onExplain;
        // масштаб по удалению: 100% / 90% / 80%
        const scale = isActive ? 1 : d === 1 ? 0.9 : 0.8;
        // в покое видно только окно (radius); при ручном скролле — весь текст
        const hidden = synced && !manual && d > radius;
        const opacity = !synced
          ? 0.8
          : isActive
            ? 1
            : manual
              ? 0.6
              : hidden
                ? 0
                : d === 1
                  ? 0.7
                  : 0.5;
        return (
          <div
            key={i}
            ref={isActive ? activeRef : null}
            role={hasNote ? "button" : undefined}
            tabIndex={hasNote ? 0 : undefined}
            aria-label={hasNote ? `Смысл строки: ${line.text}` : undefined}
            onClick={() => {
              if (hasNote) {
                onExplain(i);
                return;
              }
              if (onSeek) {
                onSeek(i);
                // клик = «нашёл нужную строчку»: сразу возвращаем автоследование
                if (manualTimer.current) clearTimeout(manualTimer.current);
                setManual(false);
              }
            }}
            onKeyDown={(e) => {
              if (hasNote && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onExplain(i);
              }
            }}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: karaoke ? "var(--fs-karaoke)" : "var(--fs-lyric)",
              fontWeight: "var(--fw-bold)",
              lineHeight: "var(--lh-lyrics)",
              letterSpacing: "-0.01em",
              color: isActive
                ? karaoke ? "var(--text-1)" : "var(--accent-text)"
                : isPast || d > 1 ? "var(--text-3)" : "var(--text-2)",
              opacity,
              transform: `scale(${scale})`,
              transformOrigin: "left center",
              cursor: hasNote || onSeek ? "pointer" : "default",
              pointerEvents: hidden ? "none" : "auto",
              transition: "color var(--dur-slow) var(--ease-out), background var(--dur-fast) var(--ease-out), opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out)",
              textWrap: "balance",
              background: hasNote ? "var(--accent-soft)" : "transparent",
              boxShadow: hasNote ? "inset 3px 0 0 var(--accent)" : "none",
              borderRadius: hasNote ? "var(--r-sm)" : 0,
              padding: hasNote ? (karaoke ? "var(--sp-3) var(--sp-4)" : "var(--sp-2) var(--sp-3)") : 0,
              textDecorationLine: hasNote ? "underline" : "none",
              textDecorationStyle: "dotted",
              textDecorationColor: "var(--accent-text)",
              textDecorationThickness: 1,
              textUnderlineOffset: 6,
            }}
          >
            {line.text || "•••"}
          </div>
        );
      })}
      {synced ? <div aria-hidden style={{ flex: "none", height: "50%" }} /> : null}
    </div>
  );
}
