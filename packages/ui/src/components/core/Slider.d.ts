/** Progress / volume slider — thin pill, accent fill, thumb appears on hover. */
export interface SliderProps {
  /** Current value, 0..max. */
  value?: number;
  /** Default 100. Track progress uses seconds. */
  max?: number;
  onChange?: (value: number) => void;
  /** Accessible label (Russian), e.g. "Громкость". */
  ariaLabel?: string;
  /** Human value for screen readers (aria-valuetext), e.g. "1:24 из 3:45". */
  valueText?: string;
  style?: React.CSSProperties;
}
