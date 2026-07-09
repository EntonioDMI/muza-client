/**
 * Synced lyrics view — Muza's signature. Inactive lines DIM, never blur.
 * @startingPoint section="Media" subtitle="Синхронный текст: панель и караоке" viewport="700x400"
 */
export interface LyricsProps {
  /** Ordered lines; empty text renders an instrumental "•••". */
  lines: Array<{ time?: number; text: string }>;
  /** Index of the line being sung. */
  activeIndex?: number;
  /** "panel" (right sidebar, accent active line) | "karaoke" (fullscreen, white active line). */
  mode?: "panel" | "karaoke";
  /** Click a line to seek. */
  onSeek?: (index: number) => void;
  style?: React.CSSProperties;
}
