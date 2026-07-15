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
   *  (может быть переупорядочена), `fromPlaylistId` тогда обязателен. */
  kind: "track" | "playlist-track";
  fromPlaylistId?: string;
}

/** Порог удержания до «подъёма» карточки. 280мс — компромисс: заметно меньше
 *  ~500мс системного long-press (не ощущается тормозом), но заметно больше
 *  случайного клика. Владелец предполагал 0.3с — попали в ту же вилку. */
export const HOLD_MS = 280;

/** Сдвиг в пикселях, после которого зажим считается НЕ переносом, а скроллом/
 *  выделением: пока таймер тикает, пользователь ещё имеет право просто ткнуть
 *  или прокрутить список. 6px — типичный slop указателя. */
export const MOVE_SLOP = 6;

/** Сдвиг, после которого перенос стартует НЕМЕДЛЕННО, не дожидаясь таймера:
 *  осознанное «схватил и потащил» не должно ждать 280мс. Больше MOVE_SLOP,
 *  иначе дрожь руки поднимала бы карточку вместо клика. */
export const DRAG_THRESHOLD = 24;

/** Стартовать ли перенос по этому pointerdown. Мышь — только левая кнопка;
 *  Alt зарезервирован под drag-out файла (lib/dragOut.ts), Ctrl/Shift — под
 *  множественное выделение в будущем; правая — контекст-меню. */
export function shouldStart(e: { button: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.button === 0 && !e.altKey && !e.ctrlKey && !e.metaKey;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Индекс вставки при реордере по позиции курсора.
 *
 *  `rects` — прямоугольники строк списка В ТЕКУЩЕМ порядке (top/bottom в
 *  координатах вьюпорта), `from` — индекс тащимой строки.
 *  Возвращает индекс, КУДА встанет строка (в терминах массива ПОСЛЕ удаления
 *  элемента из `from` — то есть готов для splice).
 *
 *  Считаем по СЕРЕДИНАМ строк, а не по границам: курсор ниже середины строки i
 *  → встаём после неё. Так соседи раздвигаются ровно тогда, когда глаз этого
 *  ждёт, и нет мёртвых зон на стыках. */
export function insertionIndex(rects: readonly { top: number; bottom: number }[], from: number, pointerY: number): number {
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

/** Перестановка элемента: from → to. Чистая, не мутирует. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
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
