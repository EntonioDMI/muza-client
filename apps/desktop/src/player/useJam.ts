/** Jam — «слушать вместе» (Stage 7). Хост-авторитарная модель: хост пушит
 *  состояние (трек/позиция/пауза) на сервер, гости следуют. Байты каждый
 *  добывает сам — сервер синхронизирует только состояние.
 *
 *  Хост: пуш на смену трека/паузы, детект сика по разрыву позиции,
 *  heartbeat раз в 10с; приём queue_add (гость докинул трек).
 *  Гость: применение state (смена трека → playContext, дрейф >3с → seek,
 *  play/pause), недоступный трек хоста (демо/локальный) — пауза с подписью.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { JamMember, JamSnapshot, JamState, MuzaApi } from "@muza/api-client";
import { DEFAULT_LANG, translate, type Lang, type TParams, type TranslationKey } from "../i18n";
import { fromCatalog, type PlayerTrack } from "./types";

/** Порог дрейфа позиции у гостя, сек. */
const DRIFT_SEC = 3;
/** Порог детекта сика у хоста, сек (разрыв фактической позиции от ожидаемой). */
const SEEK_JUMP_SEC = 2.5;
/** Heartbeat хоста (позиция для поздно вошедших), мс. */
const HEARTBEAT_MS = 10_000;

export interface JamPlayback {
  track: PlayerTrack | null;
  pos: number;
  playing: boolean;
  speed: number;
  playContext: (tracks: PlayerTrack[], id: string) => void;
  seek: (sec: number) => void;
  pause: () => void;
  toggle: () => void;
  insertInQueue: (track: PlayerTrack, at: number) => void;
  queueLength: number;
}

export interface JamUi {
  /** В jam прямо сейчас (хостом или гостем). */
  active: boolean;
  isHost: boolean;
  code: string | null;
  members: JamMember[];
  hostName: string;
  /** Хост слушает недоступный гостям трек (демо/локальный). */
  unavailable: boolean;
  /** Что слушает хост по последнему состоянию (для подписи у гостя). */
  hostState: JamState | null;
  busy: boolean;
  create: () => Promise<void>;
  join: (code: string) => Promise<void>;
  /** Хост — завершает jam для всех; гость — выходит сам. */
  leave: () => Promise<void>;
  /** Докинуть трек в очередь хоста (гость; хост добавляет к себе напрямую). */
  addTrack: (trackId: string) => Promise<void>;
}

