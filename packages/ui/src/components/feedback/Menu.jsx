import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../core/Icon.jsx";
import { portal } from "../../lib/layerRoot.js";
import { cssZoom } from "../../lib/cssZoom.js";
import { NO_SCROLL } from "../../lib/focusNoScroll.js";
import { useLayerState } from "../../lib/useLayerState.js";

/** Context / dropdown menu — frosted panel anchored at a point.
 *  Keyboard: focus jumps into the menu on open (and back on close),
 *  Arrows/Home/End walk items, Enter activates, Escape closes.
 *  Пункт: { icon?, label, onClick?, danger?, disabled?, hint? }; "-" —
 *  разделитель; { header } — заголовок секции («Выбрано: 3»). disabled-пункт
 *  выпадает из клавиатурного обхода (селектор :not([disabled]) в moveFocus —
 *  иначе стрелки застревают на нём). hint — тихая правая подпись.
 *  Закрытие — delayed-unmount: панель остаётся в DOM, пока доигрывает уход.
 *  Механизм общий с диалогом и выпадашкой — lib/useLayerState.js + класс
 *  .muza-layer; здесь его нет ни строчки, только позиционирование и клавиши. */
/** ПУНКТ-ПОЛЗУНОК: в покое — обычная строка меню, под курсором — шкала.
 *
 *  Зачем такой вид (заказ владельца 11.08.2026). Скорость и высота тона жили
 *  кнопками в полосе плеера и циклили пресеты по клику. Два изъяна: место в
 *  баре занимала ручка, которую крутят раз в месяц («зачем она в самом
 *  плеере?»), и добираться до нужного значения приходилось многократными
 *  нажатиями («менять неудобно»). Здесь и то и другое снято: ряд лежит в меню,
 *  а значение берётся одним движением.
 *
 *  ПОЧЕМУ ЗАЛИВКА ЖИВЁТ ФОНОМ, А НЕ ОТДЕЛЬНОЙ ДОРОЖКОЙ. Дорожка под подписью
 *  сделала бы ряд вдвое выше и выбила бы его из ритма меню. Заливка — это тот
 *  же прямоугольник подсветки, только обрезанный по значению: в покое он не
 *  виден вовсе (как у любого пункта), под курсором проявляется и сразу
 *  показывает, где ты находишься. Ряд остаётся рядом меню.
 *
 *  ⚠️ Клавиатура обязана работать: стрелки двигают значение и НЕ должны уходить
 *  в обход пунктов меню — иначе фокус убежит с ползунка на первом же шаге. */
