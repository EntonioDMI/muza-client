import React, { useEffect, useRef, useState } from "react";

/** Synced lyrics — the product's signature. Full, uncensored, and NEVER blurred.
 *
 *  Активная строка всегда ПО ЦЕНТРУ (спека владельца, 2026-07-10). Ручной
 *  скролл приостанавливает следование, через 2.5с бездействия оно возвращается.
 *
 *  Сколько строк видно — у режимов РАЗНО (спека владельца, 2026-07-15):
 *  - karaoke: окно вокруг активной, видно 5 строк (radius 2), масштаб по
 *    удалению 100/90/80, дальние скрыты. Полный экран, разрежённость — замысел.
 *  - panel:   виден ВЕСЬ текст, как в Spotify. Окно здесь было (radius 1 = 3
 *    строки) и давало ровно тот эффект, на который пожаловался владелец:
 *    скрытая строка получает opacity:0, но ОСТАЁТСЯ В ПОТОКЕ и держит своё
 *    место пустым — панель читалась как три строки посреди пустоты. */
export function Lyrics({ lines, activeIndex = 0, mode = "panel", onSeek, onExplain, autoScroll = true, style }) {
  const wrapRef = useRef(null);
  const activeRef = useRef(null);
  // Пользователь листает сам: показываем весь текст и не дёргаем автоскролл
  const [manual, setManual] = useState(false);
  const manualTimer = useRef(null);

  const karaoke = mode === "karaoke";
  const synced = activeIndex >= 0; // plain-текст без таймкодов — обычный список
  const radius = 2; // караоке-окно: активная ±2 (5 строк). В панели окна нет
  // autoScroll=false — постоянный «ручной» режим: свободный скролл, активная
  // строка подсвечивается, но окно за ней не едет
  const freeScroll = manual || !autoScroll;
  // «Видно всё» и «следуем за активной» — РАЗНЫЕ вещи, но до 15.07 их связывал
  // один freeScroll: показать весь текст в панели можно было, только перестав
  // следить за активной строкой. Развязано — окно осталось только у караоке.
  const windowed = karaoke && !freeScroll;

  const centerActive = (behavior) => {
    const wrap = wrapRef.current;
    const el = activeRef.current;
    if (!wrap || !el) return;
    const target = el.offsetTop - wrap.clientHeight / 2 + el.clientHeight / 2;
    wrap.scrollTo({ top: target, behavior: behavior || "smooth" });
  };

  useEffect(() => {
    if (synced && autoScroll && !manual) centerActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, manual, synced, autoScroll]);

  const wake = () => {
    if (!synced || !autoScroll) return;
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
        // строка с объяснением («режим смысла»): акцентный цвет, клик открывает смысл вместо seek
        const hasNote = !!line.note && !!onExplain;
        // Масштаб. Караоке — «линза»: 100/90/80 читаются как глубина ровно
        // потому, что видно только 5 строк. В панели видно весь текст, и та же
        // лесенка выродилась бы (одна строка 90%, все прочие 80%), поэтому один
        // шаг: активная 100%, остальные 90%. Ниже не опускаем — transform не
        // занимает места в потоке, значит любой scale<1 ДОБАВЛЯЕТ пустоты (ту
        // самую, из-за которой правка) и молча ужимает prefs.fontScale.
        const scale = isActive ? 1 : karaoke ? (d === 1 ? 0.9 : 0.8) : 0.9;
        const hidden = synced && windowed && d > radius;
        // Прозрачность. В панели иерархию несёт ТОЛЬКО color: --accent-text →
        // --text-2 (0.62α) → --text-3 (0.38α). Множитель opacity здесь дал бы
        // двойное затемнение: --text-3 ×0.5 = 0.19α — это 1.8:1 к фону панели,
        // призрак вместо строки. При opacity:1 те же --text-3 дают 3.2:1 — AA
        // для крупного текста (24px bold) и нижняя планка читаемости; запаса на
        // «рамп к краям» под ней нет, рампом и служит сама лесенка color.
        const karaokeDim = freeScroll ? 0.6 : hidden ? 0 : d === 1 ? 0.7 : 0.5;
        const opacity = !synced ? 0.8 : isActive ? 1 : karaoke ? karaokeDim : 1;
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
              color: hasNote
                ? "var(--accent-text)"
                : isActive
                  ? karaoke ? "var(--text-1)" : "var(--accent-text)"
                  : isPast || d > 1 ? "var(--text-3)" : "var(--text-2)",
              opacity,
              transform: `scale(${scale})`,
              transformOrigin: "left center",
              cursor: hasNote || onSeek ? "pointer" : "default",
              pointerEvents: hidden ? "none" : "auto",
              transition: "color var(--dur-slow) var(--ease-out), opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out)",
              textWrap: "balance",
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
