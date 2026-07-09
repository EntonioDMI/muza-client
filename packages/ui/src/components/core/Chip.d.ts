/** Filter chip (home feed filters, settings presets). */
export interface ChipProps {
  children: React.ReactNode;
  /** Optional leading Lucide icon name. */
  icon?: string;
  /** Selected = one surface step up, full-strength text. */
  selected?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
