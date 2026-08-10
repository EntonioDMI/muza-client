/** РЕЖИМ РАСКЛАДКИ УСТРОЙСТВА — один источник правды для обеих программ.
 *
 *  Зачем понадобился (переписывание мобильной адаптации, 2026-08-10). Общие
 *  экраны из `packages/app/src/views/*` красятся ИНЛАЙН-стилями: их делят
 *  браузер и Tauri, а инлайн не умеет media queries. Пока адаптация жила
 *  только в `apps/web/app/globals.css`, экраны о размере окна не знали вовсе —
 *  и на телефоне ряд «заголовок + контрол» оставлял заголовку 51 пиксель из
 *  нужных 304 (замер 10.08, `TrackRow` на iPhone 393pt). Ни один CSS-класс
 *  этого не чинит: перекрыть инлайн можно только `!important`, а перестроить
 *  СТРУКТУРУ ряда (стек вместо строки, другой набор элементов) — вообще
 *  нельзя. Значит режим обязан доезжать до самих экранов, как данные.
 *
 *  ⚠️ ПОРОГИ — ПО СОДЕРЖИМОМУ, А НЕ ПО КАТАЛОГУ УСТРОЙСТВ.
 *  - `phone` (<768px): помещается ровно одна колонка. Боковой панели нет,
 *    навигация уезжает вниз и в выдвижной ящик, строки и плитки сжимаются.
 *  - `tablet` (768–1199px): две колонки. Полноразмерный сайдбар (280px) съел
 *    бы у контента треть, поэтому здесь он иконный рельс, а полный список
 *    открывается тем же ящиком, что на телефоне.
 *  - `desktop` (≥1200px): три колонки, как было.
 *
 *  ⚠️ ТЕЛЕФОН НА БОКУ ОПРЕДЕЛЯЕТСЯ ВЫСОТОЙ, А НЕ ШИРИНОЙ. iPhone Pro Max в
 *  ландшафте — 932×430: по ширине это «десктоп», по вертикали там нет места
 *  ни на полосу плеера, ни на нижнюю навигацию. Планшет в ландшафте (высота
 *  ≥600) под правило не попадает.
 *
 *  ⚠️ БЕЗ ПРОВАЙДЕРА РЕЖИМ ВСЕГДА `desktop`. Это не «безопасный дефолт», а
 *  условие невмешательства: приложение Tauri провайдер не ставит, и ни один
 *  общий экран от этой правки не меняется. Живой режим включает ровно веб
 *  (`apps/web/src/providers.tsx`).
 *
 *  ⚠️ СЕРВЕРНЫЙ СНИМОК — ТОЖЕ `desktop`. Next отдаёт статический HTML, окна на
 *  сервере нет; `useSyncExternalStore` берёт серверное значение для первой
 *  разметки и честно перерисовывает после гидратации, поэтому предупреждения о
 *  расхождении не возникает (в отличие от чтения `window` прямо в рендере). */

import { useSyncExternalStore } from "react";

export type LayoutMode = "phone" | "tablet" | "desktop";

/** Телефон: одна колонка. Ниже этого числа две колонки нечитаемы. */
export const BP_TABLET = 768;
/** Десктоп: три колонки (сайдбар + контент + «Сейчас играет»). */
export const BP_DESKTOP = 1200;
/** Телефон на боку: ниже этой высоты нижней навигации и полосе плеера не жить. */
export const BP_SHORT = 480;

export interface Layout {
  mode: LayoutMode;
  /** Одна колонка: телефон в любой ориентации. */
  phone: boolean;
  /** Две колонки с иконным рельсом. */
  tablet: boolean;
  desktop: boolean;
  /** Телефон/планшет — всё, что не десктоп: общий признак «тесно и пальцем». */
  compact: boolean;
  /** Низкое окно (телефон на боку): вертикаль дороже горизонтали. */
  short: boolean;
  /** Палец, а не мышь: наведения нет, цели крупнее (media pointer: coarse). */
  coarse: boolean;
}

const DESKTOP: Layout = Object.freeze({
  mode: "desktop",
  phone: false,
  tablet: false,
  desktop: true,
  compact: false,
  short: false,
  coarse: false,
});

function read(): Layout {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const short = h <= BP_SHORT;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  // Низкое окно — телефон, какой бы широкой ни была строка: решает вертикаль.
  const mode: LayoutMode = short || w < BP_TABLET ? "phone" : w < BP_DESKTOP ? "tablet" : "desktop";
  return {
    mode,
    phone: mode === "phone",
    tablet: mode === "tablet",
    desktop: mode === "desktop",
    compact: mode !== "desktop",
    short,
    coarse,
  };
}

/** Кэш последнего снимка: `useSyncExternalStore` сравнивает результат
 *  `getSnapshot()` по ССЫЛКЕ и уходит в бесконечный цикл, если каждый вызов
 *  возвращает новый объект. Пересобираем только когда что-то реально изменилось. */
let cached: Layout | null = null;

function snapshot(): Layout {
  const next = read();
  if (cached && cached.mode === next.mode && cached.short === next.short && cached.coarse === next.coarse) {
    return cached;
  }
  cached = next;
  return next;
}

function subscribe(onChange: () => void): () => void {
  const coarse = window.matchMedia("(pointer: coarse)");
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  coarse.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
    coarse.removeEventListener("change", onChange);
  };
}

/** Живой режим раскладки. Веб зовёт его в оболочке и раздаёт через
 *  `LayoutProvider`; отдельные экраны читают уже готовый контекст (`useLayout`
 *  в `shell/LayoutContext.tsx`), чтобы не заводить по слушателю на компонент. */
export function useLiveLayout(): Layout {
  return useSyncExternalStore(subscribe, snapshot, () => DESKTOP);
}

export { DESKTOP as DESKTOP_LAYOUT };
