import React, { useState } from "react";
import { Icon } from "./Icon.jsx";

/** Цветовой свотч с нативным пикером под маской — кружок текущего цвета,
 *  пипетка проявляется на ховере/фокусе. Выбранность показывает кольцо
 *  (outline, не тень — теней в ДС нет). Родился из CustomAccentSwatch
 *  настроек десктопа; hex-подпись — опционально. */
export function ColorPicker({ value = "#3b82f6", onChange, label, selected = false, size = 36, showValue = false, style }) {
  const [hover, setHover] = useState(false);
  return (
    <label
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        cursor: "pointer",
        ...style,
      }}
    >
      <span
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          background: value,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          outline: selected ? "2px solid var(--text-1)" : hover ? "2px solid var(--surface-4)" : "2px solid transparent",
          outlineOffset: 2,
          transition: "outline-color var(--dur-fast) var(--ease-out)",
          flex: "none",
        }}
      >
        <Icon
          name="pipette"
          size={Math.round(size * 0.44)}
          color="rgba(255,255,255,0.92)"
          style={{
            opacity: hover ? 1 : 0,
            transition: "opacity var(--dur-fast) var(--ease-out)",
          }}
        />
        <input
          type="color"
          value={value}
          aria-label={label}
          onChange={(e) => onChange && onChange(e.target.value)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "pointer",
          }}
        />
      </span>
      {showValue ? (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            color: "var(--text-2)",
            fontVariantNumeric: "tabular-nums",
            textTransform: "uppercase",
          }}
        >
          {value}
        </span>
      ) : null}
    </label>
  );
}
