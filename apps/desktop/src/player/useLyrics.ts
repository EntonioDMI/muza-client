/** Тексты текущего трека (Stage 3, слайс 4): демо — локальные строки,
 *  каталог — LRCLIB с сервера (synced → караоке-строки, plain — без
 *  таймкодов, актив не подсвечивается). Кэш на сессию по id трека. */

import { useEffect, useRef, useState } from "react";
import type { MuzaApi } from "@muza/api-client";
import { TRACKS, type LyricLine } from "../data/demo";
import type { PlayerTrack } from "./types";

export interface TrackLyrics {
  lines: LyricLine[];
  /** id трека, которому принадлежат lines; защищает соседние хуки от гонки при смене трека. */
  trackId: string | null;
  /** true — строки с таймкодами (LRC): активная строка и сик по строке живут. */
  synced: boolean;
  loading: boolean;
}

const EMPTY: TrackLyrics = { lines: [], trackId: null, synced: false, loading: false };

export function useLyrics(api: MuzaApi, track: PlayerTrack, canFetch: boolean): TrackLyrics {
  const [state, setState] = useState<TrackLyrics>(EMPTY);
  // Кэш на сессию: переключение треков туда-сюда не дёргает сервер
  const cacheRef = useRef(new Map<string, TrackLyrics>());

  useEffect(() => {
    if (track.kind === "demo") {
      const lines = TRACKS.find((t) => t.id === track.id)?.lyrics ?? [];
      setState({ lines, trackId: track.id, synced: true, loading: false });
      return;
    }
    if (!canFetch) {
      setState(EMPTY);
      return;
    }
    const cached = cacheRef.current.get(track.id);
    if (cached) {
      setState(cached);
      return;
    }
    let alive = true;
    setState({ lines: [], trackId: null, synced: false, loading: true });
    api
      .getLyrics(track.id)
      .then((lyrics) => {
        let out: TrackLyrics;
        if (lyrics.synced && lyrics.synced.length > 0) {
          out = { lines: lyrics.synced.map((l) => ({ t: l.t, text: l.line })), trackId: track.id, synced: true, loading: false };
        } else if (lyrics.plain) {
          out = {
            lines: lyrics.plain.split("\n").map((text) => ({ t: 0, text })),
            trackId: track.id,
            synced: false,
            loading: false,
          };
        } else {
          out = EMPTY;
        }
        cacheRef.current.set(track.id, out);
        if (alive) setState(out);
      })
      .catch(() => {
        // не кэшируем сбой: следующий заход попробует снова
        if (alive) setState(EMPTY);
      });
    return () => {
      alive = false;
    };
  }, [api, track.id, track.kind, canFetch]);

  return state;
}
