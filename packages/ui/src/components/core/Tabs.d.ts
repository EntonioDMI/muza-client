/** Segmented pill tabs (settings sections, view switchers). */
export interface TabsProps {
  /** Tab items: strings or { key, label }. */
  items: Array<string | { key: string; label: string }>;
  /** Selected key. */
  value: string;
  onChange?: (key: string) => void;
  style?: React.CSSProperties;
}
