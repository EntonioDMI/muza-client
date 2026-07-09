/**
 * Media tile: album / playlist / artist card for shelves and grids.
 * @startingPoint section="Media" subtitle="Плитка альбома/плейлиста с play-пилюлей" viewport="700x280"
 */
export interface TileProps {
  /** Cover image URL (square). */
  cover: string;
  title: string;
  /** Artist / meta line. */
  subtitle?: string;
  /** Tile width in px (or "auto" to fill a grid cell). Default 176. */
  width?: number | string;
  /** Currently playing — keeps the play pill visible. */
  playing?: boolean;
  /** Play-pill click. */
  onPlay?: () => void;
  /** Whole-tile click (open page). */
  onClick?: () => void;
}
