/** Слейв <video> к аудио (2026-07-21, «Сейчас играет»): аудио — МАСТЕР часов,
 *  видео догоняет. Точных часов у слоя UI нет — pos приходит из timeupdate
 *  (~4 Гц), поэтому между тиками время ЭКСТРАПОЛИРУЕТСЯ: est = pos + (now −
 *  моменту тика) × speed. rAF-цикл сравнивает video.currentTime с est и при
 *  дрейфе больше допуска жёстко перематывает (без плавной подстройки
 *  playbackRate — для фонового видео в узкой панели рывок раз в минуты
 *  незаметнее, чем вечно «плывущая» скорость).
 *
 *  Кроссфейд аудио видео сознательно не зеркалит: на смене трека url меняется,
 *  <video> просто перезагружается — это визуальный сахар, не вторая дорожка. */
import { useEffect, useRef, type RefObject } from "react";

/** Допуск дрейфа, сек: меньше — дёргаем перемотку слишком часто (сеть!),
 *  больше — заметно на губах в кадре. 0.35с с экстраполяцией достаточно. */
const DRIFT_TOL_SEC = 0.35;

export function useVideoSync(
  videoRef: RefObject<HTMLVideoElement | null>,
  opts: { url: string | null; pos: number; playing: boolean; speed: number },
): void {
  const { url, pos, playing, speed } = opts;
  // тик pos + момент его прихода: база экстраполяции для rAF ниже.
  // Обновляется ТОЛЬКО на смене значения (мутация в рендере, приём ctxRef):
  // рендер без тика pos не должен сдвигать базу — est занижался бы на
  // возраст устаревшего pos
  const posRef = useRef({ pos: 0, atMs: 0 });
  if (posRef.current.pos !== pos) posRef.current = { pos, atMs: performance.now() };
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // play/pause зеркалится событием, не rAF (пауза должна быть мгновенной)
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    if (playing) {
      // отказ play (URL протух и т.п.) глотаем: onError элемента поднимет
      // refresh, а до тех пор кадр просто стоит
      el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [videoRef, url, playing]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    el.playbackRate = speed;
  }, [videoRef, url, speed]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    let raf = 0;
    const step = () => {
      const { pos: base, atMs } = posRef.current;
      const est = playingRef.current
        ? base + ((performance.now() - atMs) / 1000) * speedRef.current
        : base;
      // readyState 0 — src ещё не открылся, currentTime трогать рано
      if (el.readyState > 0 && Math.abs(el.currentTime - est) > DRIFT_TOL_SEC) {
        el.currentTime = Math.max(0, est);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, url]);
}
