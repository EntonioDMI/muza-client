/** Quiet confirmation pill («Добавлено в очередь»). One at a time. */
export interface ToastProps {
  /** Visible state — parent owns the timer (~2.5s). */
  open: boolean;
  message?: string;
  /** Optional leading Lucide icon (accent-colored). */
  icon?: string;
  /** Optional action button (undo etc.) — makes the pill interactive. */
  actionLabel?: string;
  onAction?: () => void;
  /** Position it yourself (absolute, above the player bar). */
  style?: React.CSSProperties;
}