export function useJam({
  api,
  enabled,
  pb,
  onNotify,
  lang = DEFAULT_LANG,
}: {
  api: MuzaApi;
  /** Серверная сессия; аноним jam не видит. */
  enabled: boolean;
  pb: JamPlayback;
  onNotify: (text: string, icon?: string) => void;
  /** Язык тостов (App.tsx может передать prefs.language); необязателен —
   *  без него тосты остаются на EN (DEFAULT_LANG). Опциональный, а не
   *  проп-дриллинг: вызывающий (App.tsx) — вне зоны этой правки (см.
   *  комментарий в i18n/en.media.ts), добавлять сюда сам вызов не могли. */
  lang?: Lang;
}): JamUi {
  const t = (key: TranslationKey, params?: TParams) => translate(lang, key, params);
  const [session, setSession] = useState<{ code: string; isHost: boolean; hostName: string } | null>(null);
  const [members, setMembers] = useState<JamMember[]>([]);
  const [hostState, setHostState] = useState<JamState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const pbRef = useRef(pb);
  pbRef.current = pb;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const unsubscribeRef = useRef<(() => void) | null>(null);
  /** Трек, который гость сейчас применяет (гонка добычи против событий). */
  const applyingTrackRef = useRef<string | null>(null);

  const cleanup = () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    applyingTrackRef.current = null;
    setSession(null);
    setMembers([]);
    setHostState(null);
    setUnavailable(false);
  };

  // ── Гость: применение состояния хоста ──────────────────────────────
  const applyState = (state: JamState) => {
    const p = pbRef.current;
    setHostState(state);
    if (!state.trackId) {
      // хост слушает то, чего у гостя нет (локальный файл) либо не слушает ничего
      setUnavailable(true);
      if (p.playing) p.pause();
      return;
    }
    setUnavailable(false);
    const expectedPos = state.posSec + (state.playing ? (Date.now() - state.updatedAt) / 1000 : 0);
    if (p.track?.id !== state.trackId) {
      if (applyingTrackRef.current === state.trackId) return; // уже добываем его
      applyingTrackRef.current = state.trackId;
      void api
        .getTrack(state.trackId)
        .then((track) => {
          if (applyingTrackRef.current !== state.trackId) return; // хост уже дальше
          if (sessionRef.current === null) return;
          p.playContext([fromCatalog(track)], track.id);
        })
        .catch(() => {
          onNotifyRef.current(t("media.jam.hostTrackFetchFailed"), "x");
        })
        .finally(() => {
          if (applyingTrackRef.current === state.trackId) applyingTrackRef.current = null;
        });
      return; // позиция догонится следующим событием/heartbeat
    }
    if (Math.abs(p.pos - expectedPos) > DRIFT_SEC && state.playing) p.seek(Math.max(0, expectedPos));
    if (state.playing && !p.playing) p.toggle();
    else if (!state.playing && p.playing) p.pause();
  };

  // ── Подписка на события (обе роли) ─────────────────────────────────
  const subscribe = (code: string, isHost: boolean) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = api.subscribeJamEvents(code, (event) => {
      switch (event.type) {
        case "snapshot":
          setMembers(event.snapshot.members);
          if (!isHost && event.snapshot.state) applyState(event.snapshot.state);
          break;
        case "state":
          if (!isHost) applyState(event.state);
          else setHostState(event.state);
          break;
        case "members":
          setMembers(event.members);
          break;
        case "queueAdd": {
          // трек гостя падает в конец очереди ХОСТА; гостям — только тост
          const p = pbRef.current;
          if (isHost) p.insertInQueue(fromCatalog(event.track), p.queueLength);
          onNotifyRef.current(t("media.jam.trackAdded", { by: event.by, title: event.track.title }), "list-plus");
          break;
        }
        case "ended":
          if (sessionRef.current) {
            onNotifyRef.current(
              sessionRef.current.isHost ? t("media.jam.ended") : t("media.jam.hostEnded"), "radio-tower",
            );
            cleanup();
          }
          break;
      }
    });
  };

  const applySnapshot = (snap: JamSnapshot) => {
    setSession({ code: snap.code, isHost: snap.isHost, hostName: snap.host.username });
    setMembers(snap.members);
    setHostState(snap.state);
    subscribe(snap.code, snap.isHost);
  };

  const create = async () => {
    setBusy(true);
    try {
      applySnapshot(await api.createJam());
    } catch (e) {
      onNotifyRef.current(e instanceof Error ? e.message : t("media.jam.createFailed"), "x");
    } finally {
      setBusy(false);
    }
  };

  const join = async (code: string) => {
    setBusy(true);
    try {
      const snap = await api.joinJam(code.trim().toUpperCase());
      applySnapshot(snap);
      onNotifyRef.current(t("media.jam.joinedAs", { username: snap.host.username }), "radio-tower");
      if (!snap.isHost && snap.state) applyState(snap.state);
    } catch (e) {
      onNotifyRef.current(e instanceof Error ? e.message : t("media.jam.joinFailed"), "x");
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    const s = sessionRef.current;
    if (!s) return;
    cleanup(); // локально выходим сразу — сервер догонит
    await api.leaveJam(s.code).catch(() => undefined);
    onNotifyRef.current(s.isHost ? t("media.jam.ended") : t("media.jam.left"), "radio-tower");
  };

  const addTrack = async (trackId: string) => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      await api.addJamTrack(s.code, trackId);
    } catch (e) {
      onNotifyRef.current(e instanceof Error ? e.message : t("media.jam.addFailed"), "x");
    }
  };

  // ── Хост: пуш состояния ────────────────────────────────────────────
  const pushState = () => {
    const s = sessionRef.current;
    const p = pbRef.current;
    if (!s?.isHost) return;
    // У хоста пустая очередь — синхронизировать нечего. Пустой title слать
    // нельзя: гость подставляет его в «хост слушает „…“, у тебя этого нет» и
    // увидел бы пустые кавычки. Как только хост что-то включит, пуш и
    // heartbeat догонят гостя сами.
    if (!p.track) return;
    const isCatalog = p.track.kind === "catalog" && /^\d+$/.test(p.track.id);
    void api
      .pushJamState(s.code, {
        trackId: isCatalog ? p.track.id : null,
        title: p.track.title,
        artist: p.track.artist,
        coverUrl: p.track.cover?.startsWith("http") ? p.track.cover : null,
        durationSec: Math.round(p.track.duration),
        posSec: Math.round(p.pos * 10) / 10,
        playing: p.playing,
      })
      .catch(() => undefined); // сеть мигнула — heartbeat повторит
  };
  const pushStateRef = useRef(pushState);
  pushStateRef.current = pushState;

  const isHostActive = session?.isHost === true;

  // смена трека / play-pause — пуш сразу
  useEffect(() => {
    if (!isHostActive) return;
    pushStateRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHostActive, pb.track?.id, pb.playing]);

  // детект сика: фактическая позиция разорвалась с ожидаемой
  const lastPosRef = useRef<{ pos: number; at: number } | null>(null);
  useEffect(() => {
    if (!isHostActive) {
      lastPosRef.current = null;
      return;
    }
    const last = lastPosRef.current;
    const now = Date.now();
    lastPosRef.current = { pos: pb.pos, at: now };
    if (!last || !pb.playing) return;
    const expected = last.pos + ((now - last.at) / 1000) * pb.speed;
    if (Math.abs(pb.pos - expected) > SEEK_JUMP_SEC) pushStateRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHostActive, pb.pos]);

  // heartbeat: поздно вошедшие получают свежую позицию и без событий
  useEffect(() => {
    if (!isHostActive) return;
    const iv = setInterval(() => pushStateRef.current(), HEARTBEAT_MS);
    return () => clearInterval(iv);
  }, [isHostActive]);

  // сессия закончилась (логаут) — выходим тихо
  useEffect(() => {
    if (!enabled && sessionRef.current) void leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // размонтирование — отписка от SSE
  useEffect(() => () => unsubscribeRef.current?.(), []);

  return useMemo(
    () => ({
      active: session !== null,
      isHost: session?.isHost ?? false,
      code: session?.code ?? null,
      members,
      hostName: session?.hostName ?? "",
      unavailable,
      hostState,
      busy,
      create,
      join,
      leave,
      addTrack,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, members, unavailable, hostState, busy],
  );
}