function MenuSlider({ icon, label, value, min, max, step = 1, format, onChange, hovered, onHover }) {
  const trackRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const span = max - min || 1;
  const ratio = Math.max(0, Math.min(1, (value - min) / span));
  const active = hovered || drag;

  const quantize = (raw) => {
    const snapped = Math.round(raw / step) * step;
    // Хвост двоичной ошибки: шаг 0.5 на длинной протяжке иначе даёт 1.4999997.
    const fixed = Math.round(snapped * 1000) / 1000;
    return Math.max(min, Math.min(max, fixed));
  };

  const setFromEvent = (e) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onChange(quantize(min + p * span));
  };

  const onKeyDown = (e) => {
    // Shift — крупный шаг: пройти две октавы по полутону иначе слишком долго.
    const big = e.shiftKey ? 5 : 1;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + step * big;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - step * big;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // обход пунктов меню стрелками не должен красть фокус
    onChange(quantize(next));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format ? format(value) : String(value)}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        setFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (drag) setFromEvent(e);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDrag(false);
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        /* Чуть выше обычного пункта (32) и это НАМЕРЕННО: ряд не нажимают, а
           тянут, и по 36 промахнуться труднее. Разницу в 4 px глаз в ритме
           меню не ловит, а рука ловит. */
        minHeight: 36,
        padding: "5px var(--sp-3)",
        borderRadius: "var(--r-xs)",
        color: active ? "var(--text-1)" : "var(--text-2)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        fontWeight: "var(--fw-medium)",
        cursor: "ew-resize",
        userSelect: "none",
        touchAction: "none",
        transition: "color var(--dur-state) var(--ease-standard)",
      }}
    >
      {/* Заливка по значению. Под курсором — акцентом, в покое — обычной
          подсветкой ряда: пункт не должен кричать, пока его не трогают. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: `${ratio * 100}%`,
          borderRadius: "var(--r-xs)",
          background: active ? "var(--accent-soft)" : "transparent",
          transition: "background var(--dur-state) var(--ease-standard)",
          pointerEvents: "none",
        }}
      ></div>
      {icon ? <Icon name={icon} size={16} style={{ position: "relative" }} /> : null}
      <span style={{ position: "relative" }}>{label}</span>
      <span
        style={{
          position: "relative",
          marginLeft: "auto",
          paddingLeft: "var(--sp-3)",
          fontSize: "var(--fs-caption)",
          fontVariantNumeric: "tabular-nums",
          color: active ? "var(--accent-text)" : "var(--text-3)",
        }}
      >
        {format ? format(value) : value}
      </span>
    </div>
  );
}

export function Menu({ open, x = 0, y = 0, items = [], onClose }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  // Хук берёт НАШ ref: тот же узел меряется на переворот и обходится стрелками.
  const { mounted, layerProps } = useLayerState(open, { ref: panelRef });
  const closing = mounted && !open;
  // origin — УГОЛ ПАНЕЛИ, СОВПАВШИЙ С КУРСОРОМ (см. «РАСТЁТ ИЗ КУРСОРА» ниже).
  const [pos, setPos] = useState({ left: x, top: y, maxH: undefined, origin: "left top" });

  // x/y приходят в ЭКРАННЫХ пикселях (clientX ПКМ), а панель внутри
  // зумленного корня (prefs.uiScale) позиционируется в зум-единицах — делим
  // на cssZoom, иначе меню уезжает вправо-вниз (жалоба 2026-07-17). Заодно
  // клампим в вьюпорт с полем 8px — раньше это делал (не всегда) вызыватель,
  // на глаз и без учёта зума. useLayoutEffect — до отрисовки, без миганий.
  useLayoutEffect(() => {
    if (!mounted) return;
    const el = panelRef.current;
    if (!el) return;
    const z = cssZoom(el);
    const w = el.offsetWidth * z; // offset* — зум-единицы; на экране их x z
    const h = el.offsetHeight * z;
    const M = 8; // поле от кромки окна
    // ПЕРЕВОРОТ, А НЕ ПРИЖИМ (жалоба владельца 04.08: «список открывается не
    // там, где кликнул, а будто приклеен к дну экрана; он не идёт ни выше, ни
    // ниже»).
    //
    // Было: sy = max(8, min(y, innerHeight - h - 8)). У min верхняя граница НЕ
    // зависит от y, поэтому все клики ниже порога давали РОВНО одну точку.
    // Цифры на момент разбора (ряд был 58px: minHeight 42 + по 8 полей,
    // border-box в дереве не объявлен): меню плейлиста — 10 пунктов и 2
    // разделителя = 636px. В окне 900px граница = 900 − 636 − 8 = 256px: любой
    // правый клик ниже четверти окна открывал панель в одном и том же месте.
    // ⚠️ 13.08 ряд ужат до 32+10 = 42px, и то же меню стало ~440px — ошибка
    // проявлялась бы реже, но НЕ исчезла: у min() верхняя граница по-прежнему
    // не зависит от y. Переворот ниже держится не на этих цифрах.
    //
    // Теперь как у соседей по пакету (Select.jsx:36, ColorPicker.jsx:413): не
    // влезает вниз — открываем ВВЕРХ от точки, и только если не влезает ни
    // туда, ни туда, прижимаем. Финальный Math.max обязателен на обеих осях:
    // без него клик в двух пикселях от кромки ставит панель вплотную к ней.
    let sy = y;
    let flipY = false;
    if (y + h > window.innerHeight - M) {
      flipY = y - h >= M;
      sy = flipY ? y - h : window.innerHeight - h - M;
    }
    sy = Math.max(M, sy);
    let sx = x;
    let flipX = false;
    if (x + w > window.innerWidth - M) {
      flipX = x - w >= M;
      sx = flipX ? x - w : window.innerWidth - w - M;
    }
    sx = Math.max(M, sx);
    // ПОТОЛОК ВЫСОТЫ. Меню выше окна не помещалось НИКАК: прижим ставил верх в
    // 8px, а хвост списка (включая «Удалить») висел ниже кромки и мышью был
    // недостижим. Клавиатура не спасала — фокус ставится с preventScroll.
    // РАСТЁТ ИЗ КУРСОРА, А НЕ ИЗ СВОЕГО ЦЕНТРА (жалоба владельца 13.08: «меню
    // плавает в маленьком окошке», «оторванный прямоугольник»).
    //
    // Позиция у панели была правильная и раньше: её угол ставился ровно в точку
    // клика. Читалось всё равно как «прямоугольник, упавший на экран» — потому
    // что появлялась она масштабом ОТ СВОЕГО ЦЕНТРА (transform-origin по
    // умолчанию). Глаз связывает всплывающий слой с источником по тому, ОТКУДА
    // он разворачивается, а не по тому, где потом лежит: центр панели от курсора
    // в 100+ px, и связь рвалась на первом же кадре.
    //
    // Здесь origin ставится в ТОТ САМЫЙ угол, который совпал с курсором. Углов
    // четыре, потому что кламп умеет переворачивать панель по обеим осям: ушла
    // вверх — курсор у её НИЗА, ушла влево — у её ПРАВОГО края. Прижатую к
    // кромке панель (flip не влез) считаем неперевёрнутой: её угол уже не в
    // курсоре, и врать про origin смысла нет — там связь держит близость.
    setPos({
      left: sx / z,
      top: sy / z,
      maxH: (window.innerHeight - 2 * M) / z,
      origin: `${flipX ? "right" : "left"} ${flipY ? "bottom" : "top"}`,
    });
    // items в deps (аудит 22.07): пункты могут долиться АСИНХРОННО после
    // открытия («Куда играть» ждёт listOutputDevices) — панель расширяется, и
    // посчитанный по узкой панели кламп оставлял её обрезанной краем экрана.
    // Лишние прогоны безвредны: та же геометрия — тот же pos.
  }, [mounted, x, y, items]);

  useEffect(() => {
    if (!open) return;
    // preventDefault — не ради браузера (у Escape тут нет действия по
    // умолчанию), а как ПОМЕТКА «событие взято». По ней режим правки вида
    // понимает, что Escape уже кому-то понадобился, и не выходит из режима
    // заодно с закрытием меню (см. shell/LookEditLayer.tsx).
    const onKey = (e) => { if (e.key === "Escape" && onClose) { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Куда вернуть фокус — берём на коммите смены open, ДО того как фокус уйдёт в
  // первый пункт (это делает эффект ниже по файлу): активный элемент тогда ещё
  // снаружи меню. Порядок объявления эффектов важен, см. Dialog.jsx.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    return () => {
      const el = restoreRef.current;
      restoreRef.current = null;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
    };
  }, [open]);

  // Фокус в первый пункт. mounted В DEPS ОБЯЗАТЕЛЕН: провайдер держит один
  // <Menu open={…}> на всё приложение, меню всегда монтируется закрытым, и на
  // коммите открытия panelRef ещё null — с deps [open] фокус не входил в меню
  // никогда, а стрелки/Home/End висят на панели и без фокуса не работают
  // (аудит 02.08).
  useEffect(() => {
    if (!open || !mounted) return;
    const first = panelRef.current?.querySelector('[role="menuitem"]:not([disabled])');
    if (first) first.focus(NO_SCROLL);
  }, [open, mounted]);

  const moveFocus = (delta, edge) => {
    const nodes = [...(panelRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') ?? [])];
    if (nodes.length === 0) return;
    if (edge === "first") { nodes[0].focus(NO_SCROLL); return; }
    if (edge === "last") { nodes[nodes.length - 1].focus(NO_SCROLL); return; }
    const i = nodes.indexOf(document.activeElement);
    nodes[(i + delta + nodes.length) % nodes.length].focus(NO_SCROLL);
  };

  const onMenuKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
    else if (e.key === "Home") { e.preventDefault(); moveFocus(0, "first"); }
    else if (e.key === "End") { e.preventDefault(); moveFocus(0, "last"); }
    else if (e.key === "Tab") { e.preventDefault(); moveFocus(e.shiftKey ? -1 : 1); }
  };

  if (!mounted) return null;

  // ПОРТАЛ (03.08). Слой — position: fixed, а стеклянный предок (backdrop-filter)
  // делается для него содержащим блоком и уводит его от края окна. Цель портала
  // — theme-div приложения, а НЕ document.body: на нём живут все токены темы и
  // zoom масштаба интерфейса. Разбор с замером — packages/ui/src/lib/layerRoot.js.
  const layer = (
    <div
      onClick={closing ? undefined : onClose}
      onContextMenu={(e) => { e.preventDefault(); if (!closing && onClose) onClose(); }}
      inert={closing || undefined}
      style={{ position: "fixed", inset: 0, zIndex: 150 }}
    >
      <div
        {...layerProps}
        role="menu"
        className="muza-layer"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onMenuKeyDown}
        style={{
          position: "absolute",
          left: pos.left,
          top: pos.top,
          // Разворот из курсора: origin — угол, совпавший с точкой ПКМ (разбор
          // в useLayoutEffect выше), поза — ЧИСТЫЙ масштаб без сдвига. Сдвиг
          // здесь был бы вредом: он таскает тот самый угол, которым панель
          // держится за курсор, и связь снова рвётся. 0.94, а не 0.8: из «почти
          // ничего» слой читается как выпрыгнувший, а не как развернувшийся.
          transformOrigin: pos.origin,
          "--layer-pose": "scale(0.94)",
          minWidth: 220,
          /* max-content: у края экрана shrink-to-fit сжимал панель до щели и
             метки переносились в фикс-высоте рядов, наезжая друг на друга
             (аудит 22.07: длинные имена аудио-устройств в «Куда играть»).
             Потолок держит меню читаемым, перенос ловит min-height ряда. */
          width: "max-content",
          maxWidth: "min(92vw, 360px)",
          /* Потолок высоты + прокрутка: список длиннее окна иначе уходил
             хвостом за кромку и был недостижим ни мышью, ни стрелками
             (фокус ставится с preventScroll). Считается тем же эффектом, что
             и позиция, — в зум-единицах. */
          maxHeight: pos.maxH,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "var(--sp-2)",
          borderRadius: "var(--r-md)",
          /* зональная прозрачность: своё стекло меню, фолбэк — общее */
          background: "var(--glass-menu, var(--glass-panel))",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {items.map((it, i) =>
          it !== "-" && it.slider !== undefined ? (
            <MenuSlider key={i} {...it.slider} hovered={hoverIdx === i} onHover={(on) => setHoverIdx(on ? i : null)} />
          ) : it === "-" ? (
            <div key={i} aria-hidden="true" style={{ height: 1, flex: "none", background: "var(--hairline)", margin: "5px var(--sp-3)" }}></div>
          ) : it.header !== undefined ? (
            <div
              key={i}
              role="presentation"
              style={{
                padding: "var(--sp-2) var(--sp-3) 5px",
                fontSize: "var(--fs-caption)",
                fontWeight: "var(--fw-semibold)",
                color: "var(--text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                userSelect: "none",
              }}
            >
              {it.header}
            </div>
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled || undefined}
              onClick={() => { if (it.onClick) it.onClick(); if (onClose) onClose(); }}
              onMouseEnter={() => { if (!it.disabled) setHoverIdx(i); }}
              onMouseLeave={() => setHoverIdx(null)}
              onFocus={() => setHoverIdx(i)}
              onBlur={() => setHoverIdx(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                /* min-height, не height: многострочная метка растит ряд, а не
                   вылезает на соседей (аудит 22.07).
                   ⚠️ 32, А НЕ 42 (13.08). Ряд в 42 px — рост строки СПИСКА, а не
                   пункта меню, и на нём меню плейлиста из 12 пунктов вырастало в
                   плиту 500 px: половина экрана, накрытая стеклом. Именно эту
                   плиту владелец и назвал «не нравится вид ПКМ». Пункт меню
                   читают одним взглядом сверху вниз, ему нужен ритм строки, а не
                   площадь кнопки: те же 12 пунктов теперь укладываются в ~400.
                   Ниже 32 не опускать — 28 уже мажут мышью по соседям. */
                minHeight: 32,
                lineHeight: 1.3,
                padding: "5px var(--sp-3)",
                border: "none",
                borderRadius: "var(--r-xs)",
                /* Опасный пункт подсвечивается СВОИМ тоном, а не общим: до
                   13.08 «Удалить» под курсором заливался тем же surface-3, что
                   «В плейлист», и красным оставался только текст. Подсветка —
                   это ответ на «сейчас нажму», и она обязана нести то же
                   предупреждение, что метка. */
                background: hoverIdx === i && !it.disabled
                  ? it.danger
                    ? "color-mix(in srgb, var(--danger) 15%, transparent)"
                    : "var(--surface-3)"
                  : "transparent",
                color: it.disabled ? "var(--text-3)" : it.danger ? "var(--danger)" : hoverIdx === i ? "var(--text-1)" : "var(--text-2)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-body)",
                fontWeight: "var(--fw-medium)",
                cursor: it.disabled ? "default" : "pointer",
                textAlign: "left",
                transition: "background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)",
              }}
            >
              {it.icon ? <Icon name={it.icon} size={16} /> : null}
              {it.label}
              {it.hint !== undefined ? (
                <span style={{ marginLeft: "auto", paddingLeft: "var(--sp-3)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{it.hint}</span>
              ) : null}
            </button>
          )
        )}
      </div>
    </div>
  );
  return portal(layer);
}
