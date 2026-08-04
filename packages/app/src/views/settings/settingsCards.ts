/** Раскладка карточек разделов настроек: порядок + ширина в колонках сетки
 *  (prefs.settingsCards). До 04.08 порядка не было нигде — карточки шли ровно
 *  так, как перечислены в SETTINGS_TAB_KEYS.
 *
 *  Заявка владельца дословно: «расположение элементов в Settings — аккаунт мы
 *  могли бы перенести в центр, Lyrics в первый ряд, как угодно, через
 *  drag-and-drop… плашки можно менять местами и варьировать их размеры, и
 *  чтобы при этом они адаптировались и выглядели хорошо».
 *
 *  ПОЧЕМУ РАЗМЕР ХРАНИТСЯ В КОЛОНКАХ, А НЕ В ПИКСЕЛЯХ. Сетка карточек текучая
 *  (repeat(auto-fill, minmax(260px, 1fr)) в SettingsHub.tsx): на узком окне
 *  одна дорожка, на широком три-четыре. Пиксельная ширина в такой сетке
 *  означала бы разное число карточек в ряду при одном и том же числе — и дыры
 *  в раскладке. Колонка — единица, которая у сетки уже есть.
 *
 *  ⚠️ ПОТОЛОК ЗАВИСИТ ОТ ОКНА, А НЕ ОТ НАСТРОЙКИ. Карточка на две колонки в
 *  однодорожечной сетке — это карточка во всю ширину, то есть «размер» из неё
 *  исчезает как понятие. Владелец просил ровно этого: «блокировать увеличение,
 *  если места не хватает». Поэтому span хранится, но применяется через
 *  cardSpan() ниже: не влезло — рисуем одну колонку, НЕ переписывая настройку
 *  (окно расширят — карточка вернёт свою ширину сама).
 *
 *  Нормализация против ПОЛНОГО списка разделов, а не против видимых на этой
 *  площадке: профиль настроек один на приложение и браузер (prefs/types.ts), и
 *  заход из браузера не должен стирать позицию карточки «Расширения», которой
 *  в браузере нет вовсе. */

import { SETTINGS_TAB_KEYS } from "./SettingsNav";

export interface SettingsCardPref {
  key: string;
  /** Ширина в колонках сетки: 1 или 2. */
  span: number;
  /** Высота в РЯДАХ сетки: 1 или 2. Заявка владельца 04.08: «хотелось бы, чтобы
   *  блок настроек мог увеличиваться в высоту — такой мини-блок кубиком».
   *  Ряды, а не пиксели, по той же причине, что и колонки: у сетки уже есть эта
   *  единица, и высота двойного ряда всегда совпадает с двумя соседями, откуда
   *  бы ни взялась высота самого ряда (gridAutoRows: 1fr в SettingsHub).
   *  Потолка от окна тут НЕТ: ряды сетка нарезает сколько угодно, места по
   *  вертикали в прокручиваемом экране всегда хватает. */
  rows: number;
}

export const SETTINGS_CARD_MAX_SPAN = 2;
export const SETTINGS_CARD_MAX_ROWS = 2;

function clampSpan(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 1;
  return Math.max(1, Math.min(SETTINGS_CARD_MAX_SPAN, n));
}

function clampRows(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 1;
  return Math.max(1, Math.min(SETTINGS_CARD_MAX_ROWS, n));
}

/** Сохранённое → полный список: незнакомые ключи выбрасываются, недостающие
 *  (разделы будущих версий) дописываются в конец шириной в одну колонку. */
export function normalizeSettingsCards(saved: unknown): SettingsCardPref[] {
  const known = new Set<string>(SETTINGS_TAB_KEYS);
  const seen = new Set<string>();
  const out: SettingsCardPref[] = [];
  for (const c of Array.isArray(saved) ? saved : []) {
    if (!c || typeof c !== "object") continue;
    const key = (c as SettingsCardPref).key;
    if (typeof key !== "string" || !known.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, span: clampSpan((c as SettingsCardPref).span), rows: clampRows((c as SettingsCardPref).rows) });
  }
  for (const key of SETTINGS_TAB_KEYS) {
    if (!seen.has(key)) out.push({ key, span: 1, rows: 1 });
  }
  return out;
}

/** Сколько колонок реально займёт карточка при данной ширине сетки. */
export function cardSpan(span: number, columns: number): number {
  return Math.max(1, Math.min(clampSpan(span), Math.max(1, columns)));
}
