"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Track } from "@muza/api-client";
import { getApi } from "./api";
import { ensureEq, eqAttached, setEqBands } from "./audioFx";
import { usePrefs } from "./prefs";

/** Веб-плеер (Stage 8): `<audio>` поверх серверного резолвера. Web Audio-цепь
 *  десктопа (EQ/кроссфейд/нормализация) сюда сознательно не переносится —
 *  веб-клиент лёгкий; браузер сам декодирует и играет стрим с Range-сиком.
 *
 *  Контекст разрезан надвое: позиция тикает ~4 раза в секунду, и от неё должны
 *  перерисовываться только плеер-бар и тексты — не все списки страницы. */

export type Repeat = "off" | "all" | "one";

interface PlayerCtx {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  volume: number;
  muted: boolean;
  repeat: Repeat;
  shuffle: boolean;
  /** «Откуда кликнул — то и очередь» (модель десктопа). */
  playContext: (tracks: Track[], startIndex: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
}

interface PositionCtx {
  position: number;
  duration: number;
}

const Player = createContext<PlayerCtx | null>(null);
const Position = createContext<PositionCtx>({ position: 0, duration: 0 });

const VOLUME_KEY = "muza.web.volume.v1";

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>("off");
  const [shuffle, setShuffle] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** stream-url кэшируется до истечения TTL (минус запас 5 мин) */
  const urlsRef = useRef(new Map<string, { url: string; expiresAt: number }>());
  /** порядок до шаффла — выключение возвращает как было */
  const baseQueueRef = useRef<Track[]>([]);
  /** наиграно текущего трека (для честного скроббла) */
  const playedMsRef = useRef(0);
  const lastTimeRef = useRef(0);
  const retriedRef = useRef(false);
  /** для какого трека уже прогрет серверный кэш следующего */
  const prefetchedRef = useRef<string | null>(null);
  const stateRef = useRef({ queue, index, repeat, shuffle });
  stateRef.current = { queue, index, repeat, shuffle };
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const current = index >= 0 ? (queue[index] ?? null) : null;
  const currentRef = useRef<Track | null>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(saved) && saved > 0 && saved <= 1) setVolumeState(saved);
  }, []);

  const audio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      // ДО первой загрузки: без этого MediaElementSource эквалайзера молча
      // даёт тишину (гоча из десктопного audioEngine)
      el.crossOrigin = "anonymous";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  /** Скроббл по правилам десктопа: completed = доиграл или ≥90%. */
  const scrobble = useCallback((track: Track, completed: boolean) => {
    const playedMs = Math.round(playedMsRef.current);
    if (playedMs < 1000) return;
    const durationMs = track.durationSec * 1000;
    void getApi()
      .recordPlay({ trackId: track.id, playedMs, durationMs, completed: completed || playedMs >= durationMs * 0.9 })
      .catch(() => undefined);
  }, []);

  const streamUrl = useCallback(async (trackId: string, force = false): Promise<string> => {
    const cached = urlsRef.current.get(trackId);
    if (!force && cached && cached.expiresAt - 300 > Date.now() / 1000) return cached.url;
    const fresh = await getApi().getStreamUrl(trackId);
    urlsRef.current.set(trackId, fresh);
    return fresh.url;
  }, []);

  const loadTrack = useCallback(
    async (track: Track, autoplay: boolean) => {
      const el = audio();
      setError(null);
      setLoading(true);
      setPosition(0);
      setDuration(track.durationSec);
      playedMsRef.current = 0;
      lastTimeRef.current = 0;
      retriedRef.current = false;
      try {
        el.src = await streamUrl(track.id);
        el.load();
        if (autoplay) await el.play();
      } catch (e) {
        // резолв первого запроса может идти десятки секунд — 503 честно скажет
        setError(e instanceof Error ? e.message : "Не удалось воспроизвести");
        setLoading(false);
      }
    },
    [audio, streamUrl],
  );

  // смена текущего трека → загрузка; скроббл предыдущего — до переключения
  useEffect(() => {
    const prevTrack = currentRef.current;
    if (prevTrack && prevTrack.id !== current?.id) scrobble(prevTrack, false);
    currentRef.current = current;
    if (current) void loadTrack(current, true);
    else {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // события <audio> — один комплект слушателей на всё время жизни
  useEffect(() => {
    const el = audio();
    const onTime = () => {
      const t = el.currentTime;
      const dt = t - lastTimeRef.current;
      // только честное воспроизведение: сик даёт dt вне (0, 2с) и не считается
      if (dt > 0 && dt < 2) playedMsRef.current += dt * 1000;
      lastTimeRef.current = t;
      setPosition(t);
      // прогрев следующего трека: с середины текущего дёргаем /stream первым
      // байтом — сервер добывает заранее, переход почти мгновенный
      const { queue: q, index: i } = stateRef.current;
      const upNext = q[i + 1];
      if (
        upNext &&
        !upNext.localHash &&
        prefetchedRef.current !== upNext.id &&
        el.duration > 0 &&
        (t > el.duration * 0.5 || el.duration - t < 45)
      ) {
        prefetchedRef.current = upNext.id;
        void streamUrl(upNext.id)
          .then((url) => fetch(url, { headers: { Range: "bytes=0-1" } }))
          .catch(() => undefined);
      }
    };
    const onDuration = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    const onPlay = () => {
      setPlaying(true);
      setLoading(false);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onEnded = () => {
      const track = currentRef.current;
      if (track) {
        playedMsRef.current = Math.max(playedMsRef.current, track.durationSec * 1000 * 0.95);
        scrobble(track, true);
        playedMsRef.current = 0;
      }
      const { queue: q, index: i, repeat: r } = stateRef.current;
      if (r === "one") {
        el.currentTime = 0;
        void el.play();
      } else if (i + 1 < q.length) {
        setIndex(i + 1);
      } else if (r === "all" && q.length > 0) {
        setIndex(0);
        // тот же трек в очереди из одного — эффект смены не сработает
        if (q.length === 1) {
          el.currentTime = 0;
          void el.play();
        }
      } else {
        setPlaying(false);
      }
    };
    const onError = async () => {
      const track = currentRef.current;
      if (!track) return;
      // стрим-токен истёк (пауза дольше TTL) — одна перевыдача с возвратом позиции
      if (!retriedRef.current) {
        retriedRef.current = true;
        const pos = el.currentTime;
        try {
          el.src = await streamUrl(track.id, true);
          el.load();
          el.currentTime = pos;
          await el.play();
          return;
        } catch {
          /* не помогло — честная ошибка ниже */
        }
      }
      setLoading(false);
      setPlaying(false);
      setError("Не удалось воспроизвести трек");
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onDuration);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onDuration);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [audio, scrobble, streamUrl]);

  useEffect(() => {
    const el = audio();
    el.volume = muted ? 0 : volume;
  }, [audio, volume, muted]);

  // Эквалайзер: цепь строится по включению (жест уже был — тумблер/плей),
  // выключенный EQ = полосы в 0 (цепь не разбирается, см. audioFx)
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (prefs.eqOn) {
      if (ensureEq(el)) setEqBands(prefs.eqBands, true);
    } else if (eqAttached()) {
      setEqBands(prefs.eqBands, false);
    }
  }, [prefs.eqOn, prefs.eqBands]);

  const playContext = useCallback((tracks: Track[], startIndex: number) => {
    const playable = tracks.filter((t) => !t.localHash); // локальные — только на своём устройстве
    if (playable.length === 0) return;
    // клик — это жест: момент завести AudioContext, если EQ включён в prefs
    if (prefsRef.current.eqOn && ensureEq(audio())) setEqBands(prefsRef.current.eqBands, true);
    const start = Math.max(
      playable.findIndex((t) => t.id === tracks[startIndex]?.id),
      0,
    );
    baseQueueRef.current = playable;
    setShuffle(false);
    setQueue(playable);
    // повторный клик по игравшему треку — перезапуск через эффект не сработает
    // (id не сменился), поэтому играем напрямую
    const el = audioRef.current;
    const sameTrack = currentRef.current?.id === playable[start]?.id;
    setIndex(start);
    if (sameTrack && el) {
      el.currentTime = 0;
      void el.play();
    }
  }, []);

  const toggle = useCallback(() => {
    const el = audio();
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, [audio]);

  const next = useCallback(() => {
    const { queue: q, index: i, repeat: r } = stateRef.current;
    if (i + 1 < q.length) setIndex(i + 1);
    else if (r === "all" && q.length > 0) setIndex(0);
  }, []);

  const prev = useCallback(() => {
    const el = audio();
    const { index: i } = stateRef.current;
    // >3с — возврат к началу трека (конвенция плееров), иначе — предыдущий
    if (el.currentTime > 3 || i <= 0) {
      el.currentTime = 0;
      setPosition(0);
    } else {
      setIndex(i - 1);
    }
  }, [audio]);

  const seek = useCallback(
    (sec: number) => {
      const el = audio();
      el.currentTime = sec;
      lastTimeRef.current = sec;
      setPosition(sec);
    },
    [audio],
  );

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    setMuted(false);
    localStorage.setItem(VOLUME_KEY, String(clamped));
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((was) => {
      const on = !was;
      const cur = currentRef.current;
      if (on) {
        // текущий остаётся на месте, хвост перемешивается
        const rest = baseQueueRef.current.filter((t) => t.id !== cur?.id);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        const nextQueue = cur ? [cur, ...rest] : rest;
        setQueue(nextQueue);
        setIndex(cur ? 0 : -1);
      } else {
        const base = baseQueueRef.current;
        setQueue(base);
        setIndex(cur ? Math.max(base.findIndex((t) => t.id === cur.id), 0) : -1);
      }
      return on;
    });
  }, []);

  // Media Session: метаданные и кнопки на клавиатурах/локскринах
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (current) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        artwork: current.coverUrl ? [{ src: current.coverUrl, sizes: "512x512" }] : [],
      });
    }
    navigator.mediaSession.setActionHandler("play", () => void audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler("previoustrack", prev);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) seek(d.seekTime);
    });
  }, [current, next, prev, seek]);

  const playerValue = useMemo<PlayerCtx>(
    () => ({
      queue,
      index,
      current,
      playing,
      loading,
      error,
      volume,
      muted,
      repeat,
      shuffle,
      playContext,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      cycleRepeat,
      toggleShuffle,
    }),
    [queue, index, current, playing, loading, error, volume, muted, repeat, shuffle,
     playContext, toggle, next, prev, seek, setVolume, toggleMute, cycleRepeat, toggleShuffle],
  );

  const positionValue = useMemo<PositionCtx>(() => ({ position, duration }), [position, duration]);

  return (
    <Player.Provider value={playerValue}>
      <Position.Provider value={positionValue}>{children}</Position.Provider>
    </Player.Provider>
  );
}

export function usePlayer(): PlayerCtx {
  const ctx = useContext(Player);
  if (!ctx) throw new Error("usePlayer вне PlayerProvider");
  return ctx;
}

/** Позиция/длительность отдельно: подписываются только плеер-бар и тексты. */
export function usePosition(): PositionCtx {
  return useContext(Position);
}
