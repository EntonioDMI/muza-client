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
  /** This row is the current track (accent title). */
  active?: boolean;
  /** Playback running (equalizer glyph instead of index). */
  playing?: boolean;
  liked?: boolean;
  /** Quiet "E" mark — lyrics themselves are never censored. */
  explicit?: boolean;
  onPlay?: () => void;
  onLike?: () => void;
  /** Shows an ellipsis button on hover — open a <Menu /> from it. */
  onMore?: (e: React.MouseEvent) => void;
}
