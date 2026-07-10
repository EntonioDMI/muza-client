/** Единый трек очереди воспроизведения (Stage 3): демо-каталог и серверный
 *  каталог играют в одной очереди. Демо — симуляция таймером (аудио-файлов
 *  нет), каталог — реальный движок добычи. */

import type { Track as CatalogTrack } from "@muza/api-client";
import { COVERS, type DemoTrack } from "../data/demo";

export interface PlayerTrack {
  id: string;
  /** demo — симуляция; catalog — серверный трек (движок добычи);
   *  local — файл устройства без серверного трека (аноним, Stage 4). */
  kind: "demo" | "catalog" | "local";
  title: string;
  artist: string;
  album: string;
  /** Секунды (для каталога — durationSec сервера). */
  duration: number;
  cover: string;
  explicit: boolean;
  /** Integrated loudness (LUFS) для нормализации; null — не измерена. */
  loudness: number | null;
  /** sha256 локального файла (Stage 4); null — стриминговый трек. */
  localHash?: string | null;
}

/** Обложка-заглушка каталожного трека без coverUrl. */
const FALLBACK_COVER = COVERS[7];

export function fromDemo(t: DemoTrack): PlayerTrack {
  return {
    id: t.id,
    kind: "demo",
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    cover: t.cover,
    explicit: t.explicit,
    loudness: null,
  };
}

export function fromCatalog(t: CatalogTrack): PlayerTrack {
  return {
    id: t.id,
    kind: "catalog",
    title: t.title,
    artist: t.artist,
    album: "",
    duration: t.durationSec,
    cover: t.coverUrl ?? FALLBACK_COVER,
    explicit: false,
    loudness: t.loudness,
    localHash: t.localHash,
  };
}

/** Локальный файл: с серверным id — обычный каталожный трек (скроббл/лайки),
 *  просто источник local; без него (аноним) — kind=local, играет только с диска. */
export function fromLocalEntry(
  e: { hash: string; artist: string; title: string; duration_sec: number },
  serverId?: string | null,
): PlayerTrack {
  return {
    id: serverId ?? `local:${e.hash}`,
    kind: serverId ? "catalog" : "local",
    title: e.title,
    artist: e.artist,
    album: "",
    duration: e.duration_sec,
    cover: FALLBACK_COVER,
    explicit: false,
    loudness: null,
    localHash: e.hash,
  };
}
