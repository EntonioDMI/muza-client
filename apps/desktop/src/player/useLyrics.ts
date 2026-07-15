/** Тексты текущего трека (Stage 3, слайс 4): LRCLIB с сервера (synced →
 *  караоке-строки, plain — без таймкодов, актив не подсвечивается).
 *  Кэш на сессию по id трека. */

import { useEffect, useRef, useState } from "react";
import type { MuzaApi } from "@muza/api-client";
import type { LyricLine, PlayerTrack } from "./types";

export interface TrackLyrics {
  lines: LyricLine[];
  /** id трека, которому принадлежат lines; защищает соседние хуки от гонки при смене трека. */
  trackId: string | null;
  /** true — строки с таймкодами (LRC): активная строка и сик по строке живут. */
  synced: boolean;
  loading: boolean;
}

const EMPTY: TrackLyrics = { lines: [], trackId: null, synced: false, loading: false };

export function useLyrics(api: MuzaApi, track: PlayerTrack | null, canFetch: boolean): TrackLyrics {
  const [state, setState] = useState<TrackLyrics>(EMPTY);
  // Кэш на сессию: переключение треков туда-сюда не дёргает сервер
  const cacheRef = useRef(new Map<string, TrackLyrics>());

  useEffect(() => {
    // Ничего не играет (пустая очередь) или нет серверной сессии — текстов нет
    if (!track || !canFetch) {
      setState(EMPTY);
      return;
    }
    // id в локальную константу: замыкания .then() ниже переживают смену трека,
    // а сужение типа параметра внутрь них не протекает
    const trackId = track.id;
    const cached = cacheRef.current.get(trackId);
    if (cached) {
      setState(cached);
      return;
    }
    let alive = true;
    setState({ lines: [], trackId: null, synced: false, loading: true });
    api
      .getLyrics(trackId)
      .then((lyrics) => {
        let out: TrackLyrics;
        if (lyrics.synced && lyrics.synced.length > 0) {
          out = { lines: lyrics.synced.map((l) => ({ t: l.t, text: l.line })), trackId, synced: true, loading: false };
        } else if (lyrics.plain) {
          out = {
            lines: lyrics.plain.split("\n").map((text) => ({ t: 0, text })),
            trackId,
            synced: false,
            loading: false,
          };
        } else {
          out = EMPTY;
        }
        cacheRef.current.set(trackId, out);
        if (alive) setState(out);
      })
      .catch(() => {
        // не кэшируем сбой: следующий заход попробует снова
        if (alive) setState(EMPTY);
      });
    return () => {
      alive = false;
    };
  }, [api, track?.id, canFetch]);

  return state;
}
