import React, { useState } from "react";
import { Icon } from "./Icon.jsx";
// Кросс-импорт внутри @muza/ui — цикла нет: Tooltip не тянет IconButton.
import { Tooltip } from "../feedback/Tooltip.jsx";

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
  noTooltip = false,
  tooltipPlacement,
}) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);

  const d = size === "lg" ? 52 : size === "sm" ? 36 : 44;
  const glyph = iconSize || (size === "lg" ? 24 : size === "sm" ? 18 : 20);

  const bg =
    variant === "accent"
      /* роль акцента «play»: свой цвет play-кнопок, фолбэк — общий акцент */
      ? hover ? "var(--accent-play-hover, var(--accent-hover))" : "var(--accent-play, var(--accent))"
      : variant === "surface"
        ? hover ? "var(--surface-4)" : "var(--surface-3)"
        : hover ? "var(--surface-2)" : "transparent";
  const fg =
    variant === "accent"
      /* пара к ролевому фону: иконка от яркости цвета play-роли, фолбэк — общий on-accent */
      ? "var(--text-on-accent-play, var(--text-on-accent))"
      : active
        ? "var(--accent-text)"
        : hover ? "var(--text-1)" : "var(--text-2)";

  const button = (
    <button
      type="button"
      // невидимое расширение зоны попадания до --hit-min: sm-кнопка 36px (и
      // любое ужатие через style) остаётся маленькой глазу, но не мыши
      className="muza-hit"
      aria-label={label || icon}
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
        /* ДВА РАЗНЫХ СМЫСЛА КРУГЛОГО, И ИХ НЕЛЬЗЯ ПУТАТЬ (2026-08-13).
           variant="accent" — это play-кнопка, и только она (см. d.ts и все
           шесть мест вызова: полоса плеера, режим прослушивания, плитка,
           мини-плеер, мобильный плеер). Она круглая ПО ЗАМЫСЛУ: единственный
           орган, который человек ищет глазами, не читая. Владелец 2026-08-13
           сказал об этом прямо — «Ладно, кнопка Play — она круглая, но всё
           остальное выглядит странно», — то есть просил не выключить её форму,
           а перестать круглить всё подряд заодно с ней.
           Остальные кнопки-иконки — обычные органы управления и слушаются
           общего скругления через --r-control (tokens/radius.css). */
        borderRadius: variant === "accent" ? "var(--r-pill)" : "var(--r-control, var(--r-pill))",
        background: bg,
        color: fg,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transform: press && !disabled ? "scale(var(--press-scale))" : "scale(1)",
        /* НАЖАТИЕ И ОТПУСКАНИЕ РАЗНЫЕ (2026-08-05). Нажатие обязано уложиться в
           порог восприятия причинности (~100 мс) — иначе палец читает его как
           «не попал»; отпускание длиннее, форма расслабляется, а не отскакивает.
           Здесь это выразимо, потому что press — состояние React: у строки
           трека и плитки transition инлайновый и такой развилки пока не даёт. */
        transition: `background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard), transform ${
          press && !disabled ? "var(--dur-press-in) var(--ease-standard)" : "var(--dur-press-out) var(--ease-out)"
        }`,
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

  // Красивая подсказка — централизованно: нативный title убран (уродливая
  // белая обводка + задвоение с внешним Tooltip). Есть label и не запрещено —
  // оборачиваем сами; иначе голая кнопка (имя иконки в подсказку не годится).
  if (label && noTooltip !== true) {
    return (
      <Tooltip label={label} placement={tooltipPlacement || "top"}>
        {button}
      </Tooltip>
    );
  }
  return button;
}
