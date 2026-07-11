/** Оркестратор воспроизведения (Stage 3): очередь-контекст (откуда запустили —
 *  то и очередь), реальный движок для каталожных треков (добыча → LRU-кэш →
 *  <audio>), демо-треки — симуляция таймером (у них нет аудио). */

import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { MuzaApi } from "@muza/api-client";
import type { Prefs, RepeatMode } from "../types";
import { engineAvailable, resolvePlayable, type ResolveResult } from "../lib/engine";
import { localResolve } from "../lib/localFiles";
import { AudioEngine } from "./audioEngine";
import type { PlayerTrack } from "./types";

/** Длительность кроссфейда при естественном переходе (prefs.crossfade). */
const CROSSFADE_SEC = 4;
/** За сколько секунд до конца начинать преднагрузку следующего трека. */
const PRELOAD_AHEAD_SEC = 20;

export interface PlayEndInfo {
  track: PlayerTrack;
  playedMs: number;
  completed: boolean;
}

export function usePlayback({
  api,
  initialQueue,
  prefs,
  onError,
  onPlayEnd,
  onQueueEnd,
}: {
  api: MuzaApi;
  initialQueue: PlayerTrack[];
  prefs: Prefs;
  /** Показ ошибок добычи/воспроизведения (тост). */
  onError: (message: string) => void;
  /** Трек отзвучал/переключён — скробблинг (слайс 5). */
  onPlayEnd?: (info: PlayEndInfo) => void;
  /** Очередь кончилась на авто-переходе (Stage 5, бесконечное радио):
   *  вернуть продолжение — треки добавятся в очередь и играем дальше;
   *  null/пусто — честная остановка как раньше. */
  onQueueEnd?: (lastTrack: PlayerTrack) => Promise<PlayerTrack[] | null>;
}) {
  const [queue, setQueue] = useState<PlayerTrack[]>(initialQueue);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [pos, setPos] = useState(24); // как в демо Stage 1 — трек «уже играет»
  const [vol, setVolState] = useState(64);
  const [speed, setSpeed] = useState(1);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);

  const track = queue[index] ?? queue[0] ?? initialQueue[0];

  // refs для колбэков движка/таймеров (без пересоздания и стейл-замыканий)
  const stateRef = useRef({ queue, index, playing, repeat, shuffle, speed, track, pos });
  stateRef.current = { queue, index, playing, repeat, shuffle, speed, track, pos };
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPlayEndRef = useRef(onPlayEnd);
  onPlayEndRef.current = onPlayEnd;
  const onQueueEndRef = useRef(onQueueEnd);
  onQueueEndRef.current = onQueueEnd;

  // Скробблинг: накапливаем реально прослушанное время текущего трека
  const playedMsRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const tickPlayed = (sec: number) => {
    const last = lastTimeRef.current;
    lastTimeRef.current = sec;
    if (last !== null && sec > last && sec - last < 3) {
      playedMsRef.current += (sec - last) * 1000;
    }
  };
  const flushPlayEnd = (finished: boolean) => {
    const t = stateRef.current.track;
    const played = playedMsRef.current;
    playedMsRef.current = 0;
    lastTimeRef.current = null;
    if (!t || played < 1000) return;
    const completed = finished || played >= t.duration * 1000 * 0.9;
    onPlayEndRef.current?.({ track: t, playedMs: Math.round(played), completed });
  };

  // Преднагрузка: id трека, чей файл уже в кэше и в неактивном слоте
  const preloadedRef = useRef<{ id: string; url: string } | null>(null);
  // Отбрасываем результаты устаревших resolve при быстром переключении
  const playSeqRef = useRef(0);
  // Кроссфейд на естественном переходе уже запущен для этого pos
  const autoAdvancedRef = useRef(false);

  const engineRef = useRef<AudioEngine | null>(null);
  const engine = () => {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine({
        onTime: (sec) => {
          const s = stateRef.current;
          if (s.track.kind === "demo") return;
          setPos(sec);
          tickPlayed(sec);
          const remaining = s.track.duration - sec;
          // преднагрузка следующего + ранний кроссфейд
          if (remaining <= PRELOAD_AHEAD_SEC) void preloadNext();
          if (
            prefsRef.current.crossfade &&
            s.repeat !== "one" &&
            remaining <= CROSSFADE_SEC &&
            remaining > 0.5 &&
            !autoAdvancedRef.current &&
            nextIndexFor(1, true) !== null
          ) {
            autoAdvancedRef.current = true;
            void advance(1, true);
          }
        },
        onEnded: () => {
          if (autoAdvancedRef.current) return; // кроссфейд уже увёл дальше
          handleTrackEnd();
        },
        onError: (message) => {
          setBuffering(false);
          onErrorRef.current(message);
        },
      });
    }
    return engineRef.current;
  };

  // Умный шаффл: помним недавно игравшие id и не повторяем их, пока есть выбор
  const recentRef = useRef<string[]>([]);
  const rememberPlayed = (id: string) => {
    recentRef.current = [...recentRef.current.filter((x) => x !== id), id].slice(-32);
  };

  /** Индекс следующего/предыдущего трека по правилам повтора/шаффла;
   *  null — очередь кончилась (repeat off). */
  const nextIndexFor = (d: 1 | -1, auto: boolean): number | null => {
    const s = stateRef.current;
    const n = s.queue.length;
    if (n === 0) return null;
    if (s.shuffle && n > 1) {
      // умный шаффл: сперва кандидаты, которых не было в недавней истории
      const half = Math.min(Math.floor(n / 2), recentRef.current.length);
      const recent = new Set(recentRef.current.slice(-Math.max(half, 1)));
      const fresh: number[] = [];
      const any: number[] = [];
      s.queue.forEach((t, i) => {
        if (i === s.index) return;
        any.push(i);
        if (!recent.has(t.id)) fresh.push(i);
      });
      const pool = fresh.length > 0 ? fresh : any;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const raw = s.index + d;
    if (raw >= n) {
      if (auto && s.repeat === "off") return null;
      return 0;
    }
    if (raw < 0) return n - 1;
    return raw;
  };

  /** Резолв играбельного URL: локальный файл (kind=local или источник
   *  provider=local, Stage 4) → диск; каталожный — движок добычи.
   *  Сервер недоступен → локальный файл или кэш добычи ещё могут спасти. */
  const resolveForTrack = async (t: PlayerTrack): Promise<ResolveResult> => {
    if (t.kind === "local") {
      // анонимный локальный трек: серверных источников нет в принципе
      const path = await localResolve(t.localHash ?? "");
      if (!path) throw new Error("Локальный файл не найден на этом устройстве");
      return { url: convertFileSrc(path), fromCache: true, provider: "local" };
    }
    const sources = await api.getTrackSources(t.id).catch(() => null);
    if (sources === null) {
      if (t.localHash) {
        const path = await localResolve(t.localHash);
        if (path) return { url: convertFileSrc(path), fromCache: true, provider: "local" };
      }
      // оффлайн: кэш добычи отдаёт файл и без сети (пустая лестница = только кэш)
      return resolvePlayable(t.id, []);
    }
    return resolvePlayable(t.id, sources);
  };

  /** Запустить трек очереди по индексу. Кроссфейд — только на авто-переходе. */
  const startAt = async (i: number, opts?: { crossfade?: boolean }) => {
    const s = stateRef.current;
    const t = s.queue[i];
    if (!t) return;
    flushPlayEnd(false);
    const seq = ++playSeqRef.current;
    setIndex(i);
    setPos(0);
    setPlaying(true);
    autoAdvancedRef.current = false;
    rememberPlayed(t.id);

    if (t.kind === "demo") {
      engine().stop();
      preloadedRef.current = null;
      setBuffering(false);
      return; // дальше тикает демо-симуляция
    }

    if (!engineAvailable()) {
      setPlaying(false);
      onErrorRef.current("Каталожные треки играют только в приложении Muza (движок добычи)");
      return;
    }

    try {
      let url: string;
      if (preloadedRef.current?.id === t.id) {
        url = preloadedRef.current.url;
      } else {
        setBuffering(true);
        const resolved = await resolveForTrack(t);
        url = resolved.url;
      }
      if (playSeqRef.current !== seq) return; // уже переключили дальше
      preloadedRef.current = null;
      const norm = AudioEngine.normFactor(t.loudness, prefsRef.current.normalize);
      await engine().play(url, norm, opts?.crossfade ? CROSSFADE_SEC : 0);
    } catch (e) {
      if (playSeqRef.current !== seq) return;
      setPlaying(false);
      onErrorRef.current(e instanceof Error ? e.message : "Не удалось добыть трек");
    } finally {
      if (playSeqRef.current === seq) setBuffering(false);
    }
  };

  /** Преднагрузка следующего каталожного трека (кэш добычи + слот движка). */
  const preloadingRef = useRef(false);
  const preloadNext = async () => {
    const s = stateRef.current;
    if (preloadingRef.current || s.shuffle) return;
    const ni = nextIndexFor(1, true);
    if (ni === null) return;
    const nt = s.queue[ni];
    if (!nt || nt.kind === "demo" || preloadedRef.current?.id === nt.id) return;
    if (!engineAvailable()) return;
    preloadingRef.current = true;
    try {
      const resolved = await resolveForTrack(nt);
      preloadedRef.current = { id: nt.id, url: resolved.url };
      engine().preload(resolved.url);
    } catch {
      /* преднагрузка — best-effort */
    } finally {
      preloadingRef.current = false;
    }
  };

  const advance = async (d: 1 | -1, auto: boolean) => {
    const s = stateRef.current;
    if (auto && s.repeat === "one") {
      // повтор трека: с начала, без кроссфейда
      if (s.track.kind !== "demo") engine().seek(0);
      setPos(0);
      return;
    }
    const ni = nextIndexFor(d, auto);
    if (ni === null) {
      // конец очереди без повтора: сперва даём шанс бесконечному радио
      if (auto && onQueueEndRef.current) {
        const more = await onQueueEndRef.current(s.track).catch(() => null);
        if (more && more.length > 0) {
          const nextQueue = [...s.queue, ...more];
          setQueue(nextQueue);
          stateRef.current = { ...stateRef.current, queue: nextQueue };
          await startAt(s.queue.length, { crossfade: false });
          return;
        }
      }
      flushPlayEnd(true);
      setPlaying(false);
      setPos(s.track.duration);
      return;
    }
    await startAt(ni, { crossfade: auto && prefsRef.current.crossfade });
  };

  const handleTrackEnd = () => {
    flushPlayEnd(true);
    void advance(1, true);
  };

  // Демо-симуляция: тикаем секундой, как в Stage 1 (реального аудио нет).
  // Конец трека — вне state-updater (StrictMode дёргает updater дважды).
  useEffect(() => {
    if (track.kind !== "demo" || !playing) return;
    const iv = setInterval(() => {
      const s = stateRef.current;
      const p = s.pos + 1;
      tickPlayed(p);
      if (p <= s.track.duration) {
        setPos(p);
      } else {
        handleTrackEnd();
      }
    }, 1000 / speed);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, playing, speed]);

  // ── Публичное API ─────────────────────────────────────────────────

  /** Клик по треку в списке: тот же id — пауза/плей, иначе — играть; если
   *  передан context — он становится очередью (play-context как в больших плеерах). */
  const playContext = (tracks: PlayerTrack[], id: string) => {
    const s = stateRef.current;
    const sameQueue =
      tracks.length === s.queue.length && tracks.every((t, i) => t.id === s.queue[i]?.id);
    if (sameQueue && id === s.track.id) {
      toggle();
      return;
    }
    if (!sameQueue) {
      setQueue(tracks);
      preloadedRef.current = null;
    }
    const i = Math.max(0, tracks.findIndex((t) => t.id === id));
    // очередь в стейте обновится этим же рендером; startAt читает из ref —
    // подложим свежую очередь туда сразу
    stateRef.current = { ...stateRef.current, queue: tracks };
    void startAt(i);
  };

  const toggle = () => {
    const s = stateRef.current;
    if (s.track.kind !== "demo") {
      if (s.playing) engine().pause();
      else void engine().resume();
    }
    setPlaying(!s.playing);
  };

  const next = () => void advance(1, false);
  const prev = () => void advance(-1, false);

  /** Явная пауза (sleep-таймер и т.п.) — с остановкой движка. */
  const pause = () => {
    if (stateRef.current.track.kind !== "demo") engine().pause();
    setPlaying(false);
  };

  const seek = (sec: number) => {
    const s = stateRef.current;
    const clamped = Math.max(0, Math.min(sec, s.track.duration));
    setPos(clamped);
    if (s.track.kind !== "demo") engine().seek(clamped);
    autoAdvancedRef.current = false;
  };

  const setVol = (v: number) => {
    setVolState(v);
    engineRef.current?.setVolume(v);
  };

  const cycleSpeed = (): number => {
    // шаги настраиваются владельцем (Prefs); текущего нет в списке → берём первый
    const steps = prefsRef.current.speedSteps.length > 0 ? prefsRef.current.speedSteps : [1];
    const i = steps.indexOf(stateRef.current.speed);
    const nextSpeed = steps[(i + 1) % steps.length];
    setSpeed(nextSpeed);
    engineRef.current?.setSpeed(nextSpeed);
    return nextSpeed; // вызывающий показывает тост с новым значением
  };

  const cycleRepeat = (): RepeatMode => {
    const next: RepeatMode = stateRef.current.repeat === "off" ? "all" : stateRef.current.repeat === "all" ? "one" : "off";
    setRepeat(next);
    return next;
  };
  const toggleShuffle = () => setShuffle((s) => !s);

  /** Анализатор движка для визуализатора (Stage 6); null у демо/plain. */
  const getAnalyser = () => engineRef.current?.analyser() ?? null;

  // ── Операции над очередью (UX-доводка 2026-07-11) ─────────────────
  // Все правки идут через stateRef тем же приёмом, что playContext:
  // стейт обновится этим же рендером, колбэки читают свежую очередь.

  const patchQueue = (nextQueue: PlayerTrack[], nextIndex: number) => {
    setQueue(nextQueue);
    setIndex(nextIndex);
    stateRef.current = { ...stateRef.current, queue: nextQueue, index: nextIndex };
    preloadedRef.current = null; // сосед мог смениться — прогретый слот неактуален
  };

  /** Убрать трек из очереди. Возвращает данные для undo (insertInQueue).
   *  Удалили играющий — стартует вставший на его место (или честный стоп). */
  const removeFromQueue = (id: string): { track: PlayerTrack; index: number } | null => {
    const s = stateRef.current;
    const i = s.queue.findIndex((t) => t.id === id);
    if (i === -1) return null;
    const removed = s.queue[i];
    const nextQueue = s.queue.filter((_, j) => j !== i);
    if (i === s.index) {
      patchQueue(nextQueue, Math.min(i, Math.max(nextQueue.length - 1, 0)));
      if (nextQueue.length === 0) {
        engine().stop();
        setPlaying(false);
        setPos(0);
      } else {
        void startAt(Math.min(i, nextQueue.length - 1));
      }
    } else {
      patchQueue(nextQueue, i < s.index ? s.index - 1 : s.index);
    }
    return { track: removed, index: i };
  };

  /** Вернуть трек на позицию (undo удаления). */
  const insertInQueue = (track: PlayerTrack, at: number) => {
    const s = stateRef.current;
    const i = Math.max(0, Math.min(at, s.queue.length));
    const nextQueue = [...s.queue.slice(0, i), track, ...s.queue.slice(i)];
    patchQueue(nextQueue, i <= s.index && s.queue.length > 0 ? s.index + 1 : s.index);
  };

  /** Переставить трек на шаг вверх/вниз (клавиатурная альтернатива DnD). */
  const moveInQueue = (id: string, dir: 1 | -1) => {
    const s = stateRef.current;
    const i = s.queue.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= s.queue.length) return;
    const nextQueue = [...s.queue];
    [nextQueue[i], nextQueue[j]] = [nextQueue[j], nextQueue[i]];
    const idx = i === s.index ? j : j === s.index ? i : s.index;
    patchQueue(nextQueue, idx);
  };

  /** Очистить хвост «Далее» (всё после текущего трека). */
  const clearUpNext = () => {
    const s = stateRef.current;
    patchQueue(s.queue.slice(0, s.index + 1), s.index);
  };

  // EQ и нормализация из Prefs — на движок
  useEffect(() => {
    engineRef.current?.setEq(prefs.eqOn, prefs.eqBands);
  }, [prefs.eqOn, prefs.eqBands]);

  // Смена спикеров/выхода не наша забота; при размонтировании — тишина
  useEffect(() => () => engineRef.current?.stop(), []);

  return useMemo(
    () => ({
      queue,
      track,
      index,
      playing,
      buffering,
      pos,
      vol,
      speed,
      repeat,
      shuffle,
      playContext,
      toggle,
      next,
      prev,
      pause, // для sleep-таймера и mediaSession (слайс 6)
      seek,
      setVol,
      cycleSpeed,
      cycleRepeat,
      toggleShuffle,
      getAnalyser,
      removeFromQueue,
      insertInQueue,
      moveInQueue,
      clearUpNext,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, track, index, playing, buffering, pos, vol, speed, repeat, shuffle],
  );
}
