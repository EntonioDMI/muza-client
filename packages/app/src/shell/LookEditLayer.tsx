/** РЕЖИМ ПРАВКИ ВИДА — прямое манипулирование вместо ползунков (Ctrl+E).
 *
 *  ЗАЧЕМ. Дословная претензия владельца к настройкам: «везде одинаковые
 *  переключатели, тумблеры и выпадающие списки, нет попыток придумать новую
 *  механику». Девяносто подписанных ползунков внешности живут в одном файле на
 *  1143 строки, в двух кликах вглубь и одной длинной прокрутке — а результат
 *  правки виден ЗА СПИНОЙ, на другом экране. Человек крутит «Ширина сайдбара»,
 *  глядя на слово «Ширина сайдбара».
 *
 *  ЧТО ВМЕСТО. Приложение остаётся живым и играющим, но границы зон становятся
 *  хватаемыми: тянешь верхний край плеера — меняется его высота, тянешь край
 *  сайдбара — ширина. Правишь то, на что смотришь; искать нечего.
 *
 *  ПОЧЕМУ ГРАНИЦЫ ИЗМЕРЯЮТСЯ, А НЕ СЧИТАЮТСЯ ИЗ ТОКЕНОВ. Ручка обязана лежать
 *  ровно там, где человек видит край. Пересчёт из --w-sidebar + --gap-zone
 *  повторил бы формулу раскладки третий раз (после App.tsx и веб-CSS) и разошёлся
 *  бы с ней на первом же изменении — ровно та ловушка, которую редизайн закрыл
 *  у полосы плеера. Спрашиваем сам DOM.
 *
 *  ⚠️ ГОЧА, О КОТОРУЮ РАЗБИВАЕТСЯ НАИВНАЯ РЕАЛИЗАЦИЯ. Масштаб интерфейса —
 *  настоящий CSS `zoom` на корне темы (themeVars.ts). Значит getBoundingClientRect
 *  отдаёт ЭКРАННЫЕ пиксели, а prefs хранит CSS-пиксели, и на 85 % / 125 % ручка
 *  промахивается мимо края, а перетаскивание едет быстрее или медленнее курсора.
 *  Поэтому и позиции, и дельты проходят через cssZoom() — тот же помощник, что
 *  чинит координаты всплывашек.
 *
 *  ЧТО ЕЩЁ УМЕЕТ РЕЖИМ. Кроме краёв зон в нём хватаются САМИ ЭЛЕМЕНТЫ —
 *  вкладки сайдбара, карточки разделов настроек, полки Главной, блоки
 *  статистики (shell/lookReorder.tsx). Этот слой их не рисует и о них не
 *  знает: перестановка живёт там, где живёт сам элемент. Общего у них ровно
 *  два: признак «режим включён» и стек отмены — оба в LookEditProvider. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cssZoom } from "@muza/ui";
import { useT } from "../i18n";
import { useLookEdit } from "./lookReorder";
import type { Prefs } from "../prefs/types";

/** Что можно потянуть. `axis` — вдоль какой оси едет край, `sign` — в какую
 *  сторону растёт значение относительно движения курсора. */
interface Grip {
  key: "wSidebar" | "wNowPlaying" | "hPlayerBar" | "hProgress";
  axis: "x" | "y";
  sign: 1 | -1;
  min: number;
  max: number;
  /** Как найти зону в DOM и какой её край держать. */
  selector: string;
  edge: "right" | "left" | "top" | "bottom";
}

/** Диапазоны — те же, что у соответствующих ползунков в «Кастомизации»:
 *  одна настройка не может иметь двух разных потолков. */
const GRIPS: Grip[] = [
  { key: "wSidebar", axis: "x", sign: 1, min: 240, max: 340, selector: "[data-zone='sidebar']", edge: "right" },
  { key: "wNowPlaying", axis: "x", sign: -1, min: 300, max: 420, selector: "[data-zone='nowplaying']", edge: "left" },
  { key: "hPlayerBar", axis: "y", sign: -1, min: 56, max: 120, selector: "[data-zone='player']", edge: "top" },
  // Толщина полосы прогресса (заявка владельца 04.08). Линия лежит по ВЕРХНЕЙ
  // кромке плеера, и её верхний край совпадает с краем самого бара — там уже
  // стоит ручка высоты, два жеста на одной кромке подрались бы. Поэтому
  // тянется НИЖНИЙ край зоны прогресса: вниз — толще (линия растёт внутрь
  // бара), вверх — тоньше.
  { key: "hProgress", axis: "y", sign: 1, min: 2, max: 16, selector: "[data-zone='progress']", edge: "bottom" },
];

