import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";

/* ── hex ⇄ HSV ─────────────────────────────────────────────────────
   SV-квадрат и hue-слайдер работают во внутренних HSV-координатах;
   наружу компонент всегда отдаёт/принимает hex (#rrggbb) — контракт
   ColorPicker не меняется. */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToHsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

function hsvToHex(h, s, v) {
  return rgbToHex(hsvToRgb(h, s, v));
}

/** #rgb / #rrggbb (с # или без) → нормализованный "#rrggbb" в нижнем регистре; иначе null. */
function parseHex(input) {
  const m = String(input).trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return "#" + h.toLowerCase();
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

const SV_SIZE = 200;      // сторона SV-квадрата, px
const SV_HEIGHT = 160;
const HUE_H = 18;         // высота обёртки hue-слайдера (сам трек — 14, по центру)
const PANEL_PAD = 16;     // var(--sp-4)
const PANEL_GAP = 12;     // var(--sp-3)
const PANEL_W = SV_SIZE + PANEL_PAD * 2;
const PANEL_H_EST = PANEL_PAD * 2 + SV_HEIGHT + PANEL_GAP + HUE_H + PANEL_GAP + 36;

/** Круглая ручка-индикатор поверх SV/hue — белое кольцо + тонкий тёмный
 *  контур для контраста на светлых участках градиента (теней в ДС нет). */
function thumbStyle(left, top) {
  return {
    position: "absolute",
    left,
    top,
    width: 16,
    height: 16,
    marginLeft: -8,
    marginTop: -8,
    borderRadius: "50%",
    border: "2px solid #fff",
    outline: "1px solid rgba(0,0,0,.35)",
    outlineOffset: -1,
    boxSizing: "border-box",
    pointerEvents: "none",
  };
}

/** Popover-тело пикера: SV-квадрат + hue-слайдер + hex-поле + текущий/новый свотч.
 *  Внутреннее состояние — HSV, инициализируется из value один раз при монтировании
 *  (popover монтируется заново на каждое открытие) — так круг hue не «убегает»
 *  при s=0/v=0..1, где hex→HSV неоднозначен. */
function ColorPickerPopover({ anchor, initialHex, label, onChange, onClose }) {
  const [hsv, setHsv] = useState(() => hexToHsv(initialHex));
  const [hexText, setHexText] = useState(initialHex);
  const [svDrag, setSvDrag] = useState(false);
  const [hueDrag, setHueDrag] = useState(false);

  const svRef = useRef(null);
  const hueRef = useRef(null);
  const panelRef = useRef(null);
  const hexInputRef = useRef(null);
  const restoreRef = useRef(null);

  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);

  const applyHsv = (next) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    setHexText(hex);
    if (onChange) onChange(hex);
  };

  // фокус на hex-поле при открытии, Escape закрывает, фокус возвращается на свотч
  useEffect(() => {
    restoreRef.current = document.activeElement;
    hexInputRef.current?.focus();
    hexInputRef.current?.select();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose && onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const el = restoreRef.current;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSvFromEvent = (e) => {
    if (!svRef.current) return;
    const r = svRef.current.getBoundingClientRect();
    const s = clamp01((e.clientX - r.left) / r.width);
    const v = clamp01(1 - (e.clientY - r.top) / r.height);
    applyHsv({ h: hsv.h, s, v });
  };

  const setHueFromEvent = (e) => {
    if (!hueRef.current) return;
    const r = hueRef.current.getBoundingClientRect();
    const p = clamp01((e.clientX - r.left) / r.width);
    applyHsv({ h: p * 360, s: hsv.s, v: hsv.v });
  };

  const onHexInput = (raw) => {
    setHexText(raw);
    const parsed = parseHex(raw);
    if (parsed) {
      setHsv(hexToHsv(parsed));
      if (onChange) onChange(parsed);
    }
  };

  const onHexBlur = () => {
    setHexText(parseHex(hexText) || currentHex);
  };

  const revertToInitial = () => applyHsv(hexToHsv(initialHex));

  return (
    <div
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose && onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 150 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label ? `Выбор цвета: ${label}` : "Выбор цвета"}
        className="muza-colorpicker-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: anchor.left,
          top: anchor.top,
          width: PANEL_W,
          boxSizing: "border-box",
          padding: "var(--sp-4)",
          borderRadius: "var(--r-md)",
          /* зональная прозрачность: своё стекло меню, фолбэк — общее (как Menu/Select) */
          background: "var(--glass-menu, var(--glass-panel))",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
          animation: "muzaColorPickerIn var(--dur-fast) var(--ease-out)",
        }}
      >
        <style>{"@keyframes muzaColorPickerIn{from{opacity:0;transform:translateY(6px) scale(.98)}}@media (prefers-reduced-motion: reduce){.muza-colorpicker-panel{animation:none!important}}"}</style>

        {/* SV-квадрат: насыщенность по X, яркость по Y (сверху — v=1) */}
        <div style={{ position: "relative", width: SV_SIZE, height: SV_HEIGHT }}>
          <div
            ref={svRef}
            role="slider"
            aria-label="Насыщенность и яркость"
            aria-valuenow={Math.round(hsv.v * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`Насыщенность ${Math.round(hsv.s * 100)}%, яркость ${Math.round(hsv.v * 100)}%`}
            tabIndex={0}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setSvDrag(true); setSvFromEvent(e); }}
            onPointerMove={(e) => {
              if (!svDrag) return;
              if (e.pointerType === "mouse" && (e.buttons & 1) === 0) { setSvDrag(false); return; }
              setSvFromEvent(e);
            }}
            onPointerUp={() => setSvDrag(false)}
            onPointerCancel={() => setSvDrag(false)}
            onLostPointerCapture={() => setSvDrag(false)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02;
              let next = null;
              if (e.key === "ArrowRight") next = { h: hsv.h, s: clamp01(hsv.s + step), v: hsv.v };
              else if (e.key === "ArrowLeft") next = { h: hsv.h, s: clamp01(hsv.s - step), v: hsv.v };
              else if (e.key === "ArrowUp") next = { h: hsv.h, s: hsv.s, v: clamp01(hsv.v + step) };
              else if (e.key === "ArrowDown") next = { h: hsv.h, s: hsv.s, v: clamp01(hsv.v - step) };
              if (!next) return;
              e.preventDefault();
              applyHsv(next);
            }}
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "var(--r-sm)",
              overflow: "hidden",
              cursor: "crosshair",
              touchAction: "none",
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h}, 100%, 50%)`,
            }}
          />
          <div aria-hidden="true" style={thumbStyle(hsv.s * SV_SIZE, (1 - hsv.v) * SV_HEIGHT)} />
        </div>

        {/* Hue-слайдер: горизонтальная радуга 0..360° */}
        <div style={{ position: "relative", width: SV_SIZE, height: HUE_H }}>
          <div
            ref={hueRef}
            role="slider"
            aria-label="Оттенок"
            aria-valuenow={Math.round(hsv.h)}
            aria-valuemin={0}
            aria-valuemax={359}
            tabIndex={0}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHueDrag(true); setHueFromEvent(e); }}
            onPointerMove={(e) => {
              if (!hueDrag) return;
              if (e.pointerType === "mouse" && (e.buttons & 1) === 0) { setHueDrag(false); return; }
              setHueFromEvent(e);
            }}
            onPointerUp={() => setHueDrag(false)}
            onPointerCancel={() => setHueDrag(false)}
            onLostPointerCapture={() => setHueDrag(false)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 20 : 4;
              let h = null;
              if (e.key === "ArrowRight" || e.key === "ArrowUp") h = (hsv.h + step) % 360;
              else if (e.key === "ArrowLeft" || e.key === "ArrowDown") h = (hsv.h - step + 360) % 360;
              if (h === null) return;
              e.preventDefault();
              applyHsv({ h, s: hsv.s, v: hsv.v });
            }}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "50%",
              height: 14,
              transform: "translateY(-50%)",
              borderRadius: "var(--r-pill)",
              overflow: "hidden",
              cursor: "pointer",
              touchAction: "none",
              background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
          />
          <div aria-hidden="true" style={thumbStyle((hsv.h / 360) * SV_SIZE, HUE_H / 2)} />
        </div>

        {/* Текущий/новый свотч + hex-ввод */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <div style={{ display: "flex", flex: "none" }} title="Текущий / новый цвет">
            <button
              type="button"
              onClick={revertToInitial}
              aria-label="Вернуть исходный цвет"
              title="Исходный цвет"
              style={{
                width: 28,
                height: 28,
                borderRadius: "var(--r-xs) 0 0 var(--r-xs)",
                background: initialHex,
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            />
            <span
              aria-hidden="true"
              title="Новый цвет"
              style={{
                width: 28,
                height: 28,
                borderRadius: "0 var(--r-xs) var(--r-xs) 0",
                background: currentHex,
                flex: "none",
              }}
            />
          </div>
          <input
            ref={hexInputRef}
            type="text"
            value={hexText}
            onChange={(e) => onHexInput(e.target.value)}
            onBlur={onHexBlur}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label="Hex-код цвета"
            spellCheck={false}
            maxLength={7}
            style={{
              flex: 1,
              minWidth: 0,
              height: 36,
              padding: "0 var(--sp-3)",
              border: "none",
              borderRadius: "var(--r-xs)",
              background: "var(--surface-3)",
              color: "var(--text-1)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-body)",
              fontVariantNumeric: "tabular-nums",
              textTransform: "uppercase",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Цветовой свотч — кружок текущего цвета, пипетка проявляется на ховере/фокусе.
 *  Клик открывает НАШ popover-пикер ДС (SV-квадрат + hue + hex) вместо системного
 *  диалога — родной `<input type="color">` не стилизуется никак, отсюда и переезд.
 *  Выбранность показывает кольцо (outline, не тень — теней в ДС нет). Родился из
 *  CustomAccentSwatch настроек десктопа; hex-подпись — опционально. */
export function ColorPicker({ value = "#3b82f6", onChange, label, selected = false, size = 36, showValue = false, style }) {
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const triggerRef = useRef(null);
  // «исходный» hex для сравнения/revert внутри popover'а — фиксируется в момент
  // открытия и НЕ пересчитывается из живого value (иначе он «уезжает» вслед за
  // онгоинг-перетаскиванием и revert превращается в no-op).
  const openedWithRef = useRef(parseHex(value) || "#3b82f6");

  // позиция popover'а от свотча; переворот вверх/влево у краёв вьюпорта
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 8;
    if (left + PANEL_W > window.innerWidth - 8) left = window.innerWidth - 8 - PANEL_W;
    if (left < 8) left = 8;
    if (top + PANEL_H_EST > window.innerHeight - 8) {
      const above = r.top - 8 - PANEL_H_EST;
      top = above > 8 ? above : Math.max(8, window.innerHeight - 8 - PANEL_H_EST);
    }
    setAnchor({ left, top });
  }, [open]);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", ...style }}>
      <button
        ref={triggerRef}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => {
          const next = !v;
          if (next) openedWithRef.current = parseHex(value) || "#3b82f6";
          return next;
        })}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          background: value,
          border: "none",
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          outline: selected ? "2px solid var(--text-1)" : hover || open ? "2px solid var(--surface-4)" : "2px solid transparent",
          outlineOffset: 2,
          transition: "outline-color var(--dur-fast) var(--ease-out)",
          flex: "none",
          cursor: "pointer",
        }}
      >
        <Icon
          name="pipette"
          size={Math.round(size * 0.44)}
          color="rgba(255,255,255,0.92)"
          style={{
            opacity: hover || open ? 1 : 0,
            transition: "opacity var(--dur-fast) var(--ease-out)",
          }}
        />
      </button>
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
      {open && anchor ? (
        <ColorPickerPopover
          anchor={anchor}
          initialHex={openedWithRef.current}
          label={label}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}
