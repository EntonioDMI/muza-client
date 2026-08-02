/** Математика графиков админки (кусок C): свой рендер на токенах ДС, без
 *  чарт-библиотек — конвенция проекта (спека статистики §4.2, прецедент
 *  statsBars у StatsView). Чистые функции; SVG-координаты — y растёт вниз.
 *  Рендер — views/adminCharts.tsx, здесь только числа. */

export interface ChartBox {
  w: number;
  h: number;
  maxY: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const fmt = (n: number): string => String(round1(n));

/** «Красивый» потолок оси: первый шаг лестницы 1-2-5×10^k, не меньше значения.
 *  Минимум 1 — деления на ноль у пустых серий не бывает. */
export function niceMax(maxValue: number): number {
  if (maxValue <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(maxValue));
  for (const step of [1, 2, 5]) {
    if (step * pow >= maxValue) return step * pow;
  }
  return 10 * pow;
}

/** Ломаная серии: точки равномерно по ширине. Одна точка — горизонталь. */
export function linePath(counts: number[], box: ChartBox): string {
  if (counts.length === 0) return "";
  const y = (v: number) => box.h - (v / box.maxY) * box.h;
  if (counts.length === 1) {
    const yy = fmt(y(counts[0]));
    return `M0,${yy}L${fmt(box.w)},${yy}`;
  }
  const step = box.w / (counts.length - 1);
  return counts.map((v, i) => `${i === 0 ? "M" : "L"}${fmt(i * step)},${fmt(y(v))}`).join("");
}

/** Столбики: слот на точку, зазор — доля слота, ноль — нулевая высота. */
export function barGeometry(
  counts: number[],
  box: ChartBox,
  gapRatio = 1 / 3,
): { x: number; y: number; w: number; h: number }[] {
  if (counts.length === 0) return [];
  const slot = box.w / counts.length;
  const gap = slot * gapRatio;
  return counts.map((v, i) => {
    const h = (v / box.maxY) * box.h;
    return { x: round1(i * slot + gap / 2), y: round1(box.h - h), w: round1(slot - gap), h: round1(h) };
  });
}

/** Индексы подписей оси X: равномерно, не больше maxTicks(+1), края обязательны. */
export function xTickIndexes(length: number, maxTicks: number): number[] {
  if (length <= 0) return [];
  if (length === 1) return [0];
  if (length <= maxTicks) return Array.from({ length }, (_, i) => i);
  const step = Math.ceil((length - 1) / (maxTicks - 1));
  const out: number[] = [];
  for (let i = 0; i < length - 1; i += step) out.push(i);
  out.push(length - 1);
  return out;
}
