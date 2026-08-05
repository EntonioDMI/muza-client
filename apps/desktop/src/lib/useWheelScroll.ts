/** Скорость и плавность прокрутки колесом (зона 2 спеки настроек 19.07).
 *
 *  Настройки такой раньше не существовало вовсе — прокрутка была нативной.
 *  Дефолты (speed 100, smooth off) означают «листенер НЕ вешается»: нулевой
 *  риск для тех, кто ничего не менял.
 *
 *  Устройство: один wheel-листенер на window (capture, passive:false — иначе
 *  preventDefault не работает). Обрабатывается только вертикальное колесо без
 *  модификаторов: горизонтальные полки, ctrl+zoom и трекпадный deltaX остаются
 *  нативными. Цель ищется подъёмом от e.target до корня — первый предок со
 *  scrollHeight > clientHeight и overflow-y auto/scroll.
 *
 *  Плавный режим — rAF-догон цели экспонентой: колесо двигает target, кадры
 *  дотягивают scrollTop. Прямой режим — мгновенный scrollTop += delta. Оба
 *  пишут в DOM напрямую, React не ре-рендерится (гоча прогресс-бара 19.07:
 *  краска мимо React).
 *
 *  ⚠️ ЧИСЛА ЗДЕСЬ — ФИЗИКА, А НЕ ПЕРЕХОД, и в шкалу длительностей
 *  (tokens/effects.css) им нельзя. Токен отвечает на «сколько человек ждёт
 *  окончания» — а окончания у прокрутки нет: она идёт, пока крутят колесо,
 *  и человек не ждёт её конца, он ей УПРАВЛЯЕТ. Привяжи мы полураспад к
 *  ползунку «скорость анимаций» — сцепка колеса с рукой поехала бы вместе с
 *  ним (та же причина, по которой --dur-follow объявлен вне шкалы).
 *  Три константы и почему именно столько — SMOOTH_HALF_LIFE_MS, MAX_FRAME_MS
 *  и STALL_LIMIT ниже.
 *
 *  ⚠️ ИНВАРИАНТ цикла догона (02.08): у него ТРИ выхода, и все обязательны —
 *  дошли до цели, контейнер ушёл из DOM, контейнер стоит на месте N кадров
 *  подряд. Раньше выход был один (дошли до цели), и недостижимая цель
 *  оставляла цикл крутиться 60 Гц до конца сессии. Подробности — у tick. */
import { useEffect } from "react";

/** Пиксельный шаг колеса: deltaMode 1 (строки) и 2 (страницы) приводим к
 *  пикселям, затем множитель скорости. Экспорт — для тестов. */
export function scaleDelta(deltaY: number, deltaMode: number, speedPct: number): number {
  const px = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return (px * speedPct) / 100;
}

/** Полураспад догона: за столько миллисекунд остаток пути сокращается вдвое.
 *  90мс — компромисс сцепки и мягкости: заметно меньше — и сглаживание
 *  перестаёт читаться (получается та же нативная прокрутка, только через JS),
 *  заметно больше — колесо начинает ощущаться «ватным», список едет уже после
 *  того, как рука остановилась. */
const SMOOTH_HALF_LIFE_MS = 90;

/** Потолок дельты времени между кадрами. Вкладка спала, окно было свёрнуто,
 *  главный поток встал на добыче — и в первый же кадр после этого приходит dt
 *  в сотни миллисекунд. Без клампа экспонента отработала бы этот провал одним
 *  прыжком почти в цель, то есть плавная прокрутка на глазах телепортировалась
 *  бы. 64мс ≈ четыре кадра при 60 Гц: реальные просадки поглощает, а провал
 *  после сна — нет. */
const MAX_FRAME_MS = 64;

/** Один кадр догона: экспоненциальное сближение current→target с полураспадом
 *  halfLifeMs. Возвращает новую позицию; ближе полупикселя — прилипаем. */
export function stepToward(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs = SMOOTH_HALF_LIFE_MS,
): number {
  const diff = target - current;
  if (Math.abs(diff) < 0.5) return target;
  const k = 1 - Math.pow(0.5, dtMs / halfLifeMs);
  return current + diff * k;
}

/** Сколько кадров без сдвига терпим, прежде чем признать цель недостижимой.
 *  6 ≈ 100мс при 60 Гц: столько «стояния» глазом не видно, а вечный цикл
 *  ловится. Меньше — и цикл сдавался бы на штатном субпиксельном
 *  защёлкивании, оборвав нормальную прокрутку на полпути. */
const STALL_LIMIT = 6;

function findScrollable(from: EventTarget | null): HTMLElement | null {
  let el = from instanceof Element ? from : null;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll" || oy === "overlay") return el;
    }
    el = el.parentElement;
  }
  return null;
}

export function useWheelScroll(speedPct: number, smooth: boolean): void {
  useEffect(() => {
    // Дефолты → нативная прокрутка, ничего не вешаем.
    if (speedPct === 100 && !smooth) return;

    let el: HTMLElement | null = null;
    let target = 0;
    let raf = 0;
    let lastT = 0;
    /** Сколько кадров подряд scrollTop не сдвинулся (см. STALL_LIMIT). */
    let stalled = 0;

    const tick = (now: number) => {
      if (!el) return;
      const dt = Math.min(MAX_FRAME_MS, now - lastT || 16);
      lastT = now;
      // ⚠️ ЦЕНА КАДРОВ (жалоба владельца 02.08 про ФПС в играх). До этой
      // проверки цикл завершался ТОЛЬКО дотянувшись до цели. Контейнер при
      // этом мог уехать из DOM — смена вкладки пересоздаёт <main key={view}>,
      // — а у отсоединённого узла scrollTop всегда 0 и записи в него не
      // берутся: догон не доходил до цели НИКОГДА. Цикл продолжал крутиться
      // 60 раз в секунду до конца сессии (и по кадру на каждую смену вкладки),
      // держа мёртвое поддерево в памяти.
      if (!el.isConnected) {
        el = null;
        return;
      }
      // Содержимое могло ужаться (список отфильтровали) — цель ниже нового
      // дна недостижима по той же причине.
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (target > max) target = max;
      const before = el.scrollTop;
      const next = stepToward(before, target, dt);
      el.scrollTop = next;
      // Записали — но узел не сдвинулся. Штатно так бывает кадр-другой
      // (субпиксельное защёлкивание), а вот подряд — значит упёрлись и цель
      // недостижима: страховка от того же вечного цикла в случаях, которых
      // isConnected не ловит.
      if (Math.abs(el.scrollTop - before) < 0.01) stalled += 1;
      else stalled = 0;
      if (stalled > STALL_LIMIT) {
        el = null;
        return;
      }
      if (next !== target) raf = requestAnimationFrame(tick);
      else el = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || e.deltaY === 0) return;
      const found = findScrollable(e.target);
      if (!found) return;
      e.preventDefault();
      const delta = scaleDelta(e.deltaY, e.deltaMode, speedPct);
      if (!smooth) {
        found.scrollTop += delta;
        return;
      }
      if (el !== found) {
        el = found;
        target = found.scrollTop;
        stalled = 0; // новый контейнер — счётчик «стоим на месте» с нуля
      }
      const max = found.scrollHeight - found.clientHeight;
      target = Math.max(0, Math.min(max, target + delta));
      cancelAnimationFrame(raf);
      lastT = performance.now();
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      cancelAnimationFrame(raf);
    };
  }, [speedPct, smooth]);
}
