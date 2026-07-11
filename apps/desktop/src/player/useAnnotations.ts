/** Genius-аннотации текущего трека (Stage 5, «режим смысла»): карта
 *  «индекс synced-строки → аннотация». Сервер уже привязал фрагменты к
 *  LRC-строкам (line_idxs, Stage 2 слайс 5) — здесь только доставка и кэш
 *  на сессию. Демо-треки не трогаем: их note живут в demo-каталоге. */

import { useEffect, useRef, useState } from "react";
import type { Annotation, MuzaApi } from "@muza/api-client";
import type { PlayerTrack } from "./types";
import { buildAnnotationNotes } from "./annotations";

export interface TrackNotes {
  /** Индекс строки synced-текста → аннотация (первая, если строк несколько). */
  notes: Map<number, Annotation>;
  geniusUrl: string | null;
}

const EMPTY: TrackNotes = { notes: new Map(), geniusUrl: null };

export function useAnnotations(api: MuzaApi, track: PlayerTrack, canFetch: boolean): TrackNotes {
  const [state, setState] = useState<TrackNotes>(EMPTY);
  const cacheRef = useRef(new Map<string, TrackNotes>());

  useEffect(() => {
    if (track.kind !== "catalog" || !canFetch) {
      setState(EMPTY);
      return;
    }
    const cached = cacheRef.current.get(track.id);
    if (cached) {
      setState(cached);
      return;
    }
    let alive = true;
    setState(EMPTY);
    api
      .getAnnotations(track.id)
      .then(({ geniusUrl, annotations }) => {
        const notes = buildAnnotationNotes(annotations);
        const out: TrackNotes = { notes, geniusUrl };
        cacheRef.current.set(track.id, out);
        if (alive) setState(out);
      })
      .catch(() => {
        // сбой не кэшируем: следующий заход попробует снова
        if (alive) setState(EMPTY);
      });
    return () => {
      alive = false;
    };
  }, [api, track.id, track.kind, canFetch]);

  return state;
}
