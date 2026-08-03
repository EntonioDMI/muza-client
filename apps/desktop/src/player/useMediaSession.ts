/** Интеграция с Media Session API (Stage 3, слайс 6): метаданные и кнопки в
 *  системном медиа-оверлее Windows (SMTC) + медиаклавиши клавиатуры.
 *  WebView2 — хромиум: mediaSession прокидывается в SMTC сам. */

import { useEffect, useRef } from "react";
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
  /** Скорость воспроизведения. Оверлей Windows сам двигает полоску между
   *  нашими обновлениями позиции и считает её по этому числу: с зашитой
   *  единицей на 1.5x и 2x полоска отставала и дёргалась рывками назад при
   *  каждом нашем тике. */
  speed = 1,
) {
  // Метаданные трека (название/артист/обложка в оверлее).
  //
  // Зависимости — ПОЛЯ трека, а не ссылка на объект (аудит 2026-08-03).
  // Приходящий сюда track пересобирается на КАЖДЫЙ тик позиции (App.tsx
  // подмешивает чищенную обложку в новый объект, а usePlayback держит pos в
  // зависимостях своего useMemo) — по ссылке эффект «менялся» ~4 раза в
  // секунду и столько же раз строил MediaMetadata с обложкой. Обложка
  // каталожного трека — data-URL на сотни килобайт (canvas-кроп useCoverArt),
  // и тикает это даже при свёрнутом окне: timeupdate не троттлится.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, track?.title, track?.artist, track?.album, track?.cover, enabled]);

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
        playbackRate: speed,
      });
    } catch {
      /* некорректные значения на границах треков — не критично */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wholePos, track?.duration, enabled, speed]);

  // Обработчики: медиаклавиши и кнопки оверлея (выключено — сняты).
  //
  // controls — объектный литерал из рендера App: по ссылке он нов КАЖДЫЙ
  // рендер, а рендер идёт ~4 раза в секунду по тику позиции. Прежний комментарий
  // «перевесить хендлеры дёшево» неверен: это 5 снятий + 5 установок, то есть
  // ~40 обращений к системному сервису в секунду ни за чем (аудит 2026-08-03).
  // Свежесть замыканий держит ref — тот же приём, что у miniRef в App.tsx.
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  useEffect(() => {
    if (!("mediaSession" in navigator) || !enabled) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => controlsRef.current.toggle());
    ms.setActionHandler("pause", () => controlsRef.current.pause());
    ms.setActionHandler("previoustrack", () => controlsRef.current.prev());
    ms.setActionHandler("nexttrack", () => controlsRef.current.next());
    ms.setActionHandler("seekto", (d) => {
      if (typeof d.seekTime === "number") controlsRef.current.seek(d.seekTime);
    });
    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("seekto", null);
    };
  }, [enabled]);
}