/** Толщина хватаемой полосы. Меньше — не попасть мышью, больше — начинает
 *  перехватывать клики по содержимому у самой границы. */
const GRIP_THICKNESS = 8;

interface Box {
  grip: Grip;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function LookEditLayer({
  prefs,
  set,
  onExit,
}: {
  prefs: Prefs;
  set: (patch: Partial<Prefs>) => void;
  onExit: () => void;
}) {
  const { t } = useT();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [active, setActive] = useState<{ key: Grip["key"]; value: number; x: number; y: number } | null>(null);
  /** Снимки ДО каждого перетаскивания — стек отмены. Прямое манипулирование
   *  без отмены это ловушка: рука дрогнула, и вернуть прежнее число можно
   *  только через настройки, то есть ровно тем путём, от которого уходим.
   *
   *  Стек ОБЩИЙ с перестановкой элементов (shell/lookReorder.tsx) и потому
   *  живёт в провайдере: Ctrl+Z обязан откатывать последнее действие, а не
   *  последнее действие ЭТОГО слоя — иначе после перестановки вкладок он молча
   *  отматывал бы ширину сайдбара, которую человек трогал двумя жестами
   *  раньше. */
  const { pushUndo, popUndo } = useLookEdit();
  const drag = useRef<{ grip: Grip; start: number; from: number } | null>(null);
  /** Корень слоя — источник зума. ⚠️ НЕ documentElement: масштаб интерфейса
   *  (zoom) висит на theme-div НИЖЕ корня документа, у documentElement свой
   *  currentCSSZoom всегда 1 — и на 85/125 % все ручки промахивались мимо
   *  краёв, а тяга врала на коэффициент зума (ревизия 04.08). Слой рендерится
   *  ВНУТРИ зумленного поддерева — зум и надо спрашивать у себя. */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const zoomOf = useCallback(() => cssZoom(rootRef.current) || 1, []);

  /** Измеряем края зон. Пересчитываем на каждый кадр перетаскивания и на
   *  ресайз: зоны едут, ручки обязаны ехать вместе с ними. */
  const measure = useCallback(() => {
    const zoom = zoomOf();
    const next: Box[] = [];
    for (const grip of GRIPS) {
      const el = document.querySelector(grip.selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // Экранные пиксели → CSS-пиксели зумленного поддерева: слой рендерится
      // ВНУТРИ theme-div, и его left/top движок умножает на zoom.
      const x = r.x / zoom;
      const y = r.y / zoom;
      const w = r.width / zoom;
      const h = r.height / zoom;
      if (grip.axis === "x") {
        const edgeX = grip.edge === "right" ? x + w : x;
        next.push({ grip, x: edgeX - GRIP_THICKNESS / 2, y, w: GRIP_THICKNESS, h });
      } else {
        const edgeY = grip.edge === "bottom" ? y + h : y;
        next.push({ grip, x, y: edgeY - GRIP_THICKNESS / 2, w, h: GRIP_THICKNESS });
      }
    }
    setBoxes(next);
  }, [zoomOf]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    // Сами зоны — тоже: Ctrl+Z и правки из «Кастомизации» двигают края БЕЗ
    // ресайза окна, и ручки оставались на старых местах (ревизия 04.08).
    for (const grip of GRIPS) {
      const el = document.querySelector(grip.selector);
      if (el) ro.observe(el);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // ВЫХОД И ОТМЕНА — РЕЖИМ ПРАВКИ СТОИТ ПОСЛЕДНИМ В ОЧЕРЕДИ ЗА ЭТИ ДВЕ КЛАВИШИ.
  //
  // ⚠️ Здесь стоял захват на всё окно (`addEventListener(..., true)`) с
  // preventDefault + stopPropagation. Он делал ровно то, чего делать нельзя:
  // пока режим включён, Escape не закрывал ни меню, ни живой жест
  // перестановки (оба слушают ФАЗУ ВСПЛЫТИЯ — до них событие уже не доходило),
  // а у диалога, который ловит Escape тоже на захвате, срабатывали ОБА
  // обработчика: диалог закрывался И режим правки выходил заодно. Ctrl+Z в
  // текстовом поле уходил в отмену перестановки вместо отмены ввода.
  //
  // Правило простое: Escape принадлежит самому верхнему, кто его ждёт —
  // диалогу, меню, выпадающему списку, живому жесту. Режиму правки он достаётся
  // только тогда, когда не понадобился никому. Проверить это в момент вызова
  // нельзя (порядок обработчиков на одном window — это порядок подписки, а
  // подписались мы раньше всех, кто открылся после), поэтому решение
  // откладывается за конец рассылки: setTimeout(0) гарантированно приходит
  // после ВСЕХ обработчиков этого события, а `defaultPrevented` к тому моменту
  // уже содержит итог. Кто событие взял — тот его пометил (Dialog.jsx, Menu.jsx,
  // useLocalReorder). Задержку в один тик глаз не видит.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.setTimeout(() => {
          if (!e.defaultPrevented) onExit();
        }, 0);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        // В поле ввода Ctrl+Z — это отмена ВВОДА, и отбирать её нельзя:
        // человек переименовывает плейлист, а у него молча откатывается
        // ширина сайдбара. Тот же сторож, что у глобальных хоткеев App.tsx.
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
        const last = popUndo();
        if (!last) return; // отменять нечего — не мешаем чужой отмене
        e.preventDefault();
        set(last);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, popUndo, set]);

