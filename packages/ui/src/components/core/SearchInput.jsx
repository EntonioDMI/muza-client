import React, { useState } from "react";
import { Icon } from "./Icon.jsx";

/** Search field — pill, surface step on focus, thin search glyph. */
export function SearchInput({ value, onChange, placeholder = "Search", icon = "search", autoFocus = false, style }) {
  const [focus, setFocus] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <label
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 44,
        padding: "0 var(--sp-4)",
        /* «скругление по типам»: поле поиска — поле; дефолт — пилюля */
        borderRadius: "var(--r-field, var(--r-pill))",
        background: focus ? "var(--surface-4)" : hover ? "var(--surface-3)" : "var(--surface-2)",
        color: focus ? "var(--text-1)" : "var(--text-2)",
        cursor: "text",
        transition: "background var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      <Icon name={icon} size={18} />
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange && onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text-1)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-body)",
        }}
      />
    </label>
  );
}
