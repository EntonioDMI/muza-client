/** Quiet confirmation pill («Добавлено в очередь»). One at a time. */
export interface ToastProps {
  /** Visible state — parent owns the timer (~2.5s). */
  open: boolean;
  message?: string;
  /** Optional leading Lucide icon (accent-colored). */
  icon?: string;
  /** Position it yourself (absolute, above the player bar). */
  style?: React.CSSProperties;
}
