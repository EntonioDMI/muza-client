/** Segmented pill tabs (settings sections, view switchers). */
export interface TabsProps {
  /** Tab items: strings or { key, label }. */
  items: Array<string | { key: string; label: string }>;
  /** Selected key. */
  value: string;
  onChange?: (key: string) => void;
  /** Segments share the container width equally (forms, narrow cards). */
  stretch?: boolean;
  /** Segments wrap to new rows — every tab stays visible at any width. */
  wrap?: boolean;
  style?: React.CSSProperties;
}
