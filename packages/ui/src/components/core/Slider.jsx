import React, { useRef, useState, useCallback, useLayoutEffect } from "react";
import { portal } from "../../lib/layerRoot.js";
import { cssZoom } from "../../lib/cssZoom.js";

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
/** align — куда прижата дорожка внутри своего бокса: "start" — к верхней
 *  кромке, "end" — к нижней, дефолт по середине. Нужно ровно одному
 *  потребителю: полноширинной полосе прогресса по КРАЮ плеера (набросок
 *  владельца 2026-08-04: линия по верхней кромке полосы). Там зона попадания
 *  обязана быть высокой (в неё целятся мышью), а сама дорожка — лежать на
 *  кромке, иначе линия висит в воздухе посреди бара. */
export function Slider({ value = 0, max = 100, onChange, ariaLabel, valueText, hoverLabel, rate = 0, align = "center", thickness = 4, style }) {
  /* Толщина дорожки — числом (px) или готовой CSS-длиной, чтобы потребитель мог
     отдать переменную темы: у полосы прогресса она настраиваемая (prefs.hProgress
     → --h-progress), у всех остальных ползунков остаются прежние 4px. */
  const track = typeof thickness === "number" ? `${thickness}px` : thickness;
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
    // Экранные координаты для пузырька-портала. Вертикаль зависит от кромки:
    // у прогресса по ВЕРХУ плеера (align="start") пузырёк живёт ПОД линией,
    // внутри самого плеера — над линией он вылезал за пределы полосы (жалоба
    // владельца 04.08); у остальных — над дорожкой, как раньше.
    setScrub({ v: p * max, x: r.left + p * r.width, y: align === "start" ? r.bottom + 6 : r.top - 6 });
  };

  // Зажим пузырька по горизонтали — ПОСЛЕ отрисовки, когда известна его
  // настоящая ширина: у кромки слайдера центрированный по курсору пузырёк
  // наполовину уходил за окно («закрыт рамкой» — жалоба владельца 04.08).
  // Прямой записью в style, без state: пересчёт идёт на каждый pointermove.
  const bubbleRef = useRef(null);
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    const root = ref.current;
    if (!el || !root || !scrub) return;
    const z = cssZoom(el) || 1;
    const half = el.getBoundingClientRect().width / 2;
    const r = root.getBoundingClientRect();
    const M = 4;
    const x = Math.max(r.left + half + M, Math.min(r.right - half - M, scrub.x));
    el.style.left = `${x / z}px`;
  }, [scrub]);

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
        // Только левая кнопка: pointerdown приходит и от правой/средней, и без
        // сторожа ПКМ по полосе прогресса ПЕРЕМАТЫВАЛ трек, а потом ещё и
        // открывал контекст-меню бара (ревизия 04.08).
        if (e.pointerType === "mouse" && e.button !== 0) return;
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
        alignItems: align === "end" ? "flex-end" : align === "start" ? "flex-start" : "center",
        cursor: "pointer",
        touchAction: "none",
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          /* Наведение утолщает дорожку на те же +2px при любой толщине: это
             отклик «я на неё попал», а не вторая настройка. */
          height: hover || drag ? `calc(${track} + 2px)` : track,
          borderRadius: "var(--r-pill)",
          background: "var(--surface-3)",
          overflow: "hidden",
          transition: "height var(--dur-state) var(--ease-standard)",
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
        {/* У КРАЕВОЙ ПОЛОСЫ (align start/end) ПОЛЗУНКА НЕТ — И ЭТО НЕ УПУЩЕНИЕ.
            Дорожка лежит вплотную к кромке, поэтому круг, честно отцентрованный
            по ней, наполовину уходит за край и обрезается (проверено пикселями
            04.08). Двигать его — значит отрывать от линии. Отказ безопасен:
            обратную связь дают утолщение дорожки и пузырёк времени. */}
        {align !== "center" ? null : (
          <div
            style={{
              position: "absolute",
              top: "50%",
              marginTop: -6,
              left: -6,
              width: 12,
              height: 12,
              borderRadius: "var(--r-pill)",
              background: "var(--text-1)",
              opacity: hover || drag ? 1 : 0,
              transition: "opacity var(--dur-state) var(--ease-standard)",
            }}
          ></div>
        )}
      </div>
      {/* ПУЗЫРЁК ПЕРЕМОТКИ — ПОРТАЛОМ, как подсказки (lib/layerRoot.js).
          Абсолютный пузырёк над слайдером резался ЛЮБЫМ overflow по дороге —
          у полосы прогресса плеера обёртка клипует концы линии под скруглённые
          углы, и пузырёк молча исчезал вместе с ними. Координаты экранные,
          делённые на cssZoom — тот же контракт, что у меню и подсказок. */}
      {hoverLabel && scrub && (hover || drag)
        ? portal(
            <span
              aria-hidden="true"
              ref={bubbleRef}
              style={{
                position: "fixed",
                left: scrub.x / (cssZoom(ref.current) || 1),
                top: scrub.y / (cssZoom(ref.current) || 1),
                // у верхнекромочного прогресса пузырёк раскрывается ВНИЗ от
                // линии (внутрь плеера), у остальных — вверх от дорожки
                transform: align === "start" ? "translate(-50%, 0)" : "translate(-50%, -100%)",
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
                zIndex: 300,
              }}
            >
              {hoverLabel(scrub.v)}
            </span>,
          )
        : null}
    </div>
  );
}
