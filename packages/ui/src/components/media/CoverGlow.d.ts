/**
 * Мягкое свечение по цветам обложки — фон панели «Сейчас играет».
 * Размытая копия той же картинки: ни лишнего запроса, ни кадров анимации в
 * покое. Без `src` не рисуется вовсе.
 * @startingPoint section="Media" subtitle="Свечение по обложке" viewport="420x420"
 */
export interface CoverGlowProps {
  /** Адрес обложки. null/undefined — свечения нет (плейсхолдер бесцветен). */
  src?: string | null;
  className?: string;
  style?: React.CSSProperties;
}
