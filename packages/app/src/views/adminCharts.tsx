import { useLayoutEffect, useRef, useState } from "react";
import type { AdminDayPoint } from "@muza/api-client";
import { barGeometry, linePath, niceMax, xTickIndexes } from "../lib/adminChartMath";

/** SVG-график дневной серии (админка). Свой рендер на токенах ДС — без
 *  чарт-библиотек (конвенция проекта). 2026-07-21 (жалоба владельца «навожусь
 *  и не получаю информации»): живой JS-ховер — вертикальная направляющая,
 *  подсвеченная точка и стеклянный тултип со значением/датой; движение —
 *  только opacity/позиции, деликатно (reduced-motion не страдает: без
 *  оркестраций, тултип следует курсору). Зум по времени — окно DaysTabs.
 *
 *  РАЗМЕР — ОТ КОНТЕЙНЕРА (05.08). Ширина viewBox была прибита к 640 при
 *  ширине картинки 100 %: на мониторе 1200px браузер растягивал КАРТИНКУ почти
 *  вдвое — вместе с подписями осей и толщиной линий. Подпись, задуманная
 *  мелкой, приезжала крупнее строки текста рядом, а высота графика зависела от
 *  ширины окна. Теперь ширина берётся с контейнера, и график рисуется один к
 *  одному: подписи и линии всегда того размера, каким назначены. */

/** Ширина поля ДО первого замера контейнера (и там, где мерить нечем: jsdom в
 *  тестах не считает раскладку). Заодно это ширина, на которой график
 *  задумывался. */
const W_FALLBACK = 640;

/** Высота поля данных. Постоянная: график тянется только вширь — по вертикали
 *  ему нужен ровно тот рост, на котором столбик читается, а страница ещё не
 *  превращается в ленту графиков. */
const CHART_H = 150;

/** Полоса под полем данных, в которой лежат подписи дат. */
const LABEL_H = 18;

/** Базовые линии подписей: потолок оси — сверху внутри поля, даты — под ним. */
const TOP_LABEL_Y = 12;
const DATE_LABEL_DY = 13;

/** Толщина: сетка и направляющая — волосяные, сама серия — заметная. */
const HAIRLINE = 1;
const LINE_W = 2;

/** Точка серии: обычная и та, на которую сейчас смотрят. */
const DOT_R = 3;
const DOT_R_HOVER = 5;

/** Скругление столбика: угол виден, но столбик не становится пилюлей. */
const BAR_R = 2;

/** Сетка обязана читаться как фон, а не как данные. */
const GRID_OPACITY = 0.15;
/** Направляющая заметнее сетки, но слабее серии — она подсказка, не значение. */
const GUIDE_OPACITY = 0.35;
/** Заливка под линией — намёк на объём, а не второй график. */
const AREA_OPACITY = 0.08;
/** Точки и столбики, мимо которых сейчас ведут курсор, уходят на второй план. */
const DIM_OPACITY = 0.45;

/** На сколько процентов ширины тултип не доезжает до края: у крайних точек он
 *  иначе вылезает за график и обрезается. */
const TIP_EDGE_PCT = 7;

const dayLabel = (bucket: string): string => `${bucket.slice(8, 10)}.${bucket.slice(5, 7)}`;

/** Подписи внутри SVG — токеном шкалы, а не числом: размер текста в графике
 *  тот же, что у подписей рядом на странице (в SVG это работает только
 *  стилем — атрибут font-size значения var() не понимает). */
const axisLabel: React.CSSProperties = { fontSize: "var(--fs-caption)" };

