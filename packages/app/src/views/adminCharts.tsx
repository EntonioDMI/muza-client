import { useRef, useState } from "react";
import type { AdminDayPoint } from "@muza/api-client";
import { barGeometry, linePath, niceMax, xTickIndexes } from "../lib/adminChartMath";

/** SVG-график дневной серии (админка). Свой рендер на токенах ДС — без
 *  чарт-библиотек (конвенция проекта). 2026-07-21 (жалоба владельца «навожусь
 *  и не получаю информации»): живой JS-ховер — вертикальная направляющая,
 *  подсвеченная точка и стеклянный тултип со значением/датой; движение —
 *  только opacity/позиции, деликатно (reduced-motion не страдает: без
 *  оркестраций, тултип следует курсору). Зум по времени — окно DaysTabs. */

const W = 640;
const H = 150;
const LABEL_H = 18;

const dayLabel = (bucket: string): string => `${bucket.slice(8, 10)}.${bucket.slice(5, 7)}`;

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
  if (points.length === 0) {
    return <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", padding: "var(--sp-2) 0" }}>—</div>;
  }
  const counts = points.map((p) => p.count);
  const maxY = niceMax(Math.max(...counts));
  const box = { w: W, h: H, maxY };
  const xAt = (i: number) => (points.length === 1 ? W / 2 : (i * W) / (points.length - 1));
  const barCenter = (i: number) => (i + 0.5) * (W / points.length);
  const centerAt = mode === "bars" ? barCenter : xAt;
  const yAt = (v: number) => H - (v / maxY) * H;
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
  const tipLeft = hover !== null ? Math.min(Math.max((centerAt(hover) / W) * 100, 7), 93) : 0;

  return (
    <div
      ref={boxRef}
      style={{ position: "relative" }}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H + LABEL_H}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {[0, H / 2, H].map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="var(--text-3)" strokeWidth={1} opacity={0.15} />
        ))}
        <text x={W} y={11} textAnchor="end" fill="var(--text-3)" fontSize={11}>
          {maxY}
        </text>
        {/* вертикальная направляющая ховера */}
        {hover !== null ? (
          <line
            x1={centerAt(hover)}
            y1={0}
            x2={centerAt(hover)}
            y2={H}
            stroke="var(--text-2)"
            strokeWidth={1}
            opacity={0.35}
          />
        ) : null}
        {mode === "line" ? (
          <>
            <path d={`${d}L${W},${H}L0,${H}Z`} fill={color} opacity={0.08} />
            <path
              data-line
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((p, i) => (
              <circle
                key={p.bucket}
                cx={xAt(i)}
                cy={yAt(p.count)}
                r={hover === i ? 5 : 3}
                fill={color}
                opacity={hover === null || hover === i ? 1 : 0.45}
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
              rx={2}
              fill={color}
              opacity={hover === null || hover === i ? 1 : 0.45}
              style={{ transition: "opacity var(--dur-state) var(--ease-standard)" }}
            />
          ))
        )}
        {xTickIndexes(points.length, 6).map((i) => (
          <text
            key={points[i].bucket}
            x={centerAt(i)}
            y={H + 13}
            textAnchor="middle"
            fill="var(--text-3)"
            fontSize={11}
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
            top: 2,
            transform: "translateX(-50%)",
            padding: "4px 10px",
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
          <span style={{ fontWeight: 600 }}>{hovered.count}</span>
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>{dayLabel(hovered.bucket)}</span>
        </div>
      ) : null}
    </div>
  );
}
