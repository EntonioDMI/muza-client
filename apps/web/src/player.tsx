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
import { useT } from "@muza/app";
import { getApi } from "./api";
import { ensureChain, eqAttached, normFactor, setEqBands, setSlotLevel } from "./audioFx";
import { usePrefs } from "./prefs";

/** Веб-плеер (Stage 8): `<audio>` поверх серверного резолвера.
 *
 *  ДВА СЛОТА (2026-08-02, волна веб-паритета «Воспроизведение»). Раньше здесь
 *  был один элемент и приписка «цепь десктопа сюда сознательно не переносится».
 *  Она не выдержала простого правила экрана настроек: ряд, которому нечего
 *  применить, показывать нельзя, — а в разделе «Воспроизведение» у веба был
 *  один ряд из пятнадцати. Кроссфейд и переход без паузы физически требуют,
 *  чтобы два трека звучали одновременно, поэтому слотов стало два: активный
 *  играет, второй готовит следующий и принимает эстафету.
 *
 *  Что теперь умеет вкладка браузера (и чем это сделано):
 *   - кроссфейд равной мощности и его длительность — tick + startFade;
 *   - переход без паузы — тот же механизм, только фейд в доли секунды;
 *   - выравнивание громкости — normFactor по серверному замеру (audioFx);
 *   - скорость воспроизведения без «бурундука» — preservesPitch;
 *   - продолжить с места остановки — карта позиций ниже;
 *   - бесконечное радио — догрузка похожих, когда очередь кончилась;
 *   - подготовка очереди (сколько треков греть и за сколько секунд до конца).
 *  Чего браузер не умеет — того в настройках нет вовсе (см. settings/page.tsx).
 *
 *  ⚠️ СВЕРКА НОМЕРА СТАРТА (loadSeqRef) — инвариант файла, переживший эту
 *  правку: любой асинхронный путь, который в итоге трогает src или play(),
 *  обязан сначала убедиться, что его номер ещё актуален. Иначе ответ на старый
 *  запрос подменяет уже выбранную песню (жалоба владельца 02.08). Путей теперь
 *  два — loadTrack (клик) и advanceWithFade (авто-переход), сверка есть в обоих,
 *  плюс перевыдача истёкшего адреса в обработчике error.
 *
 *  ⚠️ СЛОТ И «ТЕКУЩИЙ ТРЕК» — РАЗНЫЕ ВЕЩИ (аудит 03.08). Клик меняет current
 *  сразу, а слот получает новую песню только после ответа сервера — секунды
 *  спустя, и всё это время в нём играет ПРЕДЫДУЩАЯ. Поэтому у слота есть
 *  собственный trackId, и всякий, кто читает элемент (наблюдатель конца трека,
 *  повторный клик по плитке), сверяется с ним, а не с currentRef.
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
  /** Скорость воспроизведения, ×. Живёт в плеере, а не в профиле настроек:
   *  как и кнопка «1×» в приложении, это состояние сеанса — вернувшись завтра,
   *  человек не должен обнаружить музыку на удвоенной скорости. */
  speed: number;
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
  setSpeed: (v: number) => void;
}

interface PositionCtx {
  position: number;
  duration: number;
}

const Player = createContext<PlayerCtx | null>(null);
const Position = createContext<PositionCtx>({ position: 0, duration: 0 });

const VOLUME_KEY = "muza.web.volume.v1";

/** Действия Media Session, которые страница берёт на себя. Список нужен
 *  ровно для того, чтобы их можно было СНЯТЬ, когда человек выключил
 *  медиаклавиши в настройках. */
const MEDIA_ACTIONS: MediaSessionAction[] = ["play", "pause", "previoustrack", "nexttrack", "seekto"];

/** Позиции треков для «продолжить с места остановки» (те же имя ключа и
 *  правила, что у приложения — apps/desktop/src/lib/resumeStore.ts). */
const RESUME_KEY = "muza.resume.v1";
const RESUME_MAX = 300;
/** Реже 4 с позицию не пишем: тик частый, а localStorage синхронный. */
const RESUME_FLUSH_MS = 4000;

/** Переход без паузы: фейд в доли секунды и такой же ранний прицел. Хвост
 *  текущего трека при этом не звучит — обычно это незаметно, о чём и говорит
 *  подсказка настройки. Длиннее делать нельзя: получится тихий кроссфейд. */
const GAPLESS_FADE_SEC = 0.08;
const GAPLESS_LEAD_SEC = 0.15;
/** Шаг наблюдения за концом трека. timeupdate тикает ~4 Гц — для перехода
 *  без паузы это на порядок грубее нужного. */
const TICK_MS = 40;
/** Не чаще одного прогрева очереди в секунду: лавина запросов на длинном
 *  «сколько треков наготове» никому не помогает. */
const WARM_GAP_MS = 1000;

