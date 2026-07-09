import React from "react";
import { Button } from "../core/Button.jsx";

/** Home-feed shelf: section header + horizontally scrolling row of tiles. */
export function Shelf({ title, action = "Показать всё", onAction, children, style }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--sp-1)" }}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-title)",
            fontWeight: "var(--fw-bold)",
            color: "var(--text-1)",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        {onAction ? (
          <Button variant="ghost" onClick={onAction} style={{ height: 36, padding: "0 var(--sp-4)", fontSize: "var(--fs-caption)" }}>
            {action}
          </Button>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          gap: "var(--sp-4)",
          overflowX: "auto",
          scrollbarWidth: "none",
          margin: "0 calc(-1 * var(--sp-1))",
          padding: "var(--sp-1)",
        }}
      >
        {children}
      </div>
    </section>
  );
}
