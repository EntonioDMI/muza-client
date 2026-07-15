/** Оркестратор воспроизведения (Stage 3): очередь-контекст (откуда запустили —
 *  то и очередь), реальный движок для каталожных треков (добыча → LRU-кэш →
 *  <audio>), демо-треки — симуляция таймером (у них нет аудио). */

import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { MuzaApi, TrackSource } from "@muza/api-client";
import type { Prefs, RepeatMode } from "../types";
import { translate, type TParams, type TranslationKey } from "../i18n";
import { engineAvailable, resolvePlayable, type ResolveResult } from "../lib/engine";
import { applySourcePolicy } from "../lib/sources";
import { localResolve } from "../lib/localFiles";
import { resumeStore } from "../lib/resumeStore";
import { AudioEngine } from "./audioEngine";
import { nextPollDelayMs, pickAutoFadeSec, planAutoAdvance } from "./gaplessPlan";
import type { PlayerTrack } from "./types";

/** За сколько секунд до конца начинать преднагрузку следующего трека. */
const PRELOAD_AHEAD_SEC = 20;

/** T19 fast-follow (точный триггер gapless, см. pollGapless ниже и
 *  gaplessPlan.ts): пока до конца трека дальше этого порога — один дешёвый
 *  setTimeout "на глаз" (не важна точность); внутри — тесный опрос с шагом
 *  GAPLESS_POLL_STEP_MS. Заведомо больше GAPLESS_LEAD_SEC — запас на то, что
 *  сама "дальняя" задержка может прийти с опозданием (см. gaplessPlan.ts). */
const GAPLESS_ARM_LEAD_SEC = 2;
/** Шаг тесного опроса engine().position() в последние GAPLESS_ARM_LEAD_SEC
 *  секунд трека. Живой замер (T19 fast-follow) показал: пока окно ВИДИМО,
 *  setTimeout не троттлится, и такой шаг даёт точность в единицах мс; когда
 *  окно скрыто/свёрнуто, браузер сам выравнивает любые таймеры страницы на
 *  ~1 срабатывание/сек независимо от запрошенного шага — тогда 20мс не хуже
 *  и не лучше более крупного числа, но и не вредят (тот же самый setTimeout,
 *  просто редкий на практике). */
const GAPLESS_POLL_STEP_MS = 20;

export interface PlayEndInfo {
  track: PlayerTrack;
  playedMs: number;
  completed: boolean;
}

/** Что играет сейчас; null — очередь пуста, «ничего не играет». */
export type CurrentTrack = PlayerTrack | null;