/** Границы кроссфейда — те же, что у ползунка настроек: значение приходит и из
 *  профиля, собранного в приложении, а не только из нашего ползунка. */
const clampCrossfadeSec = (sec: number) => Math.max(1, Math.min(12, Math.round(sec)));

type ResumeMap = Record<string, number>;

/** Один слот воспроизведения: свой элемент, свой уровень. */
interface Slot {
  el: HTMLAudioElement;
  url: string | null;
  /** ЧЕЙ трек сейчас в элементе. Выводить это из currentRef нельзя: между
   *  кликом и ответом сервера «текущий» уже новый, а звучит ещё старый —
   *  loadTrack до первого await не трогает ни src, ни play(). Вся разница между
   *  «запомнить позицию песни» и «приписать её чужой» — в этом поле. */
  trackId: string | null;
  /** Множитель выравнивания громкости трека, который сейчас в слоте. */
  norm: number;
  /** Доля кроссфейда 0..1 — ею множится уровень слота. */
  fade: number;
  /** Куда досикнуть, когда приедут метаданные («продолжить с места»). */
  seekTo: number | null;
  /** Перевыдачу истёкшего адреса делаем один раз — и НА СЛОТ, а не на плеер:
   *  общий флаг гасил вторую попытку для следующей песни. */
  retried: boolean;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { t } = useT();
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
  const [speed, setSpeedState] = useState(1);

