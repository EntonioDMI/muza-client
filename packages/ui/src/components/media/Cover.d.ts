/**
 * Square cover art — the single artwork primitive of the system.
 * @startingPoint section="Media" subtitle="Обложка: квадрат, cover-кроп, плейсхолдер" viewport="700x280"
 */
export interface CoverProps {
  /** Cover image URL. null/undefined — рисуется плейсхолдер (не подставная картинка). */
  src?: string | null;
  /** Число (px) или CSS-длина, в т.ч. var(--size-cover-bar). Не задан — ширина по родителю. */
  size?: number | string;
  /** Радиус скругления. Default var(--r-xs). */
  radius?: string;
  /** Alt картинки. По умолчанию "" — обложка декоративна рядом с названием трека. */
  alt?: string;
  /** Класс на контейнер (например muza-view — анимация появления при смене трека). */
  className?: string;
  style?: React.CSSProperties;
}
