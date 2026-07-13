/** Color swatch — circle of the current color, eyedropper glyph on hover.
 *  Click opens the DS popover picker (SV square + hue slider + hex field)
 *  instead of the native OS color dialog. Selection ring via outline
 *  (DS has no shadows). Contract unchanged from the native-input version. */
export interface ColorPickerProps {
  /** Hex color, e.g. "#3b82f6". */
  value?: string;
  onChange?: (hex: string) => void;
  /** Accessible label + tooltip (Russian), e.g. "Свой акцент". */
  label?: string;
  /** Show the selection ring (this swatch is the active choice). */
  selected?: boolean;
  /** Circle diameter, px. Default 36. */
  size?: number;
  /** Render the hex value next to the swatch. */
  showValue?: boolean;
  style?: React.CSSProperties;
}
