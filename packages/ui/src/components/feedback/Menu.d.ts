/** Context / dropdown menu anchored at a point (track actions, sort options). */
export interface MenuProps {
  open: boolean;
  /** Anchor coordinates within the window. */
  x?: number;
  y?: number;
  /** "-" renders a spacer group break. */
  items?: Array<{ icon?: string; label: string; onClick?: () => void; danger?: boolean } | "-">;
  /** Outside click + Escape. */
  onClose?: () => void;
}
