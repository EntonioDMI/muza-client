/** Horizontal carousel shelf for the home feed («Продолжить слушать», «Новые релизы»). */
export interface ShelfProps {
  /** Section header, sentence case: «Продолжить слушать». */
  title: string;
  /** Ghost action label. Default «Показать всё». */
  action?: string;
  /** Shown only when provided. */
  onAction?: () => void;
  /** Row content — usually <Tile /> elements. */
  children: React.ReactNode;
  style?: React.CSSProperties;
}
