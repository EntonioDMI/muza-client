import React, { useRef, useState, useLayoutEffect } from "react";
import { Icon } from "./Icon.jsx";

/** Row of filter chips with ONE selection — the highlight slides between chips. */
export function ChipGroup({ items, value, onChange, style }) {
  const wrapRef = useRef(null);
  const [hoverKey, setHoverKey] = useState(null);
  const [ind, setInd] = useState(null);

  // Подписи набора (склейка через NUL: такого символа в подписи быть не может, а
  // через пробел ["Rock Pop"] и ["Rock", "Pop"] дали бы одну подпись). keysKey —
  // какие чипы есть в DOM (React пересоздаёт кнопки только при смене key) → по нему
  // пересобираем подписку RO. labelsKey — что в них написано: смена языка UI или
  // размера текста переразмечает чипы при том же value и том же числе чипов, а без
  // этой зависимости эффект бы промолчал.
  const keysKey = items.map((it) => (typeof it === "string" ? it : it.key)).join("\u0000");
  const labelsKey = items.map((it) => (typeof it === "string" ? it : it.label)).join("\u0000");

  const measure = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const el = wrap.querySelector('[data-chipkey="' + String(value).replace(/"/g, "") + '"]');
    if (!el) { setInd(null); return; }
    setInd({ left: el.offsetLeft, width: el.offsetWidth });
  };

  // RO переживает много рендеров (пересоздаётся только при смене набора чипов) →
  // зовёт свежую measure через ref; замыкание рендера подписки возвращало бы
  // подсветку на чип, выбранный на момент подписки (ресайз окна после выбора)
  const measureRef = useRef(measure);
  measureRef.current = measure;

  useLayoutEffect(measure, [value, keysKey, labelsKey]);

  // Перемер после догрузки шрифта — та же причина, что в Tabs.jsx (@fontsource
  // тянет сабсеты лениво: первый показ кириллицы меряется фолбэк-метриками).
  useLayoutEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.ready) return;
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) measureRef.current();
    });
    return () => { alive = false; };
  }, [labelsKey]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => measureRef.current());
    // Наблюдаем КАЖДЫЙ чип, а не только ряд: чипы переразмечаются внутри
    // контейнера, ширину которому задаёт родитель, — RO на одном ряду это
    // проспит. Подсветка absolute → layout не трогает → петли RO не будет.
    ro.observe(wrap);
    wrap.querySelectorAll("[data-chipkey]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [keysKey]);

  return (
    <div ref={wrapRef} role="tablist" style={{ position: "relative", display: "inline-flex", gap: "var(--sp-2)", ...style }}>
      {ind ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: ind.left,
            width: ind.width,
            height: 36,
            borderRadius: "var(--r-pill)",
            background: "var(--surface-4)",
            transition: "left var(--dur-base) var(--ease-out), width var(--dur-base) var(--ease-out)",
          }}
        ></div>
      ) : null}
      {items.map((it) => {
        const key = typeof it === "string" ? it : it.key;
        const label = typeof it === "string" ? it : it.label;
        const icon = typeof it === "string" ? null : it.icon;
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            data-chipkey={key}
            onClick={() => onChange && onChange(key)}
            onMouseEnter={() => setHoverKey(key)}
            onMouseLeave={() => setHoverKey(null)}
            style={{
              position: "relative",
              zIndex: 1,
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              height: 36,
              padding: "0 var(--sp-4)",
              border: "none",
              borderRadius: "var(--r-pill)",
              background: selected ? "transparent" : hoverKey === key ? "var(--surface-3)" : "var(--surface-2)",
              color: selected || hoverKey === key ? "var(--text-1)" : "var(--text-2)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-caption)",
              fontWeight: "var(--fw-medium)",
              lineHeight: 1,
              cursor: "pointer",
              transition: "background var(--dur-fast) var(--ease-out), color var(--dur-base) var(--ease-out)",
            }}
          >
            {icon ? <Icon name={icon} size={15} /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}
