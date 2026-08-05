import React, { useLayoutEffect, useRef, useState, useEffect } from "react";
import { portal } from "../../lib/layerRoot.js";
import { cssZoom } from "../../lib/cssZoom.js";
import { DELAY_TIP } from "../../lib/motion.js";
import { useLayerState } from "../../lib/useLayerState.js";

/** Tooltip — small frosted label near its child, 450 ms hover delay.
 *  Клавиатура равноправна мыши: подсказка всплывает и по ФОКУСУ. Это не
 *  украшение — IconButton заворачивает в Tooltip каждую кнопку с label, и для
 *  того, кто ходит табуляцией, это единственная видимая подпись у кнопок
 *  плеера (аудит 02.08: без неё вся транспортная панель — безымянные кружки).
 *
 *  ПОРТАЛИТСЯ И ПЕРЕВОРАЧИВАЕТСЯ (04.08). Раньше подсказка была
 *  position:absolute от своей обёртки — и любой overflow по дороге её резал:
 *  «подсказка уходит за плеер», «вылезает за пределы окна» (жалобы владельца).
 *  Направление приходилось задавать руками у каждой кнопки. Теперь пузырёк
 *  уходит порталом в theme-div (lib/layerRoot.js — там же почему НЕ body),
 *  координаты делятся на cssZoom, а при нехватке места сверху/снизу подсказка
 *  сама переворачивается; `placement` остался ПРЕДПОЧТЕНИЕМ, не приказом.
 *  z=300 — выше диалога (200) и палитры (150): подсказки живут и внутри них.
 *
 *  Узел существует ТОЛЬКО пока подсказка видна. Прежде он жил в разметке
 *  всегда (110 узлов на Главной) и ради скорости даже blur включался условно;
 *  теперь скрытая подсказка не стоит ничего.
 *
 *  УХОД — 80 мс ПО ПРОЗРАЧНОСТИ (2026-08-05). Раньше здесь стояло обратное
 *  решение: «исчезновение мгновенное, как у системных подсказок, провожать
 *  взглядом нечего». Оно верно для подсказки, которая уходит вместе с курсором,
 *  но эта — ПОРТАЛИТСЯ и схлопывается ровно там, где курсор ещё стоит: кадровое
 *  исчезновение под неподвижной мышью читается не как «ушла», а как сбой
 *  отрисовки. Гашение короче любого другого слоя и БЕЗ движения — сдвиг сделал
 *  бы из неё второй объект, за которым зачем-то надо следить (.muza-layer--tip
 *  в animations.css). Задержку появления держит DELAY_TIP из lib/motion.js. */
export function Tooltip({ label, placement = "top", children, style }) {
  const [show, setShow] = useState(false);
  /** Позиция в единицах theme-div (экранные px / zoom); null — ещё меряем. */
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const tip = useRef(null);
  const timer = useRef(null);
  // Хук берёт НАШ ref: тот же узел меряется на переворот.
  const { mounted, layerProps } = useLayerState(show, { ref: tip });

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const enter = () => {
    clear();
    timer.current = setTimeout(() => setShow(true), DELAY_TIP);
  };
  const leave = () => {
    clear();
    setShow(false);
  };
  // По фокусу — СРАЗУ, без паузы: задержка защищает от мельтешения, когда
  // мышь проезжает над рядом кнопок; табуляция так не «проезжает».
  const focus = () => {
    clear();
    setShow(true);
  };
  // Таймер не должен пережить размонтирование: сработавший setState на снятом
  // компоненте — утечка и предупреждение React (напр. кнопка исчезла, пока
  // подсказка ещё «думала»).
  useEffect(() => clear, []);

  // Позиция считается ПОСЛЕ монтирования пузырька: сначала рендерим его
  // невидимым, меряем настоящий размер, затем ставим на место — до первой
  // отрисовки, глаз черновой кадр не видит (useLayoutEffect синхронен).
  // Сброс позиции — по СНЯТИЮ УЗЛА, а не по show: узел переживает show=false на
  // время гашения, и обнуление позиции швырнуло бы гаснущий пузырёк в левый
  // верхний угол окна.
  useLayoutEffect(() => {
    if (!mounted) {
      setPos(null);
      return;
    }
    if (!show) return; // уходит — мерить нечего, позиция уже стоит
    const anchor = wrap.current;
    const el = tip.current;
    if (!anchor || !el) return;
    const M = 8; // поле до кромок окна
    const GAP = 8; // зазор до кнопки
    const a = anchor.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const z = cssZoom(el) || 1;
    let x = a.left + a.width / 2 - t.width / 2;
    x = Math.min(Math.max(x, M), window.innerWidth - t.width - M);
    const above = a.top - t.height - GAP;
    const below = a.bottom + GAP;
    let y;
    if (placement === "top") {
      y = above >= M ? above : below; // сверху не влезла — вниз
    } else {
      y = below + t.height <= window.innerHeight - M ? below : above; // снизу не влезла — вверх
    }
    y = Math.min(Math.max(y, M), window.innerHeight - t.height - M);
    setPos({ left: x / z, top: y / z });
  }, [mounted, show, placement, label]);

  // Прокрутка под открытой подсказкой — прячем: кнопка уехала, пузырёк без
  // якоря повисает в воздухе. Так ведут себя и системные подсказки.
  useEffect(() => {
    if (!show) return;
    const hide = () => leave();
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  return (
    <span
      ref={wrap}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={focus}
      onBlur={leave}
      style={{ position: "relative", display: "inline-flex", ...style }}
    >
      {children}
      {mounted
        ? portal(
            <span
              {...layerProps}
              aria-hidden="true"
              className="muza-layer muza-layer--tip"
              style={{
                position: "fixed",
                left: pos ? pos.left : 0,
                top: pos ? pos.top : 0,
                visibility: pos ? "visible" : "hidden",
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
                pointerEvents: "none",
                zIndex: 300,
              }}
            >
              {label}
            </span>,
          )
        : null}
    </span>
  );
}
