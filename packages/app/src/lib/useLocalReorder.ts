/** Локальный реордер списка/сетки: тащится САМА плашка, а не превью-карточка.
 *
 *  Чем отличается от глобального DragLayer и почему не он:
 *  DragLayer — про перенос МЕЖДУ областями (трек → плейлист): под курсором
 *  плавает отдельная карточка-превью, а исходная строка стоит на месте.
 *  Владелец для реордера плейлистов попросил обратное (2026-07-16): плашка
 *  следует за мышкой «настолько, насколько может в рамках ограниченной ей
 *  области», соседи раздвигаются, показывая будущий порядок, и НИКАКИХ
 *  переносов между областями — сайдбар реордерится в сайдбаре, медиатека в
 *  медиатеке. Жест тот же, что у DragLayer (HOLD_MS/DRAG_THRESHOLD/Escape),
 *  чтобы рука не различала «какой это из drag'ов».
 *
 *  ── ПЕРЕПИСАН 2026-08-04: ЖИВОЙ ПОРЯДОК ВМЕСТО СТАТИЧНЫХ ПРЯМОУГОЛЬНИКОВ ──
 *
 *  Было: на подъёме один раз снимались прямоугольники всех элементов, и дальше
 *  вся арифметика шла по этому снимку — тащимый получал transform по дельте
 *  курсора, соседи ехали на прямоугольник «своей будущей позиции» (rects[i±1]).
 *  Снимок ломался ЧЕТЫРЬМЯ способами разом, и владелец нашёл все четыре:
 *
 *   1. ПРОКРУТКА. Пролистал страницу под жестом — элементы уехали, снимок нет.
 *      Плашка «остаётся на месте и не следует за мышкой», а курсор ищет
 *      прямоугольники там, где содержимого уже нет.
 *   2. РАЗНЫЕ РАЗМЕРЫ. «Растянул карточку настроек на две колонки, потащил — под
 *      неё выделяется обычный одинарный слот». Формула «сосед едет на
 *      прямоугольник соседа» верна ровно тогда, когда все элементы одинаковые;
 *      при разных ширинах и переносе строк она врёт всегда.
 *   3. ПОРЯДОК В DOM НЕ МЕНЯЛСЯ ДО ОТПУСКАНИЯ. Отсюда «посадка» на 180мс перед
 *      коммитом и жалоба «соседи подстраиваются только через секунду».
 *   4. ОСЬ. Лента статистики переносится по строкам, а индекс вставки считался
 *      только по Y — блоки не могли встать рядом.
 *
 *  Стало: порядок меняется ЖИВЬЁМ. Хук отдаёт `order` — список, который надо
 *  рисовать, — и на каждом сдвиге курсора переставляет в нём тащимый элемент.
 *  Раскладку считает браузер (гриды, span'ы, перенос строк — всё бесплатно), а
 *  плавность даёт FLIP: до перестановки запоминаем места, после — измеряем
 *  новые и проигрываем разницу трансформом. Снимка, который может устареть, в
 *  механике больше нет вовсе: геометрия меряется заново на каждой перестановке
 *  и на каждый скролл.
 *
 *  ⚠️ ТРАНСФОРМЫ ПИШУТСЯ В DOM НАПРЯМУЮ, А НЕ ЧЕРЕЗ REACT. Иначе каждый кадр
 *  перетаскивания стоил бы ререндера всего списка. Отсюда правило для
 *  потребителей: `transform`/`transition`/`zIndex` перетаскиваемых элементов
 *  НЕ ЗАДАВАТЬ в JSX. React стирает только те свойства стиля, которыми он
 *  управлял в прошлом рендере, — пока их нет в пропсе `style`, наши записи
 *  живут. Появятся — начнут стирать друг друга через кадр.
 *
 *  Общий для приложения и веба (Э3 веб-паритета, 2026-08-02): «нет адекватного
 *  перетаскивания плейлистов» в вебе лечится именно им — жест целиком на
 *  Pointer Events и платформы не касается. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cssZoom } from "@muza/ui";
import {
  DRAG_THRESHOLD,
  HOLD_MS,
  clampShift,
  dist,
  moveItem,
  shouldStart,
  unionBox,
  type Box,
} from "./dragEngine";

/** Сколько плашка ДОЕЗЖАЕТ до слота после отпускания. Чисто зрительная фаза:
 *  порядок к этому моменту уже коммитнут (в отличие от прежней «посадки», где
 *  коммита ждали 180мс — и соседи всё это время стояли неправильно). */