  const onPointerDown = (grip: Grip) => (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const zoom = zoomOf();
    drag.current = {
      grip,
      start: (grip.axis === "x" ? e.clientX : e.clientY) / zoom,
      from: prefs[grip.key] as number,
    };
    pushUndo({ [grip.key]: prefs[grip.key] } as Partial<Prefs>);
    setActive({ key: grip.key, value: prefs[grip.key] as number, x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const zoom = zoomOf();
    const now = (d.grip.axis === "x" ? e.clientX : e.clientY) / zoom;
    const raw = d.from + (now - d.start) * d.grip.sign;
    const value = Math.round(Math.max(d.grip.min, Math.min(d.grip.max, raw)));
    set({ [d.grip.key]: value } as Partial<Prefs>);
    setActive({ key: d.grip.key, value, x: e.clientX, y: e.clientY });
    measure();
  };

  const endDrag = () => {
    drag.current = null;
    setActive(null);
  };

  return (
    <div
      ref={rootRef}
      // Слой поверх всего, но НЕ ловящий события сам: клики проходят к живому
      // приложению, и музыка в режиме правки продолжает слушаться. Ловят
      // только сами ручки.
      style={{ position: "fixed", inset: 0, zIndex: 130, pointerEvents: "none" }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--sp-3)",
          height: 26,
          background: "var(--accent)",
          color: "var(--text-on-accent)",
          fontSize: "var(--fs-caption)",
          fontWeight: 600,
          pointerEvents: "none",
        }}
      >
        {t("lookEdit.ribbon")}
      </div>

      {boxes.map(({ grip, x, y, w, h }) => (
        <div
          key={grip.key}
          onPointerDown={onPointerDown(grip)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          title={t(`lookEdit.grip.${grip.key}` as never)}
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: w,
            height: h,
            pointerEvents: "auto",
            cursor: grip.axis === "x" ? "col-resize" : "row-resize",
            // Сама полоса невидима — видна только линия по её середине, и
            // только пока на неё смотрят. Иначе режим правки превратил бы
            // окно в чертёж.
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => ((e.currentTarget.firstElementChild as HTMLElement).style.opacity = "1")}
          onMouseLeave={(e) => {
            if (!drag.current) (e.currentTarget.firstElementChild as HTMLElement).style.opacity = "0";
          }}
        >
          <span
            style={{
              display: "block",
              width: grip.axis === "x" ? 2 : "100%",
              height: grip.axis === "x" ? "100%" : 2,
              background: "var(--accent)",
              opacity: active?.key === grip.key ? 1 : 0,
              transition: "opacity var(--dur-state) var(--ease-standard)",
            }}
          />
        </div>
      ))}

      {active ? (
        // Число едет у курсора, а не в панели сбоку: глаз и так уже там.
        <span
          style={{
            position: "fixed",
            // clientX/Y — экранные; fixed внутри зумленного поддерева
            // умножается на zoom — делим, иначе бейдж уезжает от курсора.
            left: (active.x + 14) / zoomOf(),
            top: (active.y - 10) / zoomOf(),
            padding: "3px 8px",
            borderRadius: "var(--r-xs)",
            background: "var(--glass-dialog)",
            backdropFilter: "blur(var(--blur-glass))",
            WebkitBackdropFilter: "blur(var(--blur-glass))",
            color: "var(--text-1)",
            fontSize: "var(--fs-caption)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {active.value} px
        </span>
      ) : null}
    </div>
  );
}
