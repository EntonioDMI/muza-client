/** Единый трек очереди воспроизведения (Stage 3): серверный каталог (движок
 *  добычи) и локальные файлы устройства играют в одной очереди. */

import type { Track as CatalogTrack } from "@muza/api-client";

/** Строка текста песни. Живёт здесь, а не в отдельном модуле: тексты — часть
 *  доменной модели плеера, и её тянут и хуки (useLyrics/annotations), и шелл
 *  (NowPlayingPanel/ListeningMode/MeaningDialog). */
export interface LyricLine {
  t: number;
  text: string;
  /** Объяснение смысла строки («режим смысла», Genius-аннотации Stage 5):
   *  строки с note подчёркнуты пунктиром, клик открывает карточку. */
  note?: string;
}

export interface PlayerTrack {
  id: string;
  /** catalog — серверный трек (движок добычи);
   *  local — файл устройства без серверного трека (аноним, Stage 4). */
  kind: "catalog" | "local";
  title: string;
  artist: string;
  album: string;
  /** Секунды (для каталога — durationSec сервера). */
  duration: number;
  /** URL обложки; null — обложки нет. Плейсхолдер рисует ДС (Cover), а не
   *  подставная картинка: фейковый арт на реальном треке — это ложь. */
  cover: string | null;
  explicit: boolean;
  /** Integrated loudness (LUFS) для нормализации; null — не измерена. */
  loudness: number | null;
  /** sha256 локального файла (Stage 4); null — стриминговый трек. */
  localHash?: string | null;
}

export function fromCatalog(t: CatalogTrack): PlayerTrack {
  return {
    id: t.id,
    kind: "catalog",
    title: t.title,
    artist: t.artist,
    album: "",
    duration: t.durationSec,
    cover: t.coverUrl ?? null,
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
    cover: null,
    explicit: false,
    loudness: null,
    localHash: e.hash,
  };
}
