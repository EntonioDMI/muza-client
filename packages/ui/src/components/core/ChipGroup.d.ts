/** Single-select chip row — the highlight SLIDES to the chosen chip. */
export interface ChipGroupProps {
  /** Chips: strings or { key, label, icon? (Lucide name) }. */
  items: Array<string | { key: string; label: string; icon?: string }>;
  /** Selected key. */
  value: string;
  onChange?: (key: string) => void;
  style?: React.CSSProperties;
}
