/** Track list row: queue, playlist and search results. No divider lines. */
export interface TrackRowProps {
  /** Position number shown at rest. */
  index?: number;
  /** Optional 42px cover URL. */
  cover?: string;
  title: string;
  artist: string;
  /** "3:47" */
  duration?: string;
  /** false — скрыть колонку длительности (настройка «Строка трека»). */
  showDuration?: boolean;
  /** Compact source-provider badge (e.g. "SoundCloud"); omit to hide. */
  source?: string;
  /** This row is the current track (accent title). */
  active?: boolean;
  /** Playback running (equalizer glyph instead of index). */
  playing?: boolean;
  liked?: boolean;
  /** Quiet "E" mark — lyrics themselves are never censored. */
  explicit?: boolean;
  onPlay?: () => void;
  /** Двойной клик по строке (не по кнопке play); не задан — dblclick = onPlay. */
  onRowDoubleClick?: () => void;
  onLike?: () => void;
  /** Shows an ellipsis button on hover — open a <Menu /> from it. */
  onMore?: (e: React.MouseEvent) => void;
  /** Play button aria label. Default "Play" (app passes a localized value). */
  playLabel?: string;
  /** Pause button aria label. Default "Pause". */
  pauseLabel?: string;
  /** Like button aria label. Default "Like". */
  likeLabel?: string;
  /** More (ellipsis) button aria label. Default "More". */
  moreLabel?: string;
}
