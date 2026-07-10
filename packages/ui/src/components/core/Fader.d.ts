/** Vertical fader — equalizer bands, future mixer panels. Zero sits mid-track. */
export interface FaderProps {
  /** Current value in min..max (default −12..+12 dB). */
  value?: number;
  min?: number;
  max?: number;
  onChange?: (value: number) => void;
  ariaLabel?: string;
  /** Track height, px. Default 140. */
  height?: number;
  disabled?: boolean;
  style?: React.CSSProperties;
}
