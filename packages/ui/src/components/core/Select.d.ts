/** Dropdown list — field-styled trigger + frosted option panel (settings,
 *  filters). Fixed-positioned: escapes overflow containers; flips up near
 *  the bottom edge. Full keyboard model, focus returns to the trigger. */
export interface SelectProps {
  /** Options: strings or { key, label, icon? (Lucide name) }.
   *  label may be a ReactNode (e.g. a span with its own fontFamily for the
   *  live font preview in Settings) — the component renders it as-is. */
  items: Array<string | { key: string; label: React.ReactNode; icon?: string }>;
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
