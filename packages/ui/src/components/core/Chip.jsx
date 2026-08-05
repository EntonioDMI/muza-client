import React, { useState } from "react";
import { Icon } from "./Icon.jsx";

/** Filter / preset chip — pill, selection by surface step + accent text. */
export function Chip({ children, icon, selected = false, onClick, style }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      // зона попадания до --hit-min по вертикали (чип 36px); ширины у чипа
      // и так хватает — min() в правиле не даст ей сжаться
      className="muza-hit"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        height: 36,
        padding: "0 var(--sp-4)",
        border: "none",
        borderRadius: "var(--r-pill)",
        background: selected ? "var(--surface-4)" : hover ? "var(--surface-3)" : "var(--surface-2)",
        color: selected ? "var(--text-1)" : hover ? "var(--text-1)" : "var(--text-2)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-caption)",
        fontWeight: "var(--fw-medium)",
        lineHeight: 1,
        cursor: "pointer",
        transition: "background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)",
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </button>
  );
}
