/** Hover tooltip for icon-only controls. */
export interface TooltipProps {
  /** Russian label, 1–3 words: «Перемешать». */
  label: string;
  /** Default "top". */
  placement?: "top" | "bottom";
  children: React.ReactNode;
  style?: React.CSSProperties;
}
