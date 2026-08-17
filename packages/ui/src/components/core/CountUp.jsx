import { useEffect, useRef, useState } from "react";

/** ЧИСЛО, КОТОРОЕ ДОСЧИТЫВАЕТ ДО СВОЕГО ЗНАЧЕНИЯ.
 *
 *  Приём из React Bits (там `CountUp`), взятый ТОЧЕЧНО — на экран статистики.
 *  Это единственное место в программе, где числа и есть содержание: человек
 *  открывает его изредка и специально, чтобы на них посмотреть. В плеере,
 *  который открыт весь день, такое оживление на каждом счётчике быстро стало
 *  бы шумом — поэтому компонент есть, но применяется не везде.
 *
 *  ⚠️ СЧИТАЕТ ОДИН РАЗ НА ЗНАЧЕНИЕ. Пересчёт при каждой перерисовке превратил
 *  бы обычное обновление данных в пляску цифр — счётчик снова уезжал бы к нулю
 *  на ровном месте.
 *
 *  ⚠️ ЧЕРЕЗ requestAnimationFrame, А НЕ setInterval. Интервал не знает про
 *  частоту экрана и про то, что вкладка спрятана: он продолжает будить
 *  процессор в фоне и рисует лишние кадры. rAF на скрытой вкладке
 *  останавливается сам.
 *
 *  При `prefers-reduced-motion` значение ставится сразу: человек попросил не
 *  двигать — не двигаем, а не «двигаем помедленнее».
 */

/** Замедление к концу: быстро набирает, мягко причаливает. Линейный отсчёт
 *  читается как загрузка, а не как итог. */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export function CountUp({ value, durationMs = 900, format, className, style }) {
  const target = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    const reduce =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame !== "function" || durationMs <= 0) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = from.current;
    if (start === target) return;
    let raf = 0;
    // ⚠️ null, А НЕ 0, КАК ПРИЗНАК ПЕРВОГО КАДРА — это поймал тест. Ноль
    // законная метка времени, и на `if (!t0)` отсчёт залипал: каждый кадр
    // считал себя первым, доля оставалась нулевой, число не двигалось.
    let t0 = null;
    const tick = (now) => {
      if (t0 === null) t0 = now;
      const p = Math.min(1, (now - t0) / durationMs);
      const v = start + (target - start) * easeOut(p);
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  // Округление — ПОСЛЕ доли, а не до: иначе на промежуточных кадрах видно
  // дробные хвосты вроде «1247.8».
  const rounded = Math.round(shown);
  return (
    <span className={className} style={style}>
      {format ? format(rounded) : rounded}
    </span>
  );
}
