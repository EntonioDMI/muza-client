/**
 * Synced lyrics view — Muza's signature. Inactive lines DIM, never blur.
 * @startingPoint section="Media" subtitle="Синхронный текст: панель и караоке" viewport="700x400"
 */
export interface LyricsProps {
  /** Ordered lines; empty text renders an instrumental "•••". note = объяснение смысла (Genius). */
  lines: Array<{ time?: number; t?: number; text: string; note?: string }>;
  /** Index of the line being sung. */
  activeIndex?: number;
  /** "panel" (right sidebar, accent active line) | "karaoke" (fullscreen, white active line). */
  mode?: "panel" | "karaoke";
  /** Click a line to seek. */
  onSeek?: (index: number) => void;
  /** Клик по строке с note открывает объяснение (вместо seek). */
  onExplain?: (index: number) => void;
  style?: React.CSSProperties;
}
