import type { AdminDayPoint } from "@muza/api-client";
import { barGeometry, linePath, niceMax, xTickIndexes } from "../lib/adminChartMath";

/** SVG-график дневной серии (админка, кусок C). Свой рендер на токенах ДС —
 *  без чарт-библиотек (конвенция проекта). СТАТИЧНЫЙ по построению: анимаций
 *  нет вовсе, prefers-reduced-motion уважён автоматически; тултипы — нативные
 *  <title> (значение по наведению), никакого JS-ховера. */

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
  if (points.length === 0) {
    return <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", padding: "var(--sp-2) 0" }}>—</div>;
  }
  const counts = points.map((p) => p.count);
  const maxY = niceMax(Math.max(...counts));
  const box = { w: W, h: H, maxY };
  const xAt = (i: number) => (points.length === 1 ? W / 2 : (i * W) / (points.length - 1));
  const yAt = (v: number) => H - (v / maxY) * H;
  const d = linePath(counts, box);

  return (
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
            <circle key={p.bucket} cx={xAt(i)} cy={yAt(p.count)} r={3} fill={color}>
              <title>{`${p.bucket}: ${p.count}`}</title>
            </circle>
          ))}
        </>
      ) : (
        barGeometry(counts, box).map((b, i) => (
          <rect data-bar key={points[i].bucket} x={b.x} y={b.y} width={b.w} height={b.h} rx={2} fill={color}>
            <title>{`${points[i].bucket}: ${points[i].count}`}</title>
          </rect>
        ))
      )}
      {xTickIndexes(points.length, 6).map((i) => (
        <text
          key={points[i].bucket}
          x={mode === "bars" ? (i + 0.5) * (W / points.length) : xAt(i)}
          y={H + 13}
          textAnchor="middle"
          fill="var(--text-3)"
          fontSize={11}
        >
          {dayLabel(points[i].bucket)}
        </text>
      ))}
    </svg>
  );
}
