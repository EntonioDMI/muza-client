/** Внутриприложенческий drag-and-drop на POINTER EVENTS (не HTML5 DnD).
 *
 *  Почему не HTML5, на котором всё было раньше (lib/dnd.ts):
 *  HTML5 DnD даёт под курсором СТАТИЧНЫЙ снимок (`setDragImage`) и не даёт ни
 *  живого превью, ни раздвигающихся соседей, ни long-press. Владелец просил
 *  ровно это: «подержал ~0.3с — и она потянулась за мышкой». Это потолок
 *  технологии, а не недоделка, поэтому внутренний перенос переписан на pointer.
 *
 *  HTML5-путь при этом ОСТАЁТСЯ и не может быть выкинут: перетаскивание файла
 *  на рабочий стол (lib/dragOut.ts → Tauri) работает только через него. Граница
 *  такая: Alt+drag — наружу (HTML5), обычный зажим — внутри (этот модуль).
 *  Поэтому здесь ловится только primary-кнопка без Alt (см. shouldStart).
 *
 *  Модуль — чистые данные и вычисления, без React: тестируется изолированно,
 *  а состояние и подписки живут в useDrag.tsx.
 *
 *  Общий для приложения и веба (Э3 веб-паритета, 2026-08-02). Переехал сюда
 *  первым и без единой правки: ни одного импорта, ни одного касания Tauri, а
 *  Pointer Events — это ещё и палец на телефоне (у ручек стоит
 *  touchAction:"none"). Единственное касание платформы — document.elementFromPoint
 *  в dropTargetAt, и туда `doc` подставляется параметром.
 */

/** Что тащим. `kind` разделяет источники: трек каталога и трек ВНУТРИ плейлиста
 *  ведут себя по-разному (второй умеет реордер на месте). */
export interface DragPayload {
  id: string;
  title: string;
  artist?: string;
  /** null — трек без обложки: именно так её отдаёт контракт (Track.coverUrl),
   *  и превью рисует плейсхолдер. Не `string | undefined`, чтобы пять вью не
   *  писали `?? undefined` в каждом вызове. */
  cover?: string | null;
  /** "track" — откуда угодно; "playlist-track" — строка внутри плейлиста
   *  (может быть переупорядочена), `fromPlaylistId` тогда обязателен.
   *  Плейлисты сюда НЕ попадают: их реордер — локальный (useLocalReorder),
   *  без глобального слоя и переносов между областями (решение 2026-07-16). */
  kind: "track" | "playlist-track";
  fromPlaylistId?: string;
}

/** Порог удержания до «подъёма» карточки, когда мышь стоит на месте: «взял, не
 *  двигая». Живой перенос сюда не попадает — он стартует по DRAG_THRESHOLD, как
 *  только курсор поехал. 280мс заметно меньше ~500мс системного long-press и
 *  заметно больше случайного клика. */
export const HOLD_MS = 280;

/** Сдвиг в пикселях, после которого нажатие считается переносом, а не кликом.
 *  6px — типичный slop указателя (Windows держит 4px в SM_CXDRAG): меньше —
 *  дрожь руки поднимала бы карточку вместо воспроизведения, больше — «тяну, а
 *  оно не едет».
 *
 *  ⚠️ Здесь было ДВА порога: MOVE_SLOP=6 жест ОТМЕНЯЛ, DRAG_THRESHOLD=24 —
 *  поднимал. Полоса между ними оказалась дырой, и именно в неё попадает любой,
 *  кто тянет сразу: pointermove летит каждые ~8-16мс и меряет дистанцию от точки
 *  нажатия, так что живое движение сначала проходит 7..23px — cancelPending()
 *  обнулял pending, и до 24px жест уже не доживал. Порог 24 был недостижим ничем,
 *  кроме швырка на 24px за один кадр; на деле работало ТОЛЬКО удержание HOLD_MS.
 *  Тесты этого не видели — слали одно pointermove сразу на цель, — а инвариант
 *  «DRAG_THRESHOLD > MOVE_SLOP» существование дыры прямо закреплял.
 *  Нашёл владелец: «280 много, я почти сразу тянул когда нажимал» (16.07.2026). */
export const DRAG_THRESHOLD = 6;

