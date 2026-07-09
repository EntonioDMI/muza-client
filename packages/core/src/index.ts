/**
 * @muza/core — доменная логика плеера: треки, очередь, воспроизведение.
 * Пока каркас (Stage 1). Движок добычи и плеер появятся в Stage 3.
 */

/** Источник аудио. Трек = ссылка на источник, не файл (см. docs/architecture.md). */
export type SourceKind = "youtube" | "soundcloud" | "bandcamp" | "local";

export interface TrackSource {
  kind: SourceKind;
  /** id внутри источника (например, YouTube video id) или путь для local */
  sourceId: string;
}

export interface Artist {
  id: string;
  name: string;
}

export interface Track {
  id: string;
  title: string;
  artists: Artist[];
  album?: string;
  /** длительность в секундах */
  duration: number;
  coverUrl?: string;
  explicit?: boolean;
  source?: TrackSource;
}

export interface QueueItem {
  track: Track;
  /** уникальный id вхождения в очередь (один трек может быть в очереди дважды) */
  queueId: string;
}

export type PlaybackState = "idle" | "loading" | "playing" | "paused";

export interface PlayerSnapshot {
  state: PlaybackState;
  current?: QueueItem;
  /** позиция в секундах */
  position: number;
  volume: number;
  queue: QueueItem[];
}
