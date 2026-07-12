/** Thin loading ring (2px stroke, quarter gap) in the DS line style. */
export interface SpinnerProps {
  /** Diameter, px. Default 18. */
  size?: number;
  /** Stroke color. Default currentColor. */
  color?: string;
  /** Accessible label. Default "Загрузка". */
  label?: string;
  style?: React.CSSProperties;
}
