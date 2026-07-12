import React from "react";

/** Плашка-клавиша (разделы хоткеев, подсказки жестов). Родом из настроек
 *  десктопа — переехала в ДС, когда понадобилась и вебу. */
export function Kbd({ children, style }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "var(--r-xs)",
        background: "var(--surface-3)",
        color: "var(--text-1)",
        fontSize: "var(--fs-caption)",
        fontWeight: 600,
        fontFamily: "var(--font-ui)",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
