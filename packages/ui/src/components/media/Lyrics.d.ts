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
  /** Click a line to seek — у ВСЕХ строк, включая аннотированные. */
  onSeek?: (index: number) => void;
  /** Объяснение смысла (Genius): ДВОЙНОЙ клик по строке с note (одиночный —
   *  перемотка, как у всех). Без onSeek (plain-текст) — одиночным кликом. */
  onExplain?: (index: number) => void;
  /** false — не следовать за активной строкой (весь текст, свободный скролл). */
  autoScroll?: boolean;
  /** Декоративная нотка в самом низу текста (prefs.lyricsEndNote). */
  endNote?: boolean;
  style?: React.CSSProperties;
}
