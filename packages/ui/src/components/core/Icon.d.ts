/** Thin inline Lucide icon rendered from the CDN-loaded lucide UMD global. */
export interface IconProps {
  /** Lucide icon name, kebab-case (e.g. "play", "skip-forward", "mic-vocal") */
  name: string;
  /** Square size in px. Default 20; transport controls use 22–24. */
  size?: number;
  /** Stroke width. Default 1.75 — Muza's thin inline style. */
  strokeWidth?: number;
  /** Stroke color. Default "currentColor". */
  color?: string;
  /** Fill the glyph too (only for play/pause inside accent pills). */
  filled?: boolean;
  style?: React.CSSProperties;
}
