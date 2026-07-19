import React, { useRef, useState, useCallback, useLayoutEffect } from "react";

/** Потолок экстраполяции: сколько времени заливке разрешено ехать без свежего
 *  value. Нормальный timeupdate приходит куда чаще, так что в живом
 *  воспроизведении предохранитель не срабатывает — он ловит ЗАСТРЯВШИЙ звук
 *  (буферизация, столл): без него полоска уехала бы в отрыв и потом прыгнула
 *  назад — рывок заметнее исходных ступенек. */
const EXTRAPOLATE_CAP_MS = 1500;

/** Progress / volume slider — thin pill track, accent fill, thumb on hover.
 *  Keyboard: Arrows step (Shift ×5), Home/End, PageUp/PageDown — full ARIA
 *  slider pattern. valueText announces a human value to screen readers.
 *  hoverLabel(v) включает скраб-превью: морозный пузырёк над курсором
 *  («куда я сикну») — прогресс-бары передают форматтер тайм-кода.
 *
 *  rate — единиц value в секунду реального времени (0 = выключено, дефолт).
 *  Зачем: у прогресс-бара источник позиции — событие timeupdate, а оно капает
 *  рвано (номинально ~4 раза/сек, в WebView2 бывает заметно грубее — см.
 *  комментарий в usePlayback.ts про gapless-опрос). Заливка, посаженная прямо
 *  на React-стейт, шла из-за этого видимыми ступеньками, и шаг ступеньки в
 *  пикселях = Δt / длительность × ширина бара — отсюда «на коротких треках
 *  скачет крупно, на длинных мелко» (жалоба 2026-07-19).
 *  С rate > 0 кадры rAF дорисовывают позицию между приходами value по стенным
 *  часам и пишут ширину В DOM МИМО React — ни одного лишнего ре-рендера
 *  (иначе 60 ре-рендеров плеера в секунду тянули бы за собой скробблинг,
 *  resumeStore и триггеры gapless). Свежий value сбрасывает якорь: ошибка не
 *  копится и гасится субпиксельно — обе шкалы идут по реальному времени. */
export function Slider({ value = 0, max = 100, onChange, ariaLabel, valueText, hoverLabel, rate = 0, style }) {
  const ref = useRef(null);
  const fillRef = useRef(null);
  const thumbRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);
  const [scrub, setScrub] = useState(null); // { pct, v } под курсором

  // max=0 (прогресс-бар без трека: 0/0) или не-число давали pct=NaN — браузер
  // молча игнорирует calc(NaN% - 6px), а css-парсер jsdom на нём ПАДАЕТ
  // (уронил App-тесты 2026-07-16). Пустой слайдер честно стоит на нуле.
  const ratio = max > 0 && Number.isFinite(value) ? (value / max) * 100 : 0;
  const pct = Math.max(0, Math.min(100, ratio));

  // Пока ползунок тащат рукой, хозяин позиции — курсор, а не часы
  const smooth = rate > 0 && max > 0 && Number.isFinite(value) && !drag;

  // Эффект — единственный хозяин позиции после маунта: в JSX остаётся тот же
  // pct (первый кадр и статичные слайдеры рисуются как раньше), а дальше
  // либо rAF ведёт заливку сам, либо мы разово возвращаем её на pct — иначе
  // после паузы в DOM залипал бы «хвост», дорисованный последним кадром.
  useLayoutEffect(() => {
    const paint = (p) => {
      // ТОЛЬКО transform, не width/left: процентная ширина защёлкивается по
      // целым пикселям, и медленный прогресс (у трека 1:53 это 3.4 px/с) вместо
      // движения СТОИТ ~0.25с и прыгает на 0.87px — «подёргивания» после первого
      // фикса (жалоба 2026-07-19, замер по реальным пикселям: 13 замеров из 23
      // без движения). transform считается субпиксельно и живёт в композиторе:
      // 0 из 23 замеров без движения. Заливка едет полной шириной из-под левого
      // края — так у неё сохраняется НЕискажённый скруглённый кончик (scaleX
      // раздавил бы радиус), а трек обрезает хвост своим overflow:hidden.
      if (fillRef.current) fillRef.current.style.transform = "translateX(" + (p - 100) + "%)";
      if (thumbRef.current) thumbRef.current.style.transform = "translateX(" + p + "%)";
    };
    if (!smooth) {
      paint(pct);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const elapsed = Math.min(performance.now() - start, EXTRAPOLATE_CAP_MS);
      const shown = value + (elapsed / 1000) * rate;
      paint(Math.max(0, Math.min(100, (shown / max) * 100)));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [smooth, pct, value, max, rate]);

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
          ref={fillRef}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "var(--r-pill)",
            transform: "translateX(" + (pct - 100) + "%)",
            /* роль акцента «слайдеры»: свой цвет, фолбэк — общий акцент */
            background: "var(--accent-slider, var(--accent))",
          }}
        ></div>
      </div>
      {/* Ползунок ездит НЕ через left, а трансформом слоя во всю ширину (процент
          считается от него же) — по той же причине, что и заливка: left
          защёлкивается по пикселям и на хвере дёргается вместе с прогрессом. */}
      <div
        ref={thumbRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          transform: "translateX(" + pct + "%)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: -6,
            marginTop: -6,
            width: 12,
            height: 12,
            borderRadius: "var(--r-pill)",
            background: "var(--text-1)",
            opacity: hover || drag ? 1 : 0,
            transition: "opacity var(--dur-fast) var(--ease-out)",
          }}
        ></div>
      </div>
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
