import React from "react";

/** Тонкое кольцо загрузки в линейном стиле ДС (штрих 2px, разрыв четверть).
 *  Цвет — currentColor: наследует текст, в акцентных местах передай color.
 *  reduced-motion гасит вращение (класс muza-spin в animations.css). */
export function Spinner({ size = 18, color = "currentColor", label = "Загрузка", style }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="muza-spin"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="status"
      aria-label={label}
      style={{ flex: "none", color, ...style }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${c * 0.72} ${c * 0.28}`}
        opacity="0.9"
      />
    </svg>
  );
}
