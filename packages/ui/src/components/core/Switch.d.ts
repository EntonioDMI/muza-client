/** Settings toggle switch. */
export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible label (Russian). */
  label?: string;
  style?: React.CSSProperties;
}
