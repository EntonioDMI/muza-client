/** Modal dialog on frosted scrim. Exhaust inline alternatives first. */
export interface DialogProps {
  open: boolean;
  /** Sentence-case title: «Новый плейлист». */
  title?: string;
  children?: React.ReactNode;
  /** Right-aligned buttons; primary rightmost. */
  actions?: React.ReactNode;
  /** Scrim click + Escape. */
  onClose?: () => void;
  /** Panel width, px. Default 440. */
  width?: number;
}
