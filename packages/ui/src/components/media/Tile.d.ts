/**
 * Media tile: album / playlist / artist card for shelves and grids.
 * @startingPoint section="Media" subtitle="Плитка альбома/плейлиста с play-пилюлей" viewport="700x280"
 */
export interface TileProps {
  /** Cover image URL. Нет/null — Cover нарисует плейсхолдер. */
  cover?: string | null;
  title: string;
  /** Artist / meta line. */
  subtitle?: string;
  /** Tile width in px (or "auto" to fill a grid cell). Default 176. */
  width?: number | string;
  /** Currently playing — keeps the play pill visible. */
  playing?: boolean;
  /** Плитка в множественном выделении: --surface-4 + галочка в ЛЕВОМ верхнем
   *  углу обложки (правый низ занят play-пилюлей). */
  selected?: boolean;
  /** Play-pill click. */
  onPlay?: () => void;
  /** Whole-tile click (open page). */
  onClick?: () => void;
  /** ПКМ по плитке — открой из него <Menu /> (как onMore у TrackRow); preventDefault внутри. */
  onMenu?: (e: React.MouseEvent) => void;
  /** Play-pill aria label. Default "Play" (app passes a localized value). */
  playLabel?: string;
  /** Pause-pill aria label. Default "Pause". */
  pauseLabel?: string;
}