/** Стартовать ли перенос по этому pointerdown. Мышь — только левая кнопка;
 *  Alt зарезервирован под drag-out файла (lib/dragOut.ts), Ctrl/Shift — под
 *  множественное выделение (2026-07-20: Shift раньше был только в комментарии
 *  — и Shift+клик запускал перенос, дерясь с диапазоном); правая — меню. */
export function shouldStart(e: {
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return e.button === 0 && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Гистерезис порогов перестановки: границу надо ПРОЙТИ на этот запас, а не
 *  коснуться её. Без запаса точка «поменялись» и точка «поменялись обратно»
 *  совпадают, и дрожь руки у границы заставляла соседей скакать туда-обратно
 *  на каждый микросдвиг курсора (жалоба владельца 04.08: «содержимое очень
 *  сильно дёргается… всё начинает очень быстро перемещаться»). */
export const REORDER_HYSTERESIS = 8;

/** Индекс вставки в СТОЛБЦЕ (живой порядок) по ТОЧКЕ ЗАХВАТА.
 *
 *  `y` — курсор, то есть ровно то место плашки, за которое её держат.
 *  Требование владельца 04.08 дословно: «я захватил текст — и только когда
 *  этот текст пересекает границу между другими элементами, объект должен туда
 *  переходить… чтобы это зависело от курсора, а не от центра плашки».
 *  Версия «по краям плашки» (жила полдня) решала за руку: взял большую секцию
 *  за середину — «примерно на середине она начинает подниматься вверх», хотя
 *  точка захвата ничего не пересекла.
 *
 *  Идём от `from` в обе стороны: точка захвата прошла середину СОСЕДА с
 *  запасом гистерезиса — встаём за него. Стабильно при любых размерах: после
 *  обмена сосед оказывается с другой стороны точки захвата, и условие гаснет
 *  само. Большая секция уводится в конец без «проноса центра за весь список» —
 *  решает рука, а не геометрия плашки.
 *
 *  Возвращает splice-индекс для moveItem. Многошаговый проход по живым
 *  прямоугольникам валиден: середины соседей дальше первого не двигаются,
 *  пока тащимый до них не доехал. */
/** Индекс вставки по ПОЛОЖЕНИЮ КУРСОРА — для механики DragLayer, где строку
 *  НЕ тащат: под курсором плавает карточка-превью, а целятся самим курсором
 *  (реордер треков в PlaylistView). Считает по серединам строк СТАТИЧНОГО
 *  снимка: снимок не меняется весь жест, осциллировать нечему — поэтому ни
 *  краёв, ни гистерезиса здесь не нужно, и точка прицеливания — курсор, а не
 *  центр строки. Не подменять на insertionIndex: у того другая точка отсчёта. */
export function cursorInsertionIndex(rects: readonly { top: number; bottom: number }[], from: number, pointerY: number): number {
  if (rects.length === 0) return 0;
  let to = 0;
  for (let i = 0; i < rects.length; i++) {
    const mid = (rects[i].top + rects[i].bottom) / 2;
    if (pointerY > mid) to = i + 1;
  }
  // индекс считался по списку С тащимым элементом; после его изъятия всё, что
  // правее, съезжает на единицу
  if (to > from) to -= 1;
  return Math.max(0, Math.min(rects.length - 1, to));
}

export function insertionIndex(rects: readonly { top: number; bottom: number }[], from: number, y: number): number {
  if (rects.length === 0) return 0;
  if (from < 0 || from >= rects.length) return Math.max(0, Math.min(rects.length - 1, from));
  let to = from;
  for (let i = from - 1; i >= 0; i--) {
    if (y < (rects[i].top + rects[i].bottom) / 2 - REORDER_HYSTERESIS) to = i;
    else break;
  }
  if (to !== from) return to;
  for (let i = from + 1; i < rects.length; i++) {
    if (y > (rects[i].top + rects[i].bottom) / 2 + REORDER_HYSTERESIS) to = i;
    else break;
  }
  return to;
}

/** На сколько пикселей сдвинуть строку `i`, пока строку `from` тащат в позицию
 *  `to`. Это ВИЗУАЛЬНАЯ половина реордера: список в DOM не переставляется до
 *  отпускания, соседи просто разъезжаются transform'ом.
 *
 *  `rects` — прямоугольники строк, снятые ОДИН раз на pointerdown. Живьём их
 *  пересчитывать нельзя: transform входит в getBoundingClientRect, и расчёт по
 *  сдвинутым соседям раскачивал бы сам себя (сдвинули — индекс вставки
 *  изменился — сдвинули обратно).
 *
 *  В расчёт входит только высота ТАЩИМОЙ строки: её изъятие и вставка —
 *  единственное, что меняет стопку, поэтому соседи едут ровно на неё, какими бы
 *  разными по высоте ни были сами. `to === from` (или нет переноса) — все нули.
 */
export function reorderShift(
  rects: readonly { top: number; bottom: number }[],
  from: number,
  to: number,
  i: number,
): number {
  if (from < 0 || to < 0 || to === from) return 0;
  if (from >= rects.length || to >= rects.length || i >= rects.length) return 0;
  const h = rects[from].bottom - rects[from].top;
  // сама тащимая строка: едет в слот, который освободили соседи
  if (i === from) {
    return to > from ? rects[to].bottom - h - rects[from].top : rects[to].top - rects[from].top;
  }
  // тащат вниз мимо i → i поднимается на её высоту
  if (from < i && i <= to) return -h;
  // тащат вверх мимо i → i опускается
  if (to <= i && i < from) return h;
  return 0;
}

/** Прямоугольник элемента для локального реордера (см. useLocalReorder). */
export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** Splice-индекс вставки в СЕТКЕ/ленте: ячейка, В КОТОРУЮ ВОШЛА ТОЧКА
 *  ЗАХВАТА (курсор — то место плашки, за которое её держат; требование
 *  владельца 04.08, см. insertionIndex).
 *
 *  ⚠️ Здесь был «ближайший центр» — и это была причина дёрганья сеток.
 *  Ближайший центр есть ВСЕГДА, даже когда плашку никуда не вели, а на
 *  разных размерах ячеек он осциллировал: перестановка меняла геометрию так,
 *  что ближайшим снова становился прежний слот, и сетка скакала туда-обратно
 *  (жалоба владельца 04.08 — статистика и медиатека). «Вошёл в чужую ячейку»
 *  стабилен по построению: после обмена точка захвата оказывается в СВОЕЙ
 *  ячейке, и повторного срабатывания нет. Ячейка сжата на гистерезис — дрожь
 *  руки на самой границе входом не считается. Никуда не вошёл (зазор между
 *  ячейками, своя ячейка) — остаёмся на месте: «ничего не делать» для жеста
 *  безопаснее, чем угадывать.
 *
 *  Арифметика splice сходится без поправок — как и раньше: ячейка i левее
 *  тащимого — splice(i); правее — после изъятия всё съехало на единицу, и
 *  «место ячейки i» — тоже splice(i). */
export function gridInsertionIndex(rects: readonly Box[], from: number, x: number, y: number): number {
  const m = REORDER_HYSTERESIS;
  for (let i = 0; i < rects.length; i++) {
    if (i === from) continue;
    const r = rects[i];
    if (x >= r.left + m && x <= r.right - m && y >= r.top + m && y <= r.bottom - m) return i;
  }
  return Math.max(0, from);
}

/** ⚠️ Здесь была reorderOffset — «сосед едет на прямоугольник своей будущей
 *  позиции». Формула верна ровно тогда, когда все элементы одинакового размера
 *  и стоят одной стопкой. При разных ширинах (карточка настроек на две колонки)
 *  и при переносе строк (лента статистики) она врала всегда: под широкую
 *  карточку выделялся одинарный слот. Удалена 2026-08-04 вместе с механикой
 *  статичного снимка — useLocalReorder переставляет элементы живьём и отдаёт
 *  раскладку браузеру, а разницу мест доигрывает FLIP'ом. */

/** Разложить элементы по внешнему порядку ключей. Обратная сторона `order` из
 *  useLocalReorder: хук отдаёт ключи, а рисовать надо объекты. Ключ, которому
 *  нет пары, пропускается — список мог смениться под жестом. */
export function pickByOrder<T>(items: readonly T[], keyOf: (item: T) => string, order: readonly string[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(keyOf(item), item);
  const out: T[] = [];
  for (const key of order) {
    const item = byKey.get(key);
    if (item !== undefined) {
      out.push(item);
      byKey.delete(key);
    }
  }
  // Чего в порядке не назвали — дописываем в исходном виде: потерять элемент
  // молча хуже, чем показать его не на своём месте.
  for (const item of items) if (byKey.has(keyOf(item))) out.push(item);
  return out;
}

/** Сопротивление за краем области (rubber-banding). Жёсткий стоп на границе
 *  читается как «залипло»: рука ещё едет, плашка уже мертва. Реальные вещи
 *  сопротивляются тем сильнее, чем дальше их тянут, и никогда не замирают
 *  мгновенно — поэтому за границей плашка продолжает идти, но с затухающим
 *  откликом, и сама говорит «дальше некуда» вместо того, чтобы притвориться
 *  сломанной. Кривая — из сэмплов Apple (Designing Fluid Interfaces).
 *
 *  `dimension` здесь — БЮДЖЕТ выхода, а не габарит плашки: кривая асимптотически
 *  упирается ровно в это значение, куда бы ни уехал курсор. Габарит плашки в
 *  роли бюджета давал ~68px за краем на плитке 100px — это уже не «упругий
 *  край», а «уехала из своей области», чего владелец просил не делать. */
const RUBBER_BUDGET = 24;

function rubberband(overshoot: number, dimension = RUBBER_BUDGET, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Значение с упругими границами: внутри [min,max] — один в один за курсором,
 *  снаружи — затухающий хвост. */
function resist(value: number, min: number, max: number): number {
  if (value < min) return min + rubberband(value - min);
  if (value > max) return max + rubberband(value - max);
  return value;
}

/** Сдвиг (dx,dy) прямоугольника r в границах bounds: «следует за мышкой
 *  настолько, насколько может в рамках своей области» — но край УПРУГИЙ,
 *  а не глухой (см. rubberband выше). */
export function clampShift(
  r: Box,
  bounds: Box,
  dx: number,
  dy: number,
): { x: number; y: number } {
  return {
    x: resist(dx, bounds.left - r.left, bounds.right - r.right),
    y: resist(dy, bounds.top - r.top, bounds.bottom - r.bottom),
  };
}

/** Габарит области реордера: объединение прямоугольников всех элементов. */
export function unionBox(rects: readonly Box[]): Box {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.top < top) top = r.top;
    if (r.left < left) left = r.left;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return { top, left, right, bottom };
}

/** Перестановка элемента: from → to. Чистая, не мутирует. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}

/** ПОРЯДОК ВИДИМЫХ КЛЮЧЕЙ → ПОЛНЫЙ СПИСОК НАСТРОЙКИ.
 *
 *  Зачем отдельная функция: списки вкладок сайдбара и блоков статистики хранят
 *  и выключенные элементы, а переставляют на экране только включённые. Наивное
 *  «записать новый порядок как есть» тихо теряло бы выключенные — то есть
 *  выключенная вкладка после первой же перестановки уезжала бы в конец списка,
 *  и человек находил бы её не там, где оставил.
 *
 *  Правило: слоты, занятые ВИДИМЫМИ элементами, заполняются заново в новом
 *  порядке; невидимые остаются ровно на своих местах. Ключ из `visible`,
 *  которого нет в `all`, игнорируется — список мог смениться под жестом. */
export function applyVisibleOrder<T>(
  all: readonly T[],
  keyOf: (item: T) => string,
  visible: readonly string[],
): T[] {
  const byKey = new Map<string, T>();
  for (const item of all) byKey.set(keyOf(item), item);
  const shown = new Set(visible.filter((k) => byKey.has(k)));
  const queue = visible.filter((k) => shown.has(k));
  let next = 0;
  return all.map((item) => (shown.has(keyOf(item)) ? byKey.get(queue[next++]) ?? item : item));
}

/** Ближайшая drop-зона под курсором: ищем по data-атрибуту вверх от элемента.
 *  elementFromPoint, а не onPointerEnter на целях: тащимое превью висит под
 *  курсором и перехватывало бы события (у него pointer-events:none, но
 *  hit-test всё равно надёжнее и не зависит от порядка подписок). */
export const DROP_ATTR = "data-muza-drop";

export function dropTargetAt(x: number, y: number, doc: Document = document): { id: string; el: HTMLElement } | null {
  const hit = doc.elementFromPoint(x, y);
  if (!hit) return null;
  const el = (hit as HTMLElement).closest<HTMLElement>(`[${DROP_ATTR}]`);
  if (!el) return null;
  const id = el.getAttribute(DROP_ATTR);
  return id ? { id, el } : null;
}