export function SeriesChart({
  points,
  mode,
  color = "var(--accent)",
  ariaLabel,
}: {
  points: AdminDayPoint[];
  mode: "line" | "bars";
  color?: string;
  ariaLabel: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [boxW, setBoxW] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => setBoxW(Math.round(el.clientWidth));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length === 0) {
    return <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", padding: "var(--sp-2) 0" }}>—</div>;
  }
  const W = boxW || W_FALLBACK;
  const counts = points.map((p) => p.count);
  const maxY = niceMax(Math.max(...counts));
  const box = { w: W, h: CHART_H, maxY };
  const xAt = (i: number) => (points.length === 1 ? W / 2 : (i * W) / (points.length - 1));
  const barCenter = (i: number) => (i + 0.5) * (W / points.length);
  const centerAt = mode === "bars" ? barCenter : xAt;
  const yAt = (v: number) => CHART_H - (v / maxY) * CHART_H;
  const d = linePath(counts, box);

  // ближайшая точка по X курсора: пиксели контейнера → координаты viewBox
  const onMove = (e: React.PointerEvent) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(centerAt(i) - vx) < Math.abs(centerAt(best) - vx)) best = i;
    }
    setHover(best);
  };
  const hovered = hover !== null ? points[hover] : null;
  // тултип не должен вылезать за края: у крайних точек прижимаем к краю
  const tipLeft =
    hover !== null ? Math.min(Math.max((centerAt(hover) / W) * 100, TIP_EDGE_PCT), 100 - TIP_EDGE_PCT) : 0;

  return (
    <div
      ref={boxRef}
      style={{ position: "relative" }}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${CHART_H + LABEL_H}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {[0, CHART_H / 2, CHART_H].map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="var(--text-3)" strokeWidth={HAIRLINE} opacity={GRID_OPACITY} />
        ))}
        <text x={W} y={TOP_LABEL_Y} textAnchor="end" fill="var(--text-3)" style={axisLabel}>
          {maxY}
        </text>
        {/* вертикальная направляющая ховера */}
        {hover !== null ? (
          <line
            x1={centerAt(hover)}
            y1={0}
            x2={centerAt(hover)}
            y2={CHART_H}
            stroke="var(--text-2)"
            strokeWidth={HAIRLINE}
            opacity={GUIDE_OPACITY}
          />
        ) : null}
        {mode === "line" ? (
          <>
            <path d={`${d}L${W},${CHART_H}L0,${CHART_H}Z`} fill={color} opacity={AREA_OPACITY} />
            <path
              data-line
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={LINE_W}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((p, i) => (
              <circle
                key={p.bucket}
                cx={xAt(i)}
                cy={yAt(p.count)}
                r={hover === i ? DOT_R_HOVER : DOT_R}
                fill={color}
                opacity={hover === null || hover === i ? 1 : DIM_OPACITY}
                style={{ transition: "r var(--dur-state) var(--ease-standard), opacity var(--dur-state) var(--ease-standard)" }}
              />
            ))}
          </>
        ) : (
          barGeometry(counts, box).map((b, i) => (
            <rect
              data-bar
              key={points[i].bucket}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={BAR_R}
              fill={color}
              opacity={hover === null || hover === i ? 1 : DIM_OPACITY}
              style={{ transition: "opacity var(--dur-state) var(--ease-standard)" }}
            />
          ))
        )}
        {xTickIndexes(points.length, 6).map((i) => (
          <text
            key={points[i].bucket}
            x={centerAt(i)}
            y={CHART_H + DATE_LABEL_DY}
            textAnchor="middle"
            fill="var(--text-3)"
            style={axisLabel}
          >
            {dayLabel(points[i].bucket)}
          </text>
        ))}
      </svg>
      {/* стеклянный тултип над направляющей — HTML поверх svg, токены ДС */}
      {hovered ? (
        <div
          style={{
            position: "absolute",
            left: `${tipLeft}%`,
            top: "var(--sp-1)",
            transform: "translateX(-50%)",
            padding: "var(--sp-1) var(--sp-3)",
            borderRadius: "var(--r-sm)",
            background: "var(--glass-panel)",
            backdropFilter: "blur(var(--blur-glass))",
            WebkitBackdropFilter: "blur(var(--blur-glass))",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            fontSize: "var(--fs-caption)",
            color: "var(--text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ fontWeight: "var(--fw-semibold)" }}>{hovered.count}</span>
          <span style={{ color: "var(--text-3)", marginLeft: "var(--sp-2)" }}>{dayLabel(hovered.bucket)}</span>
        </div>
      ) : null}
    </div>
  );
}
