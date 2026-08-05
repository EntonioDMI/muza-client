import React, { useState } from "react";
import { Icon } from "./Icon.jsx";

/** Muza button — pill-shaped, no borders, no shadows. */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  disabled = false,
  onClick,
  style,
}) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);

  const h = size === "lg" ? 48 : 40;
  const bg =
    variant === "primary"
      ? hover ? "var(--accent-hover)" : "var(--accent)"
      : variant === "ghost"
        ? hover ? "var(--surface-2)" : "transparent"
        : hover ? "var(--surface-4)" : "var(--surface-3)";
  const fg =
    variant === "primary"
      ? "var(--text-on-accent)"
      : variant === "ghost"
        ? hover ? "var(--text-1)" : "var(--text-2)"
        : "var(--text-1)";

  return (
    <button
      type="button"
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
        gap: "var(--sp-2)",
        height: h,
        padding: "0 " + (size === "lg" ? "26px" : "20px"),
        border: "none",
        /* «скругление по типам» может квадратить кнопки; дефолт — пилюля */
        borderRadius: "var(--r-control, var(--r-pill))",
        background: bg,
        color: fg,
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        fontWeight: "var(--fw-semibold)",
        lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transform: press && !disabled ? "scale(var(--press-scale))" : "scale(1)",
        /* Несимметричное нажатие — разбор у того же места в IconButton.jsx. */
        transition: `background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard), transform ${
          press && !disabled ? "var(--dur-press-in) var(--ease-standard)" : "var(--dur-press-out) var(--ease-out)"
        }`,
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={size === "lg" ? 20 : 18} filled={variant === "primary" && (icon === "play" || icon === "pause")} /> : null}
      {children}
    </button>
  );
}