  /** Два слота: активный звучит, второй готовит следующий трек. */
  const slotsRef = useRef<Slot[]>([]);
  const activeRef = useRef(0);
  /** stream-url кэшируется до истечения TTL (минус запас 5 мин) */
  const urlsRef = useRef(new Map<string, { url: string; expiresAt: number }>());
  /** порядок до шаффла — выключение возвращает как было */
  const baseQueueRef = useRef<Track[]>([]);
  /** наиграно текущего трека (для честного скроббла) */
  const playedMsRef = useRef(0);
  const lastTimeRef = useRef(0);
  /** Номер последнего старта: растёт на каждую загрузку трека. Всё, что
   *  вернулось из сети позже своего номера, считается чужим и отбрасывается —
   *  иначе при быстром переборе песен старый ответ подменял источник уже
   *  выбранной. Аналог playSeqRef приложения. */
  const loadSeqRef = useRef(0);
  /** Чьи серверные кэши уже прогреты (по одному заходу на трек). */
  const prefetchedRef = useRef(new Set<string>());
  const warmAtRef = useRef(0);
  /** Трек, который авто-переход УЖЕ завёл во втором слоте: эффект смены
   *  текущего обязан его не перезапускать. */
  const preparedIdRef = useRef<string | null>(null);
  /** С какого трека уже стартовал авто-переход — защита от повторов на тике. */
  const advanceFromRef = useRef<string | null>(null);
  /** Авто-переход в полёте (от запроса адреса до play()). Пока он идёт, конец
   *  текущего трека НЕ должен переключать очередь сам: у перехода без паузы
   *  окно всего 0,15 с, и play() легко приезжает уже после конца — без этого
   *  флага очередь прыгала бы через трек (двойное переключение). */
  const advancingRef = useRef(false);
  /** Трек кончился, пока переход был в полёте: если переход не задастся,
   *  очередь переключит обычным путём эта отметка. */
  const endedDuringAdvanceRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef({ queue, index, repeat, shuffle });
  stateRef.current = { queue, index, repeat, shuffle };
  const { prefs } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Громкость и скорость — в ref: их читают таймеры и слушатели элементов,
   *  подписанные один раз на всё время жизни вкладки. */
  const levelRef = useRef({ volume, muted });
  levelRef.current = { volume, muted };
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const current = index >= 0 ? (queue[index] ?? null) : null;
  const currentRef = useRef<Track | null>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(saved) && saved > 0 && saved <= 1) setVolumeState(saved);
  }, []);

  // ── «Продолжить с места остановки» ───────────────────────────────
  const resumeRef = useRef<ResumeMap | null>(null);
  const resumeDirtyRef = useRef(false);
  const resumeFlushRef = useRef(0);
  const resumeMap = useCallback((): ResumeMap => {
    if (!resumeRef.current) {
      try {
        resumeRef.current = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as ResumeMap;
      } catch {
        resumeRef.current = {};
      }
    }
    return resumeRef.current;
  }, []);
  const flushResume = useCallback(() => {
    const map = resumeRef.current;
    if (!map || !resumeDirtyRef.current) return;
    resumeDirtyRef.current = false;
    let entries = Object.entries(map);
    // грубый LRU: держим последние (порядок вставки объекта сохраняется)
    if (entries.length > RESUME_MAX) {
      entries = entries.slice(-RESUME_MAX);
      resumeRef.current = Object.fromEntries(entries);
    }
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify(resumeRef.current));
    } catch {
      /* квота — не критично */
    }
  }, []);
  const rememberPosition = useCallback(
    (id: string, sec: number) => {
      const map = resumeMap();
      delete map[id]; // переставляем ключ в конец для LRU
      map[id] = Math.floor(sec);
      resumeDirtyRef.current = true;
      const now = Date.now();
      if (now - resumeFlushRef.current < RESUME_FLUSH_MS) return;
      resumeFlushRef.current = now;
      flushResume();
    },
    [flushResume, resumeMap],
  );
  const forgetPosition = useCallback(
    (id: string) => {
      const map = resumeMap();
      if (!(id in map)) return;
      delete map[id];
      resumeDirtyRef.current = true;
      flushResume();
    },
    [flushResume, resumeMap],
  );
  /** С какой секунды заводить трек: правила приложения — не у начала и не у
   *  конца, иначе «продолжение» ощущается как поломка. */
  const startPosition = useCallback(
    (track: Track): number => {
      if (!prefsRef.current.resumePosition) return 0;
      const saved = resumeMap()[track.id] ?? 0;
      return saved > 5 && saved < track.durationSec - 10 ? saved : 0;
    },
    [resumeMap],
  );

  /** Уровень слота = громкость × доля кроссфейда × выравнивание громкости. */
  const applyLevel = useCallback((slot: Slot) => {
    const { volume: v, muted: m } = levelRef.current;
    setSlotLevel(slot.el, (m ? 0 : v) * slot.fade * slot.norm);
  }, []);

  /** Слушатели элементов ставятся ОДИН раз при создании слота, поэтому свежие
   *  обработчики они берут отсюда (иначе замыкание держало бы очередь и язык
   *  на момент создания). */
  const handlersRef = useRef<{
    time: (slot: Slot) => void;
    meta: (slot: Slot) => void;
    play: (slot: Slot) => void;
    pause: (slot: Slot) => void;
    waiting: (slot: Slot) => void;
    playing: (slot: Slot) => void;
    ended: (slot: Slot) => void;
    error: (slot: Slot) => void;
  } | null>(null);

  const slots = useCallback((): Slot[] => {
    if (slotsRef.current.length > 0) return slotsRef.current;
    const make = (): Slot => {
      const el = new Audio();
      el.preload = "auto";
      // ДО первой загрузки: без этого MediaElementSource эквалайзера молча
      // даёт тишину (гоча из десктопного audioEngine)
      el.crossOrigin = "anonymous";
      // Скорость с сохранением тона — «без бурундука» независимо от браузера
      el.preservesPitch = true;
      const slot: Slot = { el, url: null, trackId: null, norm: 1, fade: 1, seekTo: null, retried: false };
      const on = (name: string, pick: (h: NonNullable<typeof handlersRef.current>) => (s: Slot) => void) =>
        el.addEventListener(name, () => {
          const h = handlersRef.current;
          if (h) pick(h)(slot);
        });
      on("timeupdate", (h) => h.time);
      on("loadedmetadata", (h) => h.meta);
      on("durationchange", (h) => h.meta);
      on("play", (h) => h.play);
      on("pause", (h) => h.pause);
      on("waiting", (h) => h.waiting);
      on("playing", (h) => h.playing);
      on("ended", (h) => h.ended);
      on("error", (h) => h.error);
      return slot;
    };
    slotsRef.current = [make(), make()];
    return slotsRef.current;
  }, []);

  const audio = useCallback((): HTMLAudioElement => slots()[activeRef.current].el, [slots]);
  const isActive = useCallback((slot: Slot) => slotsRef.current[activeRef.current] === slot, []);

  /** Освободить слот: элемент замолкает и отпускает буфер. */
  const releaseSlot = useCallback((slot: Slot) => {
    slot.el.pause();
    slot.el.removeAttribute("src");
    slot.el.load();
    slot.url = null;
    slot.trackId = null;
    slot.seekTo = null;
    slot.retried = false;
    slot.fade = 0;
  }, []);

  /** Оборвать кроссфейд немедленно: активный слот на полный уровень, второй
   *  замолкает. Зовётся перед любой новой загрузкой и на паузе — иначе фейд
   *  доигрывал бы поверх только что выбранной песни. */
  const cancelFade = useCallback(() => {
    if (fadeTimerRef.current) {
      clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    const list = slotsRef.current;
    if (list.length === 0) return;
    const act = list[activeRef.current];
    const other = list[1 - activeRef.current];
    act.fade = 1;
    applyLevel(act);
    if (other.url !== null && !other.el.paused) releaseSlot(other);
  }, [applyLevel, releaseSlot]);

  /** Кроссфейд равной мощности: уходящий по cos, входящий по sin. На линейных
   *  кривых стык проседает на 3 дБ (ресёрч движка приложения, отчёт #4). */
  const startFade = useCallback(
    (sec: number) => {
      const list = slotsRef.current;
      const inSlot = list[activeRef.current];
      const outSlot = list[1 - activeRef.current];
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
      const started = performance.now();
      fadeTimerRef.current = setInterval(() => {
        const p = Math.min(1, (performance.now() - started) / (sec * 1000));
        inSlot.fade = Math.sin((p * Math.PI) / 2);
        outSlot.fade = Math.cos((p * Math.PI) / 2);
        applyLevel(inSlot);
        applyLevel(outSlot);
        if (p < 1) return;
        if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
        inSlot.fade = 1;
        applyLevel(inSlot);
        // слот уходящего трека освобождаем, только если он не успел снова
        // стать активным (человек нажал «назад» прямо во время перехода)
        if (slotsRef.current[activeRef.current] !== outSlot) releaseSlot(outSlot);
      }, 20);
    },
    [applyLevel, releaseSlot],
  );

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
      cancelFade();
      // Номер старта. Между строкой ниже и ответом сервера человек успевает
      // нажать следующий трек — и не раз, если щёлкает подряд. Без сверки
      // выходило две беды: ответ на СТАРЫЙ запрос приходил позже нового и
      // подменял источник (играла не та песня, которую выбрали последней), а
      // прерванный load'ом play() писал в консоль «The play() request was
      // interrupted by a new load request» (жалоба владельца 02.08). Приём
      // взят из приложения — там это playSeqRef в usePlayback.
      const seq = ++loadSeqRef.current;
      setError(null);
      setLoading(true);
      setPosition(0);
      setDuration(track.durationSec);
      playedMsRef.current = 0;
      lastTimeRef.current = 0;
      advanceFromRef.current = null;
      preparedIdRef.current = null;
      try {
        const url = await streamUrl(track.id);
        if (loadSeqRef.current !== seq) return; // старт уже не наш — молча уходим
        const list = slots();
        const idle = list[1 - activeRef.current];
        let slot = list[activeRef.current];
        if (idle !== slot && idle.url === url) {
          // Второй слот уже готовил ровно этот трек («Подготовка следующего»):
          // меняем слоты ролями вместо повторной закачки. Роль переставляем
          // ПЕРЕД тишиной уходящего — иначе его событие паузы дошло бы до бара.
          activeRef.current = 1 - activeRef.current;
          releaseSlot(slot);
          slot = idle;
        } else {
          slot.url = url;
          slot.el.src = url;
          slot.el.load();
        }
        const el = slot.el;
        // С этой секунды слот отвечает за НОВУЮ песню: наблюдатель конца трека
        // сверяется именно с этим полем.
        slot.trackId = track.id;
        slot.retried = false;
        el.playbackRate = speedRef.current;
        slot.norm = normFactor(track.loudness, prefsRef.current.normalize);
        slot.fade = 1;
        applyLevel(slot);
        if (el.currentTime > 0) el.currentTime = 0;
        // «Продолжить с места остановки»: точку помнит слот и применяет её,
        // когда приедут метаданные — до них currentTime браузер не примет.
        const from = startPosition(track);
        slot.seekTo = from > 0 ? from : null;
        if (from > 0) setPosition(from);
        // play() ОБЯЗАН пережить обгон: следующий клик сменит src и отклонит это
        // обещание с AbortError. Это не ошибка воспроизведения, а нормальный
        // ход событий — гасим её, но только если старт действительно устарел.
        if (autoplay) {
          try {
            await el.play();
          } catch (e) {
            if (loadSeqRef.current === seq) throw e;
            return;
          }
        }
      } catch (e) {
        if (loadSeqRef.current !== seq) return; // чужая беда, не наша
        // резолв первого запроса может идти десятки секунд — 503 честно скажет
        setError(e instanceof Error ? e.message : t("media.player.errors.playFailed"));
        setLoading(false);
      }
    },
    [applyLevel, cancelFade, releaseSlot, slots, startPosition, streamUrl, t],
  );

  /** Авто-переход с фейдом: следующий трек заводится во ВТОРОМ слоте, пока
   *  первый ещё звучит, после чего слоты меняются ролями. Этим живут и
   *  кроссфейд (секунды), и переход без паузы (доли секунды) — разница только
   *  в длине фейда и в том, за сколько до конца мы стартуем. */
  const advanceWithFade = useCallback(
    async (nextIndex: number, fadeSec: number) => {
      const track = stateRef.current.queue[nextIndex];
      if (!track) return;
      const seq = ++loadSeqRef.current; // тот же инвариант сверки, что у loadTrack
      advancingRef.current = true;
      endedDuringAdvanceRef.current = false;
      /** Конец полёта. handled=false — переход не задался: если трек за это
       *  время успел кончиться, очередь переключаем обычным путём, иначе он
       *  доиграет и это сделает onEnded. */
      const finish = (handled: boolean) => {
        advancingRef.current = false;
        if (!handled && endedDuringAdvanceRef.current) {
          playedMsRef.current = 0;
          setIndex(nextIndex);
        }
        endedDuringAdvanceRef.current = false;
      };
      let url: string;
      try {
        url = await streamUrl(track.id);
      } catch {
        finish(false); // не добыли — трек доиграет сам, дальше обычный переход
        return;
      }
      if (loadSeqRef.current !== seq) {
        finish(true); // старт уже не наш — переключать очередь не нам
        return;
      }
      const list = slots();
      const inSlot = list[1 - activeRef.current];
      if (inSlot.url !== url) {
        inSlot.url = url;
        inSlot.el.src = url;
        inSlot.el.load();
      }
      inSlot.trackId = track.id;
      inSlot.retried = false;
      inSlot.el.playbackRate = speedRef.current;
      inSlot.norm = normFactor(track.loudness, prefsRef.current.normalize);
      inSlot.fade = 0;
      applyLevel(inSlot);
      const from = startPosition(track);
      inSlot.seekTo = from > 0 ? from : null;
      try {
        await inSlot.el.play();
      } catch {
        inSlot.fade = 1;
        finish(false); // не завелось — очередь переключится обычным путём
        return;
      }
      if (loadSeqRef.current !== seq) {
        inSlot.el.pause();
        finish(true);
        return;
      }
      // Уходящий трек считаем доигранным: его остаток тише кроссфейда. Если он
      // успел кончиться сам, за него уже отчитались — второй раз не считаем.
      const prev = endedDuringAdvanceRef.current ? null : currentRef.current;
      if (prev) {
        playedMsRef.current = Math.max(playedMsRef.current, prev.durationSec * 1000 * 0.95);
        scrobble(prev, true);
        forgetPosition(prev.id);
      }
      playedMsRef.current = 0;
      lastTimeRef.current = from;
      activeRef.current = 1 - activeRef.current;
      // Эффект смены текущего увидит эти два указателя и НЕ станет заводить
      // трек заново — он уже звучит во втором слоте.
      preparedIdRef.current = track.id;
      currentRef.current = track;
      startFade(fadeSec);
      setIndex(nextIndex);
      setPosition(from);
      setDuration(track.durationSec);
      finish(true);
    },
    [applyLevel, forgetPosition, scrobble, slots, startPosition, startFade, streamUrl],
  );

  /** Прогрев очереди: дёргаем /stream следующих треков первым байтом — сервер
   *  добывает файл в кэш, ПОКА играет текущий, и «дальше» не платит за yt-dlp
   *  (замер 2026-07-21: холодный резолв 3.5–10с, тёплый ~5мс). Сколько треков
   *  греть — настройка «Треков наготове» (warmAhead). Байты клиенту не
   *  качаются (Range 0-1), заодно кэшируется stream-url — клик не платит и за
   *  RTT токена. По одному треку за заход: длинный список не должен уходить в
   *  сеть лавиной. */
  const warmQueue = useCallback(() => {
    const now = Date.now();
    if (now - warmAtRef.current < WARM_GAP_MS) return;
    const { queue: q, index: i, repeat: r } = stateRef.current;
    const ahead = Math.max(0, Math.min(30, Math.round(prefsRef.current.warmAhead)));
    for (let k = 1; k <= ahead; k++) {
      const at = i + k < q.length ? i + k : r === "all" && q.length > 0 ? (i + k) % q.length : -1;
      const track = at >= 0 ? q[at] : undefined;
      if (!track || track.localHash) continue; // локальные — только на своём устройстве
      if (track.id === currentRef.current?.id || prefetchedRef.current.has(track.id)) continue;
      prefetchedRef.current.add(track.id);
      warmAtRef.current = now;
      void streamUrl(track.id)
        .then((url) => fetch(url, { headers: { Range: "bytes=0-1" } }))
        .catch(() => undefined);
      return;
    }
  }, [streamUrl]);

  /** Наблюдение за концом трека: подготовка следующего, переход с фейдом и
   *  запоминание позиции. Отдельный таймер, а не timeupdate: тот тикает ~4 Гц,
   *  а переходу без паузы нужен прицел в сотые доли секунды. */
  const tick = useCallback(() => {
    const list = slotsRef.current;
    if (list.length === 0) return;
    const slot = list[activeRef.current];
    const el = slot.el;
    if (el.paused || !el.src) return;
    const track = currentRef.current;
    if (!track) return;
    // ⚠️ Элемент и «текущий трек» разъезжаются на всё время резолва следующей
    // песни: клик уже сменил current, а звучит ещё предыдущая. Наблюдателю в
    // этом окне делать нечего — он бы приписал позицию звучащего трека новому
    // («продолжить с места» заводило бы выбранную песню с чужой секунды) и
    // завёл бы авто-переход на трек ПОСЛЕ выбранного, отбросив клик.
    if (slot.trackId !== track.id) return;
    const p = prefsRef.current;
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : track.durationSec;
    if (dur <= 0) return;
    const pos = el.currentTime;
    const remain = dur - pos;

    if (p.resumePosition && pos > 5) rememberPosition(track.id, pos);
    if (pos > 2) warmQueue();

    const { queue: q, index: i, repeat: r } = stateRef.current;
    if (r === "one") return; // повтор одного трека — переходить некуда
    const nextIndex = i + 1 < q.length ? i + 1 : r === "all" && q.length > 1 ? 0 : -1;
    const nextTrack = nextIndex >= 0 ? q[nextIndex] : undefined;
    if (!nextTrack || nextTrack.localHash) return;

    // 1. Подготовка следующего: за столько секунд до конца, сколько просили.
    //    Кладём во второй слот уже добытый адрес — трек начинает буферизоваться
    //    заранее, и стык не ждёт сети.
    if (remain <= p.preloadAheadSec && fadeTimerRef.current === null) {
      const idle = list[1 - activeRef.current];
      const known = urlsRef.current.get(nextTrack.id);
      if (known && idle.url !== known.url) {
        idle.url = known.url;
        idle.el.src = known.url;
        idle.el.load();
      }
    }

    // 2. Переход. Кроссфейд стартует за свою длительность до конца, переход
    //    без паузы — у самого стыка. Один раз на трек (advanceFromRef).
    if (advanceFromRef.current === track.id) return;
    const fadeSec = p.crossfade ? clampCrossfadeSec(p.crossfadeSec) : p.gapless ? GAPLESS_FADE_SEC : 0;
    if (fadeSec <= 0) return;
    const trigger = p.crossfade ? fadeSec : GAPLESS_LEAD_SEC;
    if (remain > trigger) return;
    advanceFromRef.current = track.id;
    void advanceWithFade(nextIndex, fadeSec);
  }, [advanceWithFade, rememberPosition, warmQueue]);

  // Таймер живёт только пока звучит музыка: на паузе следить не за чем.
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(tick, TICK_MS);
    return () => clearInterval(iv);
  }, [playing, tick]);

  // позиция должна пережить закрытие вкладки — дописываем на выгрузке
  useEffect(() => {
    const onHide = () => flushResume();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flushResume]);

  // смена текущего трека → загрузка; скроббл предыдущего — до переключения
  useEffect(() => {
    const prevTrack = currentRef.current;
    // Авто-переход уже завёл этот трек во втором слоте (и сам отчитался за
    // предыдущий) — здесь остаётся только принять его как текущий.
    if (current && preparedIdRef.current === current.id) {
      preparedIdRef.current = null;
      currentRef.current = current;
      return;
    }
    if (prevTrack && prevTrack.id !== current?.id) scrobble(prevTrack, false);
    currentRef.current = current;
    if (current) void loadTrack(current, true);
    else if (slotsRef.current.length > 0) {
      cancelFade();
      for (const slot of slotsRef.current) releaseSlot(slot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Обработчики событий элементов. Пересобираются каждый рендер и живут в ref:
  // слушатели навешаны один раз при создании слота (см. slots()).
  handlersRef.current = {
    time: (slot) => {
      if (!isActive(slot)) return; // уходящий слот кроссфейда — не наша позиция
      const sec = slot.el.currentTime;
      const dt = sec - lastTimeRef.current;
      // только честное воспроизведение: сик даёт dt вне (0, 2с) и не считается
      if (dt > 0 && dt < 2) playedMsRef.current += dt * 1000;
      lastTimeRef.current = sec;
      setPosition(sec);
    },
    meta: (slot) => {
      const el = slot.el;
      const known = Number.isFinite(el.duration) && el.duration > 0;
      // «Продолжить с места»: метаданные приехали — можно ставить точку
      if (slot.seekTo !== null && known) {
        const to = slot.seekTo;
        slot.seekTo = null;
        if (to < el.duration - 10) {
          el.currentTime = to;
          if (isActive(slot)) {
            lastTimeRef.current = to;
            setPosition(to);
          }
        }
      }
      if (known && isActive(slot)) setDuration(el.duration);
    },
    play: (slot) => {
      if (!isActive(slot)) return;
      setPlaying(true);
      setLoading(false);
    },
    pause: (slot) => {
      if (isActive(slot)) setPlaying(false);
    },
    waiting: (slot) => {
      if (isActive(slot)) setLoading(true);
    },
    playing: (slot) => {
      if (isActive(slot)) setLoading(false);
    },
    ended: (slot) => {
      if (!isActive(slot)) return; // хвост уходящего трека кроссфейда
      const el = slot.el;
      const track = currentRef.current;
      if (track) {
        playedMsRef.current = Math.max(playedMsRef.current, track.durationSec * 1000 * 0.95);
        scrobble(track, true);
        playedMsRef.current = 0;
        forgetPosition(track.id);
      }
      // Переход без паузы уже заводит следующий трек: у него окно 0,15 с, и
      // play() вполне может приехать после конца текущего. Очередь тогда ведёт
      // он один — иначе она прыгнула бы через трек.
      if (advancingRef.current) {
        endedDuringAdvanceRef.current = true;
        return;
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
      } else if (prefsRef.current.radioEndless && track && !track.localHash) {
        // Бесконечное радио: каталожная очередь кончилась — продолжаем
        // похожими треками с сервера (политика приложения, Stage 5). Пока
        // сервер думает, бар честно показывает подготовку.
        setLoading(true);
        void getApi()
          .getRadio(track.id)
          .then((more) => {
            const known = new Set(stateRef.current.queue.map((x) => x.id));
            const add = more.filter((x) => !x.localHash && !known.has(x.id));
            if (add.length === 0) {
              setLoading(false);
              setPlaying(false);
              return;
            }
            baseQueueRef.current = [...baseQueueRef.current, ...add];
            setQueue((prev) => [...prev, ...add]);
            setIndex(stateRef.current.index + 1);
          })
          .catch(() => {
            setLoading(false);
            setPlaying(false);
          });
      } else {
        setPlaying(false);
      }
    },
    error: (slot) => {
      if (!isActive(slot)) return;
      const el = slot.el;
      // Чиним ТО, что в слоте, а не то, что в баре: пока летела ошибка, человек
      // мог выбрать другую песню.
      const trackId = slot.trackId;
      if (trackId === null) return;
      // стрим-токен истёк (пауза дольше TTL) — одна перевыдача с возвратом позиции
      if (!slot.retried) {
        slot.retried = true;
        const pos = el.currentTime;
        // ⚠️ Инвариант файла: путь асинхронный и в конце трогает src и play(),
        // значит обязан сверить номер старта. Перевыдача идёт секунды; не
        // дождавшись, человек кликает другую песню — и приехавший ответ
        // возвращал СТАРУЮ: в баре одна, в наушниках другая.
        const seq = loadSeqRef.current;
        void streamUrl(trackId, true)
          .then(async (url) => {
            if (loadSeqRef.current !== seq || slot.trackId !== trackId || !isActive(slot)) return;
            slot.url = url;
            el.src = url;
            el.load();
            el.currentTime = pos;
            await el.play();
          })
          .catch(() => {
            if (loadSeqRef.current !== seq) return; // чужая беда, не наша
            setLoading(false);
            setPlaying(false);
            setError(t("media.player.errors.trackFetchFailed"));
          });
        return;
      }
      setLoading(false);
      setPlaying(false);
      setError(t("media.player.errors.trackFetchFailed"));
    },
  };

  // громкость — на оба слота: во время кроссфейда звучат оба
  useEffect(() => {
    for (const slot of slotsRef.current) applyLevel(slot);
  }, [applyLevel, volume, muted]);

  // Выравнивание громкости включают и выключают на ходу — пересчитываем
  // множитель играющего трека сразу, чтобы разницу было слышно.
  useEffect(() => {
    const list = slotsRef.current;
    if (list.length === 0 || !currentRef.current) return;
    const slot = list[activeRef.current];
    slot.norm = normFactor(currentRef.current.loudness, prefs.normalize);
    applyLevel(slot);
  }, [applyLevel, prefs.normalize]);

  // Эквалайзер: цепь строится по включению (жест уже был — тумблер/плей),
  // выключенный EQ = полосы в 0 (цепь не разбирается, см. audioFx)
  useEffect(() => {
    const list = slotsRef.current;
    if (list.length === 0) return;
    if (prefs.eqOn) {
      let ok = true;
      for (const slot of list) ok = ensureChain(slot.el) && ok;
      if (ok) {
        setEqBands(prefs.eqBands, true);
        // с этого момента уровень идёт через гейн — переставляем его заново
        for (const slot of list) applyLevel(slot);
      }
    } else if (eqAttached()) {
      setEqBands(prefs.eqBands, false);
    }
  }, [applyLevel, prefs.eqOn, prefs.eqBands]);

  const playContext = useCallback(
    (tracks: Track[], startIndex: number) => {
      const playable = tracks.filter((tr) => !tr.localHash); // локальные — только на своём устройстве
      if (playable.length === 0) return;
      const list = slots();
      // клик — это жест: момент завести AudioContext, если EQ включён в prefs
      if (prefsRef.current.eqOn) {
        let ok = true;
        for (const slot of list) ok = ensureChain(slot.el) && ok;
        if (ok) {
          setEqBands(prefsRef.current.eqBands, true);
          for (const slot of list) applyLevel(slot);
        }
      }
      const start = Math.max(
        playable.findIndex((tr) => tr.id === tracks[startIndex]?.id),
        0,
      );
      const el = list[activeRef.current].el;
      // Повторный клик по тому, что уже играет, — это «поставь на паузу», а не
      // «начни сначала». Правило приложения (usePlayback.playContext): совпали и
      // очередь, и трек — зовём toggle и уходим. В вебе этого не было, и человек,
      // нажав на ту же плитку в «В тренде», получал перезапуск с нуля вместо
      // паузы (жалоба владельца 02.08). Очередь сверяем целиком: та же песня из
      // ДРУГОЙ подборки — это новый контекст, её надо заводить заново.
      const q = stateRef.current.queue;
      const sameQueue = playable.length === q.length && playable.every((tr, i) => tr.id === q[i]?.id);
      if (sameQueue && currentRef.current?.id === playable[start]?.id && el.src) {
        if (el.paused) void el.play().catch(() => undefined);
        else {
          cancelFade();
          el.pause();
        }
        return;
      }
      baseQueueRef.current = playable;
      setShuffle(false);
      setQueue(playable);
      // Тот же трек, но очередь сменилась: эффект смены текущего не сработает
      // (id не изменился) — заводим сами, с начала.
      const sameTrack = currentRef.current?.id === playable[start]?.id;
      setIndex(start);
      if (sameTrack && el.src) {
        cancelFade();
        advanceFromRef.current = null;
        el.currentTime = 0;
        void el.play().catch(() => undefined);
      }
    },
    [applyLevel, cancelFade, slots],
  );

  const toggle = useCallback(() => {
    const el = audio();
    if (el.paused) void el.play().catch(() => undefined);
    else {
      // пауза посреди перехода: доигрываем фейд мгновенно, иначе второй слот
      // остался бы звучать под «паузой»
      cancelFade();
      el.pause();
    }
  }, [audio, cancelFade]);

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
      cancelFade();
      advanceFromRef.current = null;
      el.currentTime = 0;
      setPosition(0);
    } else {
      setIndex(i - 1);
    }
  }, [audio, cancelFade]);

  const seek = useCallback(
    (sec: number) => {
      const el = audio();
      el.currentTime = sec;
      lastTimeRef.current = sec;
      // отмотали назад — переход к следующему треку снова впереди
      advanceFromRef.current = null;
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

  /** Скорость — обоим слотам сразу: следующий трек кроссфейда обязан звучать
   *  так же, как текущий. preservesPitch каждый раз заново — страховка на
   *  случай, если элемент пересоздадут. */
  const setSpeed = useCallback((v: number) => {
    const clamped = Math.min(4, Math.max(0.25, v));
    setSpeedState(clamped);
    for (const slot of slotsRef.current) {
      slot.el.preservesPitch = true;
      slot.el.playbackRate = clamped;
    }
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((was) => {
      const on = !was;
      const cur = currentRef.current;
      if (on) {
        // текущий остаётся на месте, хвост перемешивается
        const rest = baseQueueRef.current.filter((tr) => tr.id !== cur?.id);
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
        setIndex(cur ? Math.max(base.findIndex((tr) => tr.id === cur.id), 0) : -1);
      }
      return on;
    });
  }, []);

  // Media Session: метаданные и кнопки на клавиатурах/локскринах.
  //
  // Это и есть «Медиаклавиши» из настроек: снял настройку — обработчиков нет,
  // и кнопка «пауза» на клавиатуре достаётся другому проигрывателю, а плашка
  // управления в системе перестаёт показывать Muza. Приложение поступает так
  // же (apps/desktop useMediaSession с тем же prefs.mediaKeys), поэтому ряд
  // настроек один на обе программы.
  //
  // Обработчики СНИМАЮТСЯ явно, а не «просто не ставятся»: они живут на
  // сеансе браузера, и без этого выключенная настройка продолжала бы работать
  // до перезагрузки страницы.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!prefs.mediaKeys) {
      ms.metadata = null;
      for (const action of MEDIA_ACTIONS) ms.setActionHandler(action, null);
      return;
    }
    if (current) {
      ms.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        artwork: current.coverUrl ? [{ src: current.coverUrl, sizes: "512x512" }] : [],
      });
    }
    // Кнопки системы обращаются к АКТИВНОМУ слоту: во время перехода играет
    // уже второй элемент, и «пауза» обязана остановить именно его.
    ms.setActionHandler("play", () => void slotsRef.current[activeRef.current]?.el.play());
    ms.setActionHandler("pause", () => slotsRef.current[activeRef.current]?.el.pause());
    ms.setActionHandler("previoustrack", prev);
    ms.setActionHandler("nexttrack", next);
    ms.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) seek(d.seekTime);
    });
  }, [current, next, prev, seek, prefs.mediaKeys]);

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
      speed,
      playContext,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      cycleRepeat,
      toggleShuffle,
      setSpeed,
    }),
    [queue, index, current, playing, loading, error, volume, muted, repeat, shuffle, speed,
     playContext, toggle, next, prev, seek, setVolume, toggleMute, cycleRepeat, toggleShuffle, setSpeed],
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
