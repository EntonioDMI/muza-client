import React, { useRef, useState, useLayoutEffect } from "react";

/** Segmented tabs — the selected background SLIDES between segments (never blinks).
 *  stretch: сегменты делят всю ширину контейнера поровну (формы, узкие карточки).
 *  wrap: сегменты переносятся на следующие строки — все вкладки видны при любой
 *  ширине (много разделов; скрытый горизонтальный скролл — антипаттерн). */
export function Tabs({ items, value, onChange, stretch = false, wrap = false, style }) {
  const wrapRef = useRef(null);
  const [hoverKey, setHoverKey] = useState(null);
  const [ind, setInd] = useState(null); // { left, top, width }

  // Подписи набора (склейка через NUL: такого символа в подписи быть не может, а
  // через пробел ["Rock Pop"] и ["Rock", "Pop"] дали бы одну подпись). keysKey —
  // какие сегменты есть в DOM (React пересоздаёт кнопки только при смене key) → по
  // нему пересобираем подписку RO. labelsKey — что в них написано: смена языка UI
  // или размера текста переразмечает сегменты при том же value и том же числе
  // вкладок, а без этой зависимости эффект бы промолчал.
  const keysKey = items.map((it) => (typeof it === "string" ? it : it.key)).join("\u0000");
  const labelsKey = items.map((it) => (typeof it === "string" ? it : it.label)).join("\u0000");

  const measure = () => {
    const el0 = wrapRef.current;
    if (!el0) return;
    const el = el0.querySelector('[data-tabkey="' + String(value).replace(/"/g, "") + '"]');
    if (!el) { setInd(null); return; }
    setInd({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth });
  };

  // RO переживает много рендеров (пересоздаётся только при смене набора сегментов)
  // → зовёт свежую measure через ref; замыкание рендера подписки возвращало бы
  // пилюлю на старый таб (смена веса шрифта при выборе меняет ширину сегментов
  // и триггерит RO после каждого клика)
  const measureRef = useRef(measure);
  measureRef.current = measure;

  useLayoutEffect(() => {
    measure();
    // Не-wrap таб-бар может жить в overflow-скролле (узкое окно): активный
    // сегмент подъезжает в видимость. Скроллим ТОЛЬКО горизонтальный контейнер
    // руками — scrollIntoView дёргал бы и вертикальные скроллы предков.
    const wrapEl = wrapRef.current;
    const el = wrapEl?.querySelector('[data-tabkey="' + String(value).replace(/"/g, "") + '"]');
    const scroller = wrapEl?.parentElement;
    if (el && scroller && scroller.scrollWidth > scroller.clientWidth) {
      const er = el.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      if (er.left < sr.left) scroller.scrollLeft += er.left - sr.left - 8;
      else if (er.right > sr.right) scroller.scrollLeft += er.right - sr.right + 8;
    }
  }, [value, keysKey, labelsKey]);
  // Шрифт мог ещё не догрузиться к моменту замера. @fontsource тянет сабсеты
  // лениво, по unicode-range: первый же показ кириллицы (переключение языка на
  // RU) рендерится ФОЛБЭК-шрифтом, и measure() выше снимает его метрики; потом
  // приезжает Golos Text, текст переразмечается, а пилюля остаётся по старым
  // числам. Живой репро: первый EN→RU давал пилюлю 124/150 против сегмента
  // 123/153, любое следующее переключение (сабсет уже в кэше) — точь-в-точь.
  // fonts.ready резолвится ПОСЛЕ загрузки шрифтов и связанной с ними разметки —
  // ровно тот момент, когда надо перемерить.
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
    const wrapEl = wrapRef.current;
    if (!wrapEl) return;
    const ro = new ResizeObserver(() => measureRef.current());
    // Наблюдаем КАЖДЫЙ сегмент, а не только таблист: сегменты переразмечаются
    // внутри контейнера, бокс которого не меняется (wrap: ширину задаёт родитель,
    // высота — те же два ряда), — RO на одном контейнере такое проспит. Таблист
    // тоже наблюдаем: перенос строк двигает сегменты, не меняя их размера.
    // Пилюля absolute → layout не трогает → петли RO → resize → RO не будет.
    ro.observe(wrapEl);
    wrapEl.querySelectorAll("[data-tabkey]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [keysKey]);

  return (
    <div
      ref={wrapRef}
      role="tablist"
      style={{
        position: "relative",
        display: stretch || wrap ? "flex" : "inline-flex",
        flexWrap: wrap ? "wrap" : "nowrap",
        gap: 4,
        padding: 4,
        borderRadius: wrap ? "var(--r-md)" : "var(--r-tabs, var(--r-pill))",
        background: "var(--surface-1)",
        ...style,
      }}
    >
      {ind ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: ind.top ?? 4,
            left: ind.left,
            width: ind.width,
            height: 36,
            borderRadius: "var(--r-tabs, var(--r-pill))",
            background: "var(--surface-4)",
            transition:
              "left var(--dur-base) var(--ease-out), top var(--dur-base) var(--ease-out), width var(--dur-base) var(--ease-out)",
          }}
        ></div>
      ) : null}
      {items.map((it) => {
        const key = typeof it === "string" ? it : it.key;
        const label = typeof it === "string" ? it : it.label;
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            data-tabkey={key}
            onClick={() => onChange && onChange(key)}
            onMouseEnter={() => setHoverKey(key)}
            onMouseLeave={() => setHoverKey(null)}
            style={{
              position: "relative",
              zIndex: 1,
              flex: stretch ? 1 : wrap ? "1 0 auto" : "none", // wrap: сегменты заполняют ряд целиком (без пустого хвоста плашки)
              height: 36,
              padding: stretch ? "0 var(--sp-2)" : "0 var(--sp-4)",
              border: "none",
              borderRadius: "var(--r-tabs, var(--r-pill))",
              background: !selected && hoverKey === key ? "var(--surface-2)" : "transparent",
              color: selected ? "var(--text-1)" : "var(--text-2)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-body)",
              fontWeight: selected ? "var(--fw-semibold)" : "var(--fw-medium)",
              lineHeight: 1,
              cursor: "pointer",
              transition: "background var(--dur-fast) var(--ease-out), color var(--dur-base) var(--ease-out)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
