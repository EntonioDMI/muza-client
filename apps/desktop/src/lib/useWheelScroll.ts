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
 *  Плавный режим — rAF-догон цели экспонентой (полураспад ~90мс): колесо
 *  двигает target, кадры дотягивают scrollTop. Прямой режим — мгновенный
 *  scrollTop += delta. Оба пишут в DOM напрямую, React не ре-рендерится
 *  (гоча прогресс-бара 19.07: краска мимо React). */
import { useEffect } from "react";

/** Пиксельный шаг колеса: deltaMode 1 (строки) и 2 (страницы) приводим к
 *  пикселям, затем множитель скорости. Экспорт — для тестов. */
export function scaleDelta(deltaY: number, deltaMode: number, speedPct: number): number {
  const px = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return (px * speedPct) / 100;
}

/** Один кадр догона: экспоненциальное сближение current→target с полураспадом
 *  halfLifeMs. Возвращает новую позицию; ближе полупикселя — прилипаем. */
export function stepToward(current: number, target: number, dtMs: number, halfLifeMs = 90): number {
  const diff = target - current;
  if (Math.abs(diff) < 0.5) return target;
  const k = 1 - Math.pow(0.5, dtMs / halfLifeMs);
  return current + diff * k;
}

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

    const tick = (now: number) => {
      if (!el) return;
      const dt = Math.min(64, now - lastT || 16);
      lastT = now;
      const next = stepToward(el.scrollTop, target, dt);
      el.scrollTop = next;
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
