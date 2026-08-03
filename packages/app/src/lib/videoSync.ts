/** Слейв <video> к аудио (2026-07-21, «Сейчас играет»): аудио — МАСТЕР часов,
 *  видео догоняет. Точных часов у слоя UI нет — pos приходит из timeupdate
 *  (~4 Гц), поэтому между тиками время ЭКСТРАПОЛИРУЕТСЯ: est = pos + (now −
 *  моменту тика) × speed. rAF-цикл сравнивает video.currentTime с est и при
 *  дрейфе больше допуска жёстко перематывает (без плавной подстройки
 *  playbackRate — для фонового видео в узкой панели рывок раз в минуты
 *  незаметнее, чем вечно «плывущая» скорость).
 *
 *  Кроссфейд аудио видео сознательно не зеркалит: на смене трека url меняется,
 *  <video> просто перезагружается — это визуальный сахар, не вторая дорожка.
 *
 *  ⚠️ ЦЕНА КАДРОВ (жалоба владельца 02.08: плеер роняет ФПС в играх). Дорого
 *  здесь не сравнение времён, а ДЕКОДИРОВАНИЕ видео — оно идёт, пока элемент
 *  не на паузе, даже если кадр никто не видит. Отсюда два правила:
 *  1) при document.hidden (окно свёрнуто) кадр ставится на паузу и уезжает с
 *     видеодекодера; вернулись — играем дальше;
 *  2) «панель перекрыта чем-то непрозрачным» отсюда не видно (CSS-видимость у
 *     элемента честная), поэтому решает ХОЗЯИН: App передаёт playing=false,
 *     когда поверх лежит караоке-оверлей.
 *  Сам rAF-цикл догона тоже гейтится по playing: на паузе часы аудио стоят,
 *  гнаться не за чем — хватает одного выравнивания.
 *
 *  Э7 веб-паритета: переехал из apps/desktop/src/player/useVideoSync.ts (там
 *  пенёк-ре-экспорт и прежние тесты). Ничего платформенного внутри нет —
 *  только React и <video>, поэтому в вебе хук работает как есть; видео-URL в
 *  вебе пока не откуда взять, и панель просто передаёт url=null (хук спит). */
import { useCallback, useEffect, useRef, type RefObject } from "react";

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
    // Свёрнутое окно — тот же «не играем»: декодер видео стоит денег даже
    // когда кадр физически некому показать. Возврат окна поднимает кадр
    // обратно (позиция при этом свежая: аудио тикало и в фоне).
    const hidden = typeof document !== "undefined" && document.hidden;
    if (playing && !hidden) {
      // Пока стояла пауза, тиков pos не было, поэтому atMs остался в прошлом, а
      // экстраполяция ниже считает от него как от «только что». Без этой строки
      // видео при возобновлении прыгало вперёд ровно на длительность паузы и
      // уходило в подгрузку — правильное значение возвращалось только со
      // следующим тиком аудио. Сдвигаем момент отсчёта, значение позиции при
      // этом то же самое, что и было.
      posRef.current = { pos: posRef.current.pos, atMs: performance.now() };
      // отказ play (URL протух и т.п.) глотаем: onError элемента поднимет
      // refresh, а до тех пор кадр просто стоит
      el.play().catch(() => undefined);
    } else {
      el.pause();
    }
    const onVisibility = () => {
      if (document.hidden) el.pause();
      else if (playingRef.current) el.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [videoRef, url, playing]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    el.playbackRate = speed;
  }, [videoRef, url, speed]);

  /** Одно сравнение «где видео» против «где аудио» с жёсткой перемоткой. */
  const align = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const { pos: base, atMs } = posRef.current;
    const est = playingRef.current
      ? base + ((performance.now() - atMs) / 1000) * speedRef.current
      : base;
    // readyState 0 — src ещё не открылся, currentTime трогать рано
    if (el.readyState > 0 && Math.abs(el.currentTime - est) > DRIFT_TOL_SEC) {
      el.currentTime = Math.max(0, est);
    }
  }, [videoRef]);

  // Догон — 60 раз в секунду, но ТОЛЬКО пока идёт звук: на паузе часы аудио
  // стоят, est не растёт, и весь цикл сравнивал одно и то же число с самим
  // собой до конца сессии (02.08). Пауза здесь приезжает и от хозяина: App
  // передаёт playing=false, когда панель накрыта караоке-оверлеем.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url || !playing) return;
    let raf = 0;
    const step = () => {
      align();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, url, playing, align]);

  // На паузе двигать позицию может только сик, а он приезжает НОВЫМ pos —
  // то есть перезапуском этого эффекта. Разового выравнивания хватает,
  // кадры для этого не нужны.
  useEffect(() => {
    if (!videoRef.current || !url || playing) return;
    align();
  }, [videoRef, url, playing, pos, align]);
}
