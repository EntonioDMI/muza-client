import React, { useState } from "react";
import { Icon } from "./Icon.jsx";

/** Round icon-only button for transport, toggles and panel chrome. */
export function IconButton({
  icon,
  filled = false,
  size = "md",
  variant = "ghost",
  active = false,
  disabled = false,
  label,
  onClick,
  iconSize,
  style,
}) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);

  const d = size === "lg" ? 52 : size === "sm" ? 36 : 44;
  const glyph = iconSize || (size === "lg" ? 24 : size === "sm" ? 18 : 20);

  const bg =
    variant === "accent"
      ? hover ? "var(--accent-hover)" : "var(--accent)"
      : variant === "surface"
        ? hover ? "var(--surface-4)" : "var(--surface-3)"
        : hover ? "var(--surface-2)" : "transparent";
  const fg =
    variant === "accent"
      ? "var(--text-on-accent)"
      : active
        ? "var(--accent-text)"
        : hover ? "var(--text-1)" : "var(--text-2)";

  return (
    <button
      type="button"
      aria-label={label || icon}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: d,
        height: d,
        flex: "none",
        border: "none",
        borderRadius: "var(--r-pill)",
        background: bg,
        color: fg,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transform: press && !disabled ? "scale(var(--press-scale))" : "scale(1)",
        transition: "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      <Icon
        name={icon}
        size={glyph}
        filled={filled || (variant === "accent" && (icon === "play" || icon === "pause"))}
      />
    </button>
  );
}