export function usePlayback({
  api,
  initialQueue,
  initialPos = 0,
  prefs,
  onError,
  onPlayEnd,
  onQueueEnd,
}: {
  api: MuzaApi;
  initialQueue: PlayerTrack[];
  /** Позиция плеер-бара до первого взаимодействия: при восстановлении
   *  последнего трека после релонча (App.tsx, prefs.resumePosition) —
   *  сохранённая позиция, иначе 0. Дефолтом тут стояло 24 — «уже населённый»
   *  бар демо Stage 1; вместе с демо-очередью это и рисовало новому
   *  пользователю чужую песню на 0:24. Playing НИКОГДА не наследуется
   *  отсюда — см. playing ниже (T2: защита от «песни сами играют»). */
  initialPos?: number;
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
  // Плеер НИКОГДА не стартует играющим сам — только по явному действию
  // пользователя (клик/toggle). Раньше здесь было true «как в демо Stage 1»;
  // с тех пор playing доехало до Discord RPC/mediaSession(SMTC)/мини-плеера,
  // и любой релонч (в т.ч. тихий рестарт tauri dev на правку src-tauri/**)
  // выглядел как «песня сама заиграла» (T2-расследование, живой репро
  // подтвердил механизм). Восстановление трека — см. initialQueue/initialPos.
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [pos, setPos] = useState(initialPos);
  const [vol, setVolState] = useState(64);
  const [speed, setSpeed] = useState(1);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);

  // null — очередь пуста, «ничего не играет». Это НАСТОЯЩЕЕ состояние плеера, а
  // не край: раньше инвариант «трек есть всегда» держала демо-очередь-заглушка
  // (initialQueue[0]), из-за чего новый пользователь видел в баре чужую песню.
  const track: PlayerTrack | null = queue[index] ?? queue[0] ?? null;

  // refs для колбэков движка/таймеров (без пересоздания и стейл-замыканий)
  const stateRef = useRef({ queue, index, playing, repeat, shuffle, speed, track, pos });
  stateRef.current = { queue, index, playing, repeat, shuffle, speed, track, pos };
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  // i18n (T-media): usePlayback не рендерится внутри своего LanguageProvider
  // (тот выше, в Player/App) — как T31 в App.tsx, зовём чистую translate()
  // напрямую с prefs.language вместо хука useT(). prefsRef уже существует
  // (см. выше) — читаем язык на момент вызова, не на момент рендера.
  const t = (key: TranslationKey, params?: TParams) => translate(prefsRef.current.language, key, params);
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
  // Ранний стык (кроссфейд/gapless) на естественном переходе уже запущен для этого pos
  const autoAdvancedRef = useRef(false);
  // T19 fast-follow: id таймера точного gapless-опроса (pollGapless ниже) —
  // один setTimeout в моменте, self-adjusting (перепланирует сам себя).
  const gaplessTimerRef = useRef<number | null>(null);
  // id трека, чей URL реально загружен в движок (успешный engine().play()).
  // T2: очередь при монтировании может содержать восстановленный трек, для
  // которого startAt ЕЩЁ не вызывался (playing нарочно false) — toggle()
  // сверяется с этим, чтобы не звать resume() на пустом слоте движка.
  const startedIdRef = useRef<string | null>(null);

  const engineRef = useRef<AudioEngine | null>(null);
  const engine = () => {
    if (!engineRef.current) {
      engineRef.current = new AudioEngine({
        onTime: (sec) => {
          const s = stateRef.current;
          if (!s.track) return;
          setPos(sec);
          tickPlayed(sec);
          // «Продолжить с места»: троттленная запись позиции текущего трека
          if (prefsRef.current.resumePosition && sec > 5) resumeStore.save(s.track.id, sec);
          const remaining = s.track.duration - sec;
          // преднагрузка следующего + ранний стык (кроссфейд ИЛИ gapless — см. gaplessPlan.ts)
          if (remaining <= PRELOAD_AHEAD_SEC) void preloadNext();
          const plan = planAutoAdvance({
            remaining,
            crossfadeEnabled: prefsRef.current.crossfade,
            gaplessEnabled: prefsRef.current.gapless,
            repeatOne: s.repeat === "one",
            hasNext: nextIndexFor(1, true) !== null,
            alreadyAdvanced: autoAdvancedRef.current,
          });
          if (plan.trigger) {
            autoAdvancedRef.current = true;
            void advance(1, true);
          }
        },
        onEnded: () => {
          if (autoAdvancedRef.current) return; // ранний стык (кроссфейд/gapless) уже увёл дальше
          handleTrackEnd();
        },
        onError: (message) => {
          setBuffering(false);
          onErrorRef.current(message);
        },
      }, t);
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
      if (!path) throw new Error(translate(prefsRef.current.language, "media.player.errors.localFileNotFound"));
      return { url: convertFileSrc(path), fromCache: true, provider: "local" };
    }
    // Причину отказа сервера ЗАПОМИНАЕМ: .catch(() => null) раньше уравнивал
    // «нет сети» с 401/429/500, и любой из них уходил в оффлайн-ветку, где
    // движок с пустой лестницей отвечал безликим «нет живых источников».
    let sources: TrackSource[] | null = null;
    let sourcesError: unknown = null;
    try {
      sources = await api.getTrackSources(t.id);
    } catch (e) {
      sourcesError = e;
    }
    const quality = prefsRef.current.streamQuality;
    if (sources === null) {
      if (t.localHash) {
        const path = await localResolve(t.localHash);
        if (path) return { url: convertFileSrc(path), fromCache: true, provider: "local" };
      }
      // оффлайн: кэш добычи отдаёт файл и без сети (пустая лестница = только кэш)
      try {
        return await resolvePlayable(t.id, [], quality, prefsRef.current.language);
      } catch {
        // Кэш не спас — наружу должна уйти ПРИЧИНА отказа сервера, а не
        // ошибка движка о пустой лестнице, которую мы сами ему и передали.
        throw sourcesError instanceof Error ? sourcesError : new Error(String(sourcesError));
      }
    }
    // клиентская политика: вкл/выкл провайдеров + порядок предпочтения
    return resolvePlayable(t.id, applySourcePolicy(sources, prefsRef.current), quality, prefsRef.current.language);
  };

  /** Запустить трек очереди по индексу. fadeSec>0 (кроссфейд/gapless) —
   *  только на авто-переходе, см. advance(). */
  const startAt = async (i: number, opts?: { fadeSec?: number }) => {
    const s = stateRef.current;
    const t = s.queue[i];
    if (!t) return;
    flushPlayEnd(false);
    const seq = ++playSeqRef.current;
    setIndex(i);
    setPos(0);
    setPlaying(true);
    autoAdvancedRef.current = false;
    stopGaplessPoll(); // новый трек — старый прицел точного триггера уже неактуален
    rememberPlayed(t.id);
    // «Последний активный трек» — материал для восстановления при следующем
    // запуске (App.tsx). Пишем на каждый реальный старт (клик/авто-переход),
    // не только на клик — чтобы «трек готов» после релонча был актуальным.
    if (prefsRef.current.resumePosition) resumeStore.saveLast(t);

    if (!engineAvailable()) {
      setPlaying(false);
      onErrorRef.current(translate(prefsRef.current.language, "media.player.errors.desktopOnly"));
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
      await engine().play(url, norm, opts?.fadeSec ?? 0);
      startedIdRef.current = t.id; // движок реально держит URL этого трека
      pollGapless(); // T19 fast-follow: точный прицел на конец нового трека
      // «Продолжить с места»: если сохранена осмысленная позиция (не у начала
      // и не у конца) — досикиваем. Ручной старт с 0 через seek не трогаем.
      if (prefsRef.current.resumePosition) {
        const saved = resumeStore.get(t.id);
        if (saved > 5 && saved < t.duration - 10 && playSeqRef.current === seq) {
          engine().seek(saved);
          setPos(saved);
        }
      }
    } catch (e) {
      if (playSeqRef.current !== seq) return;
      setPlaying(false);
      onErrorRef.current(e instanceof Error ? e.message : translate(prefsRef.current.language, "media.player.errors.trackFetchFailed"));
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
    if (!nt || preloadedRef.current?.id === nt.id) return;
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
    if (!s.track) return; // пустая очередь — переходить не от чего и не к чему
    if (auto && s.repeat === "one") {
      // повтор трека: с начала, без кроссфейда
      engine().seek(0);
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
          await startAt(s.queue.length, { fadeSec: 0 });
          return;
        }
      }
      flushPlayEnd(true);
      setPlaying(false);
      setPos(s.track.duration);
      stopGaplessPoll(); // конец очереди без продолжения — опрашивать больше нечего
      return;
    }
    // fadeSec пересчитывается здесь заново (не переносится из onTime-триггера):
    // если ранний триггер не сработал (окно timeupdate проскочили) и advance
    // пришёл сюда из onEnded, всё равно просим движок попробовать фейд — он
    // молча откатится на мгновенный переход, раз текущий слот уже не играет.
    await startAt(ni, { fadeSec: auto ? pickAutoFadeSec(prefsRef.current) : 0 });
  };

  /** Остановить точный gapless-опрос (пауза/новый трек/сик/размонтирование). */
  const stopGaplessPoll = () => {
    if (gaplessTimerRef.current !== null) {
      window.clearTimeout(gaplessTimerRef.current);
      gaplessTimerRef.current = null;
    }
  };

  /** T19 fast-follow (ревью #2, точный триггер вместо окна 1.5с): решает то
   *  же, что и onTime ниже (planAutoAdvance по remaining), но читает
   *  engine().position() напрямую через self-adjusting setTimeout — не ждёт
   *  timeupdate, у которого гранулярность иногда куда грубее учебных
   *  "4 раза/сек" (особенно в фоне/без OS-фокуса, см. gaplessPlan.ts). Пока
   *  до конца трека дальше GAPLESS_ARM_LEAD_SEC — один дешёвый прыжок «на
   *  глаз»; ближе к концу — тесный опрос с шагом GAPLESS_POLL_STEP_MS. Это
   *  ДОПОЛНЕНИЕ к timeupdate-триггеру в onTime (crossfade он двигает как и
   *  раньше — его окно широкое, само по себе надёжно), не замена: если этот
   *  опрос почему-то не запустился, старый путь всё равно есть как подстраховка.
   *
   *  Намеренно НЕ проверяет stateRef.current.playing: вызывающие сами следят
   *  за жизненным циклом (stopGaplessPoll на каждую паузу/останов — toggle,
   *  pause, removeFromQueue, advance при конце очереди, seek, startAt, размонтирование;
   *  pollGapless на каждый resume/старт) — проверка тут была бы обманчиво
   *  «свежей»: toggle() вызывает pollGapless() ДО того, как setPlaying(true)
   *  долетит до stateRef.current (React-стейт обновляется асинхронно), так
   *  что s.playing внутри читался бы ещё старым (false) и опрос немедленно
   *  бы остановился на каждом resume. */
  const pollGapless = () => {
    gaplessTimerRef.current = null;
    const s = stateRef.current;
    if (!s.track) return;
    const remaining = s.track.duration - engine().position();
    const plan = planAutoAdvance({
      remaining,
      crossfadeEnabled: prefsRef.current.crossfade,
      gaplessEnabled: prefsRef.current.gapless,
      repeatOne: s.repeat === "one",
      hasNext: nextIndexFor(1, true) !== null,
      alreadyAdvanced: autoAdvancedRef.current,
    });
    if (plan.trigger) {
      autoAdvancedRef.current = true;
      void advance(1, true);
      return;
    }
    if (!prefsRef.current.gapless && !prefsRef.current.crossfade) return; // обе фичи выкл — нечего опрашивать
    // T19-fix: формула вынесена в gaplessPlan.nextPollDelayMs (юнит-тест там же) —
    // здесь только вызов, поведение не изменилось.
    const delay = nextPollDelayMs(remaining, GAPLESS_ARM_LEAD_SEC, GAPLESS_POLL_STEP_MS);
    gaplessTimerRef.current = window.setTimeout(pollGapless, delay);
  };

  const handleTrackEnd = () => {
    flushPlayEnd(true);
    void advance(1, true);
  };

  // ── Публичное API ─────────────────────────────────────────────────

  /** Клик по треку в списке: тот же id — пауза/плей, иначе — играть; если
   *  передан context — он становится очередью (play-context как в больших плеерах). */
  const playContext = (tracks: PlayerTrack[], id: string) => {
    const s = stateRef.current;
    const sameQueue =
      tracks.length === s.queue.length && tracks.every((t, i) => t.id === s.queue[i]?.id);
    if (sameQueue && id === s.track?.id) {
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
    if (!s.track) return; // ничего не играет — переключать нечего
    if (s.playing) {
      engine().pause();
      setPlaying(false);
      stopGaplessPoll(); // пауза — точный опрос ждёт до resume ниже
      return;
    }
    // Трек в очереди мог попасть туда БЕЗ startAt (T2: восстановление
    // последнего трека при старте — App.tsx кладёт его в initialQueue, но
    // playing нарочно false и движок ни разу не резолвил URL). engine().resume()
    // на пустом слоте — тихий no-op (audioEngine.resume: el?.src falsy),
    // playing выставился бы в true БЕЗ звука. Проверяем и в этом случае
    // делаем полноценный startAt — он сам ставит playing.
    if (startedIdRef.current !== s.track.id) {
      void startAt(s.index);
      return;
    }
    void engine().resume();
    pollGapless(); // T19 fast-follow: перезапустить точный прицел после паузы
    setPlaying(true);
  };

  const next = () => void advance(1, false);
  const prev = () => void advance(-1, false);

  /** Явная пауза (sleep-таймер и т.п.) — с остановкой движка. */
  const pause = () => {
    if (stateRef.current.track) {
      engine().pause();
      stopGaplessPoll();
    }
    setPlaying(false);
  };

  const seek = (sec: number) => {
    const s = stateRef.current;
    if (!s.track) return; // сик по пустой очереди — некуда
    const clamped = Math.max(0, Math.min(sec, s.track.duration));
    setPos(clamped);
    engine().seek(clamped);
    // Позиция скакнула — старый прицел точного триггера (посчитан от
    // старой remaining) неактуален; пересчитываем, если всё ещё играем.
    stopGaplessPoll();
    if (s.playing) pollGapless();
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
        stopGaplessPoll();
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

  // ── Управление для плагинов (T44): произвольная скорость + операции над
  //    очередью, которых не было в UX-наборе (реордер from→to, полный сброс). ──

  /** Точная скорость (плагин Muza.Player.setRate) — в отличие от cycleSpeed. */
  const setRate = (r: number) => {
    const clamped = Math.max(0.25, Math.min(4, r));
    setSpeed(clamped);
    engineRef.current?.setSpeed(clamped);
  };

  /** Добавить треки в очередь на позицию pos (по умолчанию — в конец). */
  const enqueue = (tracks: PlayerTrack[], pos?: number) => {
    if (tracks.length === 0) return;
    const s = stateRef.current;
    const at = pos === undefined ? s.queue.length : Math.max(0, Math.min(pos, s.queue.length));
    const nextQueue = [...s.queue.slice(0, at), ...tracks, ...s.queue.slice(at)];
    patchQueue(nextQueue, at <= s.index ? s.index + tracks.length : s.index);
  };

  /** Переставить трек с позиции from на позицию to (плагин reorderQueue). */
  const reorderQueue = (from: number, to: number) => {
    const s = stateRef.current;
    if (from < 0 || from >= s.queue.length || to < 0 || to >= s.queue.length || from === to) return;
    const nextQueue = [...s.queue];
    const [moved] = nextQueue.splice(from, 1);
    nextQueue.splice(to, 0, moved);
    const idx =
      s.index === from ? to : from < s.index && to >= s.index ? s.index - 1 : from > s.index && to <= s.index ? s.index + 1 : s.index;
    patchQueue(nextQueue, idx);
  };

  /** Полная очистка очереди — оставляем только текущий трек (иначе нечего
   *  играть); плагин Muza.Player.clearQueue. */
  const clearQueue = () => {
    const s = stateRef.current;
    if (s.queue.length <= 1 || !s.track) return;
    patchQueue([s.track], 0);
  };

  // EQ и нормализация из Prefs — на движок
  useEffect(() => {
    engineRef.current?.setEq(prefs.eqOn, prefs.eqBands);
  }, [prefs.eqOn, prefs.eqBands]);

  // Смена спикеров/выхода не наша забота; при размонтировании — тишина
  useEffect(
    () => () => {
      engineRef.current?.stop();
      stopGaplessPoll();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
      // Плагины (T44)
      setRate,
      enqueue,
      reorderQueue,
      clearQueue,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, track, index, playing, buffering, pos, vol, speed, repeat, shuffle],
  );
}
