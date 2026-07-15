/** Интеграция с Media Session API (Stage 3, слайс 6): метаданные и кнопки в
 *  системном медиа-оверлее Windows (SMTC) + медиаклавиши клавиатуры.
 *  WebView2 — хромиум: mediaSession прокидывается в SMTC сам. */

import { useEffect } from "react";
import type { PlayerTrack } from "./types";

interface MediaSessionControls {
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  pause: () => void;
}

export function useMediaSession(
  track: PlayerTrack | null,
  playing: boolean,
  pos: number,
  controls: MediaSessionControls,
  enabled = true,
) {
  // Метаданные трека (название/артист/обложка в оверлее)
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    // Ничего не играет — снимаем метаданные, иначе системный оверлей Windows
    // держал бы последний трек как «текущий»
    if (!enabled || !track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.cover ? [{ src: track.cover, sizes: "512x512" }] : [],
    });
  }, [track, enabled]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !enabled) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing, enabled]);

  // Позиция в оверлее (целые секунды, чтобы не дёргать API 4 раза в секунду)
  const wholePos = Math.floor(pos);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!enabled || !track || track.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: track.duration,
        position: Math.min(wholePos, track.duration),
        playbackRate: 1,
      });
    } catch {
      /* некорректные значения на границах треков — не критично */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wholePos, track?.duration, enabled]);

  // Обработчики: медиаклавиши и кнопки оверлея (выключено — сняты)
  useEffect(() => {
    if (!("mediaSession" in navigator) || !enabled) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => controls.toggle());
    ms.setActionHandler("pause", () => controls.pause());
    ms.setActionHandler("previoustrack", () => controls.prev());
    ms.setActionHandler("nexttrack", () => controls.next());
    ms.setActionHandler("seekto", (d) => {
      if (typeof d.seekTime === "number") controls.seek(d.seekTime);
    });
    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("seekto", null);
    };
    // controls — свежие замыкания каждого рендера; перевесить хендлеры дёшево
  }, [controls, enabled]);
}
