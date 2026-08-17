/**
 * Число, досчитывающее до значения. Точечный приём для экрана статистики —
 * единственного места, где числа и есть содержание. Считает один раз на
 * значение; при prefers-reduced-motion ставит сразу.
 * @startingPoint section="Core" subtitle="Счётчик: досчитывает до значения" viewport="360x120"
 */
export interface CountUpProps {
  /** Целевое число. Не-число трактуется как 0. */
  value: number;
  /** Длительность отсчёта, мс. 0 или меньше — поставить сразу. Default 900. */
  durationMs?: number;
  /** Как показать округлённое число (разделители, единицы). */
  format?: (n: number) => string;
  className?: string;
  style?: React.CSSProperties;
}
