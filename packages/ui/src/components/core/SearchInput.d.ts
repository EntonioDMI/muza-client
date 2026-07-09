/** Pill search field (sidebar / search screen). */
export interface SearchInputProps {
  value?: string;
  onChange?: (value: string) => void;
  /** Default "Поиск". */
  placeholder?: string;
  /** Leading Lucide icon. Default "search"; use e.g. "list-music" in dialogs. */
  icon?: string;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}
