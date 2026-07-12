import React from "react";

/** Мини-пилюля статуса: «web», «новое», счётчики. tone: accent — акцентная
 *  мягкая заливка; neutral — surface. Один бейдж на элемент, не гирлянда. */
export function Badge({ children, tone = "accent", style }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "var(--r-pill, 999px)",
        background: tone === "accent" ? "var(--accent-soft)" : "var(--surface-3)",
        color: tone === "accent" ? "var(--accent-text)" : "var(--text-2)",
        fontFamily: "var(--font-ui)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
