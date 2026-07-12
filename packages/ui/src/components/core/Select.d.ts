/** Dropdown list — field-styled trigger + frosted option panel (settings,
 *  filters). Fixed-positioned: escapes overflow containers; flips up near
 *  the bottom edge. Full keyboard model, focus returns to the trigger. */
export interface SelectProps {
  /** Options: strings or { key, label, icon? (Lucide name) }. */
  items: Array<string | { key: string; label: string; icon?: string }>;
  /** Selected key. */
  value?: string;
  onChange?: (key: string) => void;
  /** Accessible label (Russian), e.g. "Тип фона". */
  ariaLabel?: string;
  /** Trigger width, px or CSS value. Default 220. */
  width?: number | string;
  disabled?: boolean;
  style?: React.CSSProperties;
}
