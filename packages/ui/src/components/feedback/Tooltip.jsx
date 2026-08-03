import React, { useState, useRef, useEffect } from "react";

/** Tooltip — small frosted label under (or over) its child, 450 ms hover delay.
 *  Клавиатура равноправна мыши: подсказка всплывает и по ФОКУСУ. Это не
 *  украшение — IconButton заворачивает в Tooltip каждую кнопку с label, и для
 *  того, кто ходит табуляцией, это единственная видимая подпись у кнопок
 *  плеера (аудит 02.08: без неё вся транспортная панель — безымянные кружки). */
export function Tooltip({ label, placement = "top", children, style }) {
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const enter = () => {
    clear();
    timer.current = setTimeout(() => setShow(true), 450);
  };
  const leave = () => {
    clear();
    setShow(false);
  };
  // По фокусу — СРАЗУ, без 450 мс: задержка защищает от мельтешения, когда
  // мышь проезжает над рядом кнопок; табуляция так не «проезжает».
  const focus = () => {
    clear();
    setShow(true);
  };
  // Таймер не должен пережить размонтирование: сработавший setState на снятом
  // компоненте — утечка и предупреждение React (напр. кнопка исчезла, пока
  // подсказка ещё «думала»).
  useEffect(() => clear, []);

  const top = placement === "top";
  return (
    <span
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={focus}
      onBlur={leave}
      style={{ position: "relative", display: "inline-flex", ...style }}
    >
      {children}
      <span
        aria-hidden={!show}
        style={{
          position: "absolute",
          left: "50%",
          [top ? "bottom" : "top"]: "calc(100% + 8px)",
          transform: show ? "translate(-50%, 0)" : "translate(-50%, " + (top ? "4px" : "-4px") + ")",
          padding: "7px 12px",
          borderRadius: "var(--r-xs)",
          background: "var(--glass-panel)",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          color: "var(--text-1)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-caption)",
          fontWeight: "var(--fw-medium)",
          lineHeight: 1,
          whiteSpace: "nowrap",
          opacity: show ? 1 : 0,
          pointerEvents: "none",
          zIndex: 60,
          transition: "opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)",
        }}
      >
        {label}
      </span>
    </span>
  );
}