const LAND_MS = 200;

/** Пауза между перестановками. Пока прошлая доигрывается, новую НЕ решаем:
 *  решение по геометрии, которая прямо сейчас едет, раскачивало само себя —
 *  микродвижения курсора у границы давали каскад мгновенных пересборок, и всё
 *  «очень быстро перемещалось» (жалоба владельца 04.08). Каждая перестановка
 *  теперь доигрывается ВИДИМОЙ анимацией, и глаз успевает прочитать, что
 *  куда поехало. Отложенный пересчёт (stepTimer) добирает последний замысел,
 *  если рука уже остановилась. */
const REORDER_LOCK_MS = 180;

/** Сторож пары: на сколько рука обязана СДВИНУТЬСЯ с места прошлого обмена,
 *  чтобы обмен С ТЕМ ЖЕ соседом сработал снова.
 *
 *  Зачем. Правило «вошёл в чужую ячейку» стабильно, только когда после обмена
 *  тащимый встаёт ПОД точку захвата. В ленте с переносом строк это не
 *  гарантировано: широкий блок («Топ треков» во всю ширину) после обмена с
 *  узкими («Лайки») снова накрывает точку захвата — и условие входа
 *  срабатывает заново, в обе стороны. Владелец (третья приёмка 04.08):
 *  «мне достаточно просто двигать мышкой в одном месте — и он начинает просто
 *  прыгать туда-сюда». Микродвижения на месте обмен не отменяют; осознанный
 *  увод руки (≥ порога) — отменяет. С другим соседом порог не действует:
 *  пилит именно ПАРА. */
const REORDER_UNDO_MIN = 24;

/** Текущий сдвиг элемента ИЗ ЖИВОГО стиля — в середине анимации там
 *  промежуточное значение, а не конечное. Сначала computed (браузер отдаёт
 *  matrix с анимированным сдвигом), затем инлайн (jsdom тестов computed не
 *  считает). Единицы — CSS-пиксели зумленного поддерева. */
function currentTranslate(el: HTMLElement): { x: number; y: number } {
  const parse = (raw: string): { x: number; y: number } | null => {
    if (!raw || raw === "none") return null;
    const m = /^matrix\(([^)]+)\)/.exec(raw);
    if (m) {
      const p = m[1].split(",").map((v) => parseFloat(v));
      return { x: p[4] || 0, y: p[5] || 0 };
    }
    const t = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(raw);
    return t ? { x: parseFloat(t[1]), y: parseFloat(t[2]) } : null;
  };
  const computed = typeof getComputedStyle === "function" ? parse(getComputedStyle(el).transform) : null;
  return computed ?? parse(el.style.transform) ?? { x: 0, y: 0 };
}

/** Полоса у края прокручиваемой области, в которой перетаскивание само листает
 *  экран, и максимальная скорость (px за кадр). Без этого длинный список
 *  переставляется только в пределах видимого куска: «переместить её выше» выше
 *  верхней кромки просто нечем. */
const AUTOSCROLL_ZONE = 64;
const AUTOSCROLL_MAX = 22;

const ZERO_BOX: Box = { top: 0, left: 0, right: 0, bottom: 0 };

/** Ближайший предок, который реально прокручивается. Нужен и автолистанию, и
 *  подписке на скролл: слушать только window мало — контентная колонка
 *  приложения прокручивается сама. */
function findScroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    const scrollsY = /auto|scroll|overlay/.test(style.overflowY) && p.scrollHeight > p.clientHeight + 1;
    const scrollsX = /auto|scroll|overlay/.test(style.overflowX) && p.scrollWidth > p.clientWidth + 1;
    if (scrollsY || scrollsX) return p;
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export interface LocalReorder {
  /** ПОРЯДОК, КОТОРЫЙ НАДО РИСОВАТЬ. Вне жеста совпадает с `ids`, во время
   *  жеста показывает будущий порядок. Потребитель обязан раскладывать свои
   *  элементы по нему (pickByOrder в dragEngine.ts), иначе живого предпросмотра
   *  не будет и вернётся вся прежняя механика со снимком. */
  order: readonly string[];
  /** id тащимого элемента; null — реордер не идёт. */
  draggingId: string | null;
  /** Повесить на ручку элемента: {...grip(id)}. */
  grip: (id: string) => { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  /** Ref-колбэк на ОБЁРТКУ элемента (то, что двигается transform'ом). */
  itemRef: (id: string) => (el: HTMLElement | null) => void;
}

export function useLocalReorder({
  ids,
  resolveTo,
  onCommit,
}: {
  /** Порядок элементов — ровно тот, что на экране. */
  ids: readonly string[];
  /** Куда встанет плашка: splice-индекс из прямоугольников ТЕКУЩЕГО (живого)
   *  порядка. `x, y` — ТОЧКА ЗАХВАТА (курсор): столбец — insertionIndex по
   *  серединам соседей, сетка и лента с переносом строк — gridInsertionIndex
   *  входом в чужую ячейку. */
  resolveTo: (rects: readonly Box[], from: number, x: number, y: number) => number;
  onCommit: (id: string, toIndex: number) => void;
}): LocalReorder {
  const els = useRef(new Map<string, HTMLElement>());
  /** Настоящие места элементов (координаты вьюпорта, БЕЗ наших трансформов).
   *  Перемеряются на каждой перестановке и на каждый скролл. */
  const slots = useRef(new Map<string, Box>());
  const bounds = useRef<Box | null>(null);
  /** Экранные пиксели → зум-единицы transform'а: вся геометрия (rects, clientX)
   *  экранная, а transform внутри зумленного корня (prefs.uiScale) движок
   *  умножает на zoom — выдаваемые сдвиги делим, иначе плашка обгоняет мышку. */
  const zoom = useRef(1);
  const pending = useRef<{ id: string; x0: number; y0: number; timer: number } | null>(null);
  /** Проглотить click, который браузер шлёт ПОСЛЕ завершённого жеста.
   *
   *  Плашка едет за курсором, поэтому pointerdown и pointerup попадают в один
   *  и тот же элемент — Chromium честно генерит click, какой бы длинной ни
   *  была протяжка. С хватом «за весь блок» (04.08) этот click стал попадать в
   *  кнопку строки/плитки: каждая перестановка плейлиста ЗАОДНО ОТКРЫВАЛА его
   *  (ревизия 04.08). Поднятый жест — не клик по смыслу; флаг ставится на
   *  подъёме и гасит ровно один ближайший click на захвате. Обычный клик без
   *  подъёма (ни удержания, ни сдвига) флага не видит и работает как раньше. */
  const swallowClick = useRef(false);
  /** Синхронный признак живого переноса: setState не успевает между
   *  pointermove и pointerup в одном кадре (та же гоча, что в DragLayer).
   *  grabX/grabY — где внутри плашки её держат, чтобы она не прыгала к курсору
   *  ни на подъёме, ни на любой из перестановок. */
  const drag = useRef<{ id: string; grabX: number; grabY: number } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const scroller = useRef<HTMLElement | null>(null);
  /** Позиция прокрутки на момент последнего замера — для жёсткого сдвига
   *  слотов при скролле (см. scrolled ниже). */
  const scrollPos = useRef({ top: 0, left: 0 });
  const autoScroll = useRef<number | null>(null);
  const landTimer = useRef<number | null>(null);
  /** Когда случилась последняя перестановка — от неё считается пауза. */
  const lastReorder = useRef(0);
  /** С кем и где был последний обмен — для сторожа пары (REORDER_UNDO_MIN). */
  const lastSwap = useRef<{ partner: string; x: number; y: number } | null>(null);
  /** Отложенный пересчёт на конец паузы: рука остановилась, а замысел ещё
   *  не применён — без этого последний сдвиг терялся бы до следующего
   *  pointermove, которого может не быть. */
  const stepTimer = useRef<number | null>(null);

  /** ИСХОДНЫЕ инлайн-стили элементов до первого касания движком.
   *
   *  ⚠️ Возвращать надо РОВНО их, а не «пусто». React пишет инлайн-стиль только
   *  когда проп изменился: если у элемента в JSX стоит свой transition (фон
   *  карточки, transform кнопки), а уборка жеста стирала его в "", React его
   *  НЕ восстанавливал — и элемент навсегда терял свои плавные переходы.
   *  Владелец видел это как «нажатие стало резким, много анимаций пропало». */
  const orig = useRef(new Map<string, { transition: string; zIndex: string }>());
  const remember = (id: string, el: HTMLElement) => {
    if (!orig.current.has(id)) orig.current.set(id, { transition: el.style.transition, zIndex: el.style.zIndex });
  };

  /** Живой порядок. В ref — потому что читается из обработчиков указателя, в
   *  state — потому что им рисуют. */
  const previewRef = useRef<readonly string[] | null>(null);
  const [preview, setPreview] = useState<readonly string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const resolveRef = useRef(resolveTo);
  resolveRef.current = resolveTo;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const order = preview ?? ids;

  const cancelPending = useCallback(() => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current = null;
    }
  }, []);

  /** Снять НАСТОЯЩИЕ места всех элементов.
   *
   *  Сначала гасим свои трансформы (`transition: none` обязателен — иначе
   *  снятие трансформа само стало бы анимацией, и прямоугольник вернул бы
   *  промежуточное, «едущее» значение), затем читаем. Первое же чтение
   *  прямоугольника заставляет браузер посчитать раскладку, дальше все чтения
   *  идут из одного согласованного состояния. */
  const measure = useCallback(() => {
    const list = previewRef.current ?? idsRef.current;
    for (const id of list) {
      const el = els.current.get(id);
      if (!el) continue;
      remember(id, el); // исходный инлайн-стиль — ДО первого касания движком
      el.style.transition = "none";
      el.style.transform = "";
    }
    const next = new Map<string, Box>();
    for (const id of list) {
      const el = els.current.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.set(id, { top: r.top, left: r.left, right: r.right, bottom: r.bottom });
    }
    slots.current = next;
    const all = [...next.values()];
    bounds.current = all.length > 0 ? unionBox(all) : null;
    const sc = scroller.current;
    scrollPos.current = sc
      ? { top: sc.scrollTop, left: sc.scrollLeft }
      : { top: window.scrollY, left: window.scrollX };
  }, []);

  /** Поставить тащимую плашку под курсор. Считается от ЖИВОГО слота, поэтому
   *  переживает и перестановку соседей, и прокрутку страницы. */
  const paint = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const el = els.current.get(d.id);
    const slot = slots.current.get(d.id);
    if (!el || !slot) return;
    const z = zoom.current || 1;
    const shift = clampShift(
      slot,
      bounds.current ?? slot,
      pointer.current.x - d.grabX - slot.left,
      pointer.current.y - d.grabY - slot.top,
    );
    el.style.transition = "none"; // под пальцем плашка стоит РОВНО под ним
    el.style.transform = `translate(${shift.x / z}px, ${shift.y / z}px)`;
  }, []);

  /** Пересчитать будущую позицию. Перестановка идёт через state: новый порядок
   *  рисует React, а разницу мест доигрывает FLIP в layout-эффекте ниже.
   *
   *  В resolveTo уходит ТОЧКА ЗАХВАТА — сам курсор. Требование владельца
   *  04.08: «я захватил текст — и только когда этот текст пересекает границу,
   *  объект должен туда переходить… чтобы это зависело от курсора, а не от
   *  центра плашки». Версия с центром видимого положения жила полдня и решала
   *  за руку: большая плашка меняла место, когда её точка захвата ещё ничего
   *  не пересекла. */
  const step = useCallback(() => {
    const d = drag.current;
    const list = previewRef.current;
    if (!d || !list) return;
    const from = list.indexOf(d.id);
    if (from < 0) return;
    paint(); // плашка липнет к курсору ВСЕГДА, пауза её не касается
    const wait = REORDER_LOCK_MS - (Date.now() - lastReorder.current);
    if (wait > 0) {
      if (stepTimer.current === null) {
        stepTimer.current = window.setTimeout(() => {
          stepTimer.current = null;
          step();
        }, wait);
      }
      return;
    }
    const rects = list.map((id) => slots.current.get(id) ?? ZERO_BOX);
    const to = resolveRef.current(rects, from, pointer.current.x, pointer.current.y);
    if (to !== from && to >= 0 && to < list.length) {
      // Сторож пары (см. REORDER_UNDO_MIN): повторный обмен С ТЕМ ЖЕ соседом
      // требует настоящего сдвига руки с места прошлого обмена — иначе широкий
      // блок в ленте с переносом строк пилит обмен туда-сюда под микродвижениями.
      const partner = list[to];
      if (
        lastSwap.current &&
        lastSwap.current.partner === partner &&
        dist(lastSwap.current.x, lastSwap.current.y, pointer.current.x, pointer.current.y) < REORDER_UNDO_MIN
      ) {
        return;
      }
      lastSwap.current = { partner, x: pointer.current.x, y: pointer.current.y };
      lastReorder.current = Date.now();
      previewRef.current = moveItem(list, from, to);
      setPreview(previewRef.current);
    }
  }, [paint]);

  const stopAutoScroll = useCallback(() => {
    if (autoScroll.current !== null) {
      cancelAnimationFrame(autoScroll.current);
      autoScroll.current = null;
    }
  }, []);

  /** Автолистание у краёв: чем ближе курсор к кромке, тем быстрее едет экран.
   *  Скролл поднимает событие scroll, а его обработчик перемеряет геометрию —
   *  отдельной синхронизации не нужно. */
  const tickAutoScroll = useCallback(() => {
    autoScroll.current = null;
    if (!drag.current) return;
    const sc = scroller.current;
    const view = sc
      ? sc.getBoundingClientRect()
      : ({ top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth } as DOMRect);
    const rate = (near: number) => Math.round(AUTOSCROLL_MAX * Math.min(1, (AUTOSCROLL_ZONE - near) / AUTOSCROLL_ZONE));
    let dy = 0;
    if (pointer.current.y - view.top < AUTOSCROLL_ZONE) dy = -rate(pointer.current.y - view.top);
    else if (view.bottom - pointer.current.y < AUTOSCROLL_ZONE) dy = rate(view.bottom - pointer.current.y);
    if (dy !== 0) {
      if (sc) sc.scrollTop += dy;
      // окно листаем только когда ему есть куда: у нелистаемой страницы
      // scrollBy — пустой вызов на каждый кадр у кромки
      else if ((document.scrollingElement?.scrollHeight ?? 0) > window.innerHeight) window.scrollBy(0, dy);
    }
    autoScroll.current = requestAnimationFrame(tickAutoScroll);
  }, []);

  /** УБОРКА ПОСЛЕ ПОЛЁТА — у ВСЕХ, а не у тащимого. Вызывается таймером
   *  посадки И новым подъёмом, случившимся раньше таймера: без этого хвост
   *  прошлого жеста догорал ПОСРЕДИ нового и стирал ему стили, предпросмотр и
   *  карту исходных стилей (ревизия 04.08 — гонка в окне LAND_MS). */
  const settleLand = useCallback(() => {
    if (landTimer.current) {
      clearTimeout(landTimer.current);
      landTimer.current = null;
    }
    setDraggingId(null);
    for (const id of previewRef.current ?? idsRef.current) {
      const item = els.current.get(id);
      if (!item) continue;
      // Возвращаем РОВНО исходный инлайн-стиль, а не «пусто»: React не
      // перезаписывает style, пока проп не изменился, и стёртый transition
      // элемента (фон карточки, transform кнопки) пропадал бы навсегда —
      // «нажатие стало резким, много анимаций пропало» (владелец 04.08).
      const o = orig.current.get(id);
      item.style.transition = o ? o.transition : "";
      item.style.zIndex = o ? o.zIndex : "";
      item.style.transform = "";
    }
    orig.current.clear();
    // Предпросмотр, совпавший с настоящим списком, больше не нужен: держать
    // копию того же порядка незачем (отмена по Escape приходит именно сюда).
    if (previewRef.current && sameOrder(previewRef.current, idsRef.current)) {
      previewRef.current = null;
      setPreview(null);
    }
  }, []);

  const lift = useCallback(
    (x: number, y: number) => {
      const p = pending.current;
      if (!p) return;
      clearTimeout(p.timer);
      pending.current = null;
      const list = idsRef.current;
      if (!list.includes(p.id)) return;
      const el = els.current.get(p.id);
      if (!el) return;
      // Прошлая посадка ещё летит — досаживаем СЕЙЧАС: её таймер иначе догорит
      // посреди нового жеста и сотрёт ему стили и предпросмотр (гонка LAND_MS).
      if (landTimer.current) settleLand();
      previewRef.current = list.slice();
      zoom.current = cssZoom(el) || 1;
      scroller.current = findScroller(el);
      measure();
      const slot = slots.current.get(p.id);
      if (!slot) return;
      // Держим за ТУ ЖЕ точку, за которую взяли: плашка не прыгает под курсор
      // ни сейчас, ни после перестановки соседей.
      drag.current = { id: p.id, grabX: p.x0 - slot.left, grabY: p.y0 - slot.top };
      pointer.current = { x, y };
      lastReorder.current = 0; // первый ход жеста пауза не задерживает
      lastSwap.current = null; // сторож пары — на каждый жест свой
      swallowClick.current = true; // click после жеста — не клик (см. объявление)
      // Поверх соседей. zIndex работает и без position: элементы групп лежат в
      // flex/grid-контейнерах, а их дети образуют контекст наложения сами.
      el.style.zIndex = "3";
      setPreview(previewRef.current);
      setDraggingId(p.id);
      paint();
      autoScroll.current = requestAnimationFrame(tickAutoScroll);
    },
    [measure, paint, settleLand, tickAutoScroll],
  );

  /** ЗАВЕРШЕНИЕ ЖЕСТА. Порядок коммитится СРАЗУ: на экране он уже конечный, и
   *  ждать нечего. Полёт плашки к слоту — чистая косметика поверх готового
   *  результата (прежняя «посадка» держала коммит 180мс и была видна). */
  const finish = useCallback(
    (cancelled: boolean) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      stopAutoScroll();
      if (stepTimer.current !== null) {
        clearTimeout(stepTimer.current);
        stepTimer.current = null;
      }
      const list = previewRef.current ?? idsRef.current;
      const el = els.current.get(d.id);
      // Уборка ПОСЛЕ полёта — у ВСЕХ, а не у тащимого. Замер мест гасит
      // сглаживание у каждого элемента (`transition: none`), и тот, у кого
      // разница мест вышла нулевой, оставался бы с погашенным сглаживанием —
      // терял собственные плавные наведения. Жест обязан вернуть стиль ровно
      // в то состояние, в каком его взял: пусто.
      if (landTimer.current) clearTimeout(landTimer.current);
      landTimer.current = window.setTimeout(settleLand, LAND_MS);
      if (cancelled) {
        // Esc — вернуть исходный порядок. Если он успел измениться, возврат
        // играет FLIP-эффект: drag уже снят, и бывшая тащимая плашка летит
        // домой ОДНОЙ пружиной вместе с соседями, от своего живого положения.
        const changed = !sameOrder(list, idsRef.current);
        previewRef.current = idsRef.current.slice();
        if (changed) {
          setPreview(previewRef.current);
          return;
        }
        // порядок не менялся — двигать некого, плашка просто летит в слот
      } else {
        const from = idsRef.current.indexOf(d.id);
        const to = list.indexOf(d.id);
        if (from >= 0 && to >= 0 && from !== to) commitRef.current(d.id, to);
      }
      if (el) {
        // Полёт к слоту — единственное движение, которому здесь место: порядок
        // уже коммитнут, ждать его нечего.
        el.style.transition = prefersReducedMotion()
          ? "none"
          : `transform ${LAND_MS}ms var(--spring-grab, var(--ease-out))`;
        el.style.transform = "";
      }
    },
    [settleLand, stopAutoScroll],
  );

  /** FLIP: порядок уже перерисован, места изменились — доигрываем разницу.
   *
   *  Стартовая точка каждого элемента — его ЖИВОЕ видимое положение: прежний
   *  слот плюс сдвиг, дочитанный из computed-стиля. Дочитывать обязательно:
   *  в середине идущей анимации там промежуточное значение, и без него
   *  каждый новый пересчёт обрывал предыдущий полёт телепортом на слот —
   *  владелец видел это как «всё двигается так быстро, что не понимаешь,
   *  сверху блок или снизу». Теперь новая анимация ПОДХВАТЫВАЕТ элемент там,
   *  где он летит сейчас.
   *
   *  Эффект жив и после отпускания (landTimer): возврат по Escape доезжает
   *  той же пружиной, бывшая тащимая плашка — вместе со всеми. */
  useLayoutEffect(() => {
    if (!preview) return;
    if (!drag.current && !landTimer.current) return;
    const draggedId = drag.current?.id ?? null;
    const z = zoom.current || 1;
    // Видимые места ДО пересборки: прежний слот + доигрываемый сдвиг.
    const before = new Map<string, { x: number; y: number }>();
    for (const [id, slot] of slots.current) {
      const el = els.current.get(id);
      if (!el) continue;
      const t = currentTranslate(el);
      before.set(id, { x: slot.left + t.x * z, y: slot.top + t.y * z });
    }
    measure();
    const reduced = prefersReducedMotion();
    const started: HTMLElement[] = [];
    for (const [id, now] of slots.current) {
      if (id === draggedId) continue;
      const was = before.get(id);
      const el = els.current.get(id);
      if (!el || !was) continue;
      const dx = (was.x - now.left) / z;
      const dy = (was.y - now.top) / z;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.style.transform = `translate(${dx}px, ${dy}px)`; // transition уже "none" после measure
      started.push(el);
    }
    if (started.length > 0 && !reduced) {
      // Заставляем браузер увидеть стартовые значения ДО того, как мы их
      // отменим: без этого чтения он схлопнет обе записи в одну и анимации не
      // будет вовсе.
      void document.documentElement.offsetHeight;
      for (const el of started) {
        el.style.transition = `transform var(--dur-base) var(--spring-snap, var(--ease-out))`;
        el.style.transform = "";
      }
    } else {
      for (const el of started) el.style.transform = "";
    }
    paint();
  }, [preview, measure, paint]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const p = pending.current;
      if (p && !drag.current) {
        if (dist(p.x0, p.y0, e.clientX, e.clientY) >= DRAG_THRESHOLD) lift(e.clientX, e.clientY);
        return;
      }
      if (!drag.current) return;
      e.preventDefault();
      step();
    };
    const up = () => {
      cancelPending();
      finish(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      cancelPending();
      if (!drag.current) return;
      // Пометка «Escape взят»: пока идёт жест, клавиша принадлежит ему, а не
      // выходу из режима правки вида (см. shell/LookEditLayer.tsx).
      e.preventDefault();
      finish(true);
    };
    /** Прокрутка под жестом. Слушаем НА ЗАХВАТЕ: события scroll не всплывают,
     *  а прокручиваться может любой предок, не только окно.
     *
     *  ⚠️ ЗДЕСЬ НЕЛЬЗЯ ПЕРЕМЕРЯТЬ ГЕОМЕТРИЮ ЧЕРЕЗ measure(). Замер гасит
     *  трансформы (`transition: none`) — то есть УБИВАЕТ летящие FLIP-анимации.
     *  А перестановка САМА порождает событие прокрутки: смена высоты
     *  содержимого заставляет браузер подогнать scrollTop (scroll anchoring),
     *  и каждый обмен на прокручиваемом экране убивал собственную анимацию в
     *  момент старта — владелец видел «деформирование постоянно и очень резко,
     *  без какой-либо анимации». Прокрутка двигает всё ЖЁСТКО — поэтому слоты
     *  сдвигаются той же дельтой арифметикой, без чтения DOM. Чужие скроллы
     *  (карусель полки внутри элемента) слоты не двигают — фильтр по цели. */
    const scrolled = (e: Event) => {
      if (!drag.current) return;
      const sc = scroller.current;
      // «Наша» прокрутка: сам скроллер списка либо окно/документ (их цель — НЕ
      // HTMLElement; сравнивать с `window` по идентичности нельзя — в jsdom у
      // события другой экземпляр Window). Чужая — прокрутка ВЛОЖЕННОГО
      // элемента (карусель полки внутри тащимого): слоты она не двигает.
      const t = e.target;
      const ours = sc ? t === sc : !(t instanceof HTMLElement) || t === document.scrollingElement;
      if (!ours) return;
      const top = sc ? sc.scrollTop : window.scrollY;
      const left = sc ? sc.scrollLeft : window.scrollX;
      // scrollTop скроллера внутри зумленного корня — CSS-пиксели, а слоты
      // сняты getBoundingClientRect в ЭКРАННЫХ: дельту приводим множителем,
      // иначе на масштабе 85/125 % слоты уезжали бы медленнее/быстрее экрана.
      // Прокрутка ОКНА зума не проходит — там множитель 1.
      const k = sc ? zoom.current || 1 : 1;
      const dy = (scrollPos.current.top - top) * k;
      const dx = (scrollPos.current.left - left) * k;
      scrollPos.current = { top, left };
      if (dx === 0 && dy === 0) return;
      const shifted = new Map<string, Box>();
      for (const [id, b] of slots.current) {
        shifted.set(id, { top: b.top + dy, left: b.left + dx, right: b.right + dx, bottom: b.bottom + dy });
      }
      slots.current = shifted;
      if (bounds.current) {
        bounds.current = {
          top: bounds.current.top + dy,
          left: bounds.current.left + dx,
          right: bounds.current.right + dx,
          bottom: bounds.current.bottom + dy,
        };
      }
      step();
    };
    /** Гаситель click после жеста — на захвате, раньше всех кнопок. Один раз:
     *  проглотил — снял флаг. Новый pointerdown тоже снимает (см. grip) —
     *  жест, оборванный pointercancel, не оставляет мину под чужой клик. */
    const clickCap = (e: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("click", clickCap, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("click", clickCap, true);
    };
  }, [cancelPending, finish, lift, measure, step]);

  // Список догнал предпросмотр — предпросмотр больше не нужен. Сравниваем, а не
  // гасим по таймеру: пока родитель не применил порядок (или отказался его
  // применять), на экране обязан оставаться тот, который человек собрал руками.
  useEffect(() => {
    if (drag.current || !previewRef.current) return;
    if (sameOrder(previewRef.current, ids)) {
      previewRef.current = null;
      setPreview(null);
    }
  }, [ids]);

  // Список сменился под живым переносом (перечитка с сервера) — переносу
  // больше нечего двигать честно; тихо отменяем.
  useEffect(() => {
    if (drag.current && !ids.includes(drag.current.id)) finish(true);
  }, [ids, finish]);

  // Экран закрыли посреди жеста — таймеры и кадры переживали компонент.
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
      if (landTimer.current) clearTimeout(landTimer.current);
      if (stepTimer.current !== null) clearTimeout(stepTimer.current);
      if (autoScroll.current !== null) cancelAnimationFrame(autoScroll.current);
    },
    [],
  );

  const grip = useCallback(
    (id: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (!shouldStart(e)) return; // Alt/Ctrl/правая — не наш жест
        if (drag.current) return;
        swallowClick.current = false; // новое нажатие — чистый лист для click
        cancelPending();
        pointer.current = { x: e.clientX, y: e.clientY };
        const timer = window.setTimeout(() => {
          const p = pending.current;
          if (p) lift(p.x0, p.y0); // держал не двигаясь — поднимаем
        }, HOLD_MS);
        pending.current = { id, x0: e.clientX, y0: e.clientY, timer };
      },
    }),
    [cancelPending, lift],
  );

  const itemRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) els.current.set(id, el);
      else els.current.delete(id);
    },
    [],
  );

  return { order, draggingId, grip, itemRef };
}
