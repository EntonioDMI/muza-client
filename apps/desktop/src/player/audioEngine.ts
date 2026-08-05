/** Аудио-движок Stage 3: два <audio>-слота (кроссфейд и преднагрузка
 *  следующего трека) → Web Audio-граф (пер-слотовый гейн = фейд × нормализация
 *  лаудности → преамп → общий 10-полосный EQ → мастер-громкость → лимитер).
 *
 *  Вывод на устройства (2026-07-22): после analyser сигнал может ветвиться на
 *  «тапы» — по одному на выбранное устройство (gain → MediaStreamDestination →
 *  скрытый <audio> c setSinkId). Пустые маршруты = граф как раньше. Отдельный
 *  <audio> Muza Wrapped (wrappedAmbient.ts) вне графа — маршрутизация его
 *  сознательно не трогает. Спайк/гочи WebView2 — docs/notes/2026-07-22.
 *
 *  Gain staging (ресёрч 2026-07-12, отчёт #9): преамп ПЕРЕД EQ даёт хедрум под
 *  буст полос (авто = −макс.положительный гейн, приём Wavelet), лимитер ПОСЛЕ
 *  мастера — страховка от клиппинга (буст EQ + буст нормализации лаудности
 *  вместе легко выходят за 0 dBFS). Так «буст полос клиппит» больше не случается.
 *
 *  Предгрев (2026-08-06): граф строится не первым play(), а первым ЖЕСТОМ
 *  человека — noteUserGesture()/prewarm(), подробности в блоке перед классом.
 *
 *  Fallback «plain»: MediaElementSource без CORS-чистого источника выдаёт
 *  тишину — перед постройкой графа источник проверяется fetch-пробой; если
 *  CORS не прошёл, играем элементами напрямую (без EQ и буста нормализации).
 *
 *  i18n (эпик W5, T-media): класс не React и не подписан на LanguageProvider —
 *  сообщения об ошибках переводятся через функцию `t`, которую владелец
 *  (usePlayback.ts) передаёт вторым параметром конструктора — там же и живёт
 *  prefs.language, см. `translate(prefs.language, key, params)`, как решал
 *  T31 для App.tsx (не-React вызов чистой translate() вместо хука useT()). */
import { DEFAULT_LANG, translate, type TParams, type TranslationKey } from "../i18n";

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
/** Целевая integrated loudness для нормализации (стриминговый стандарт). */
const TARGET_LUFS = -14;

const dbToLin = (db: number) => Math.pow(10, db / 20);
/** Перцептивная кривая громкости: слайдер 0–100 → квадрат. */
const volCurve = (vol: number) => Math.pow(Math.max(0, Math.min(100, vol)) / 100, 2);

/** Equal-power кривые кроссфейда (ресёрч, отчёт #4): linear даёт −3 дБ провал
 *  на стыке разных треков; sin/cos держат суммарную мощность постоянной. */
const XFADE_STEPS = 128;
const XFADE_OUT = new Float32Array(XFADE_STEPS); // 1→0
const XFADE_IN = new Float32Array(XFADE_STEPS); // 0→1
for (let i = 0; i < XFADE_STEPS; i++) {
  const t = i / (XFADE_STEPS - 1);
  XFADE_OUT[i] = Math.cos((t * Math.PI) / 2);
  XFADE_IN[i] = Math.sin((t * Math.PI) / 2);
}
/** Масштабированная копия кривой (setValueCurveAtTime берёт абсолютные значения). */
const scaledCurve = (base: Float32Array, factor: number): Float32Array => {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) out[i] = base[i] * factor;
  return out;
};

interface Slot {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
  /** Множитель нормализации текущего трека слота (фейды рампят к нему). */
  norm: number;
  url: string | null;
}

/** Маршрут вывода на конкретное устройство (фича «вывод на устройства»).
 *  volume 0–100 — громкость устройства, НЕЗАВИСИМАЯ от слайдера приложения;
 *  followsMaster — устройство дополнительно ведётся слайдером приложения
 *  (основные наушники), без него — нет (виртуальный кабель «в микрофон»). */
export interface OutputRoute {
  deviceId: string;
  volume: number;
  followsMaster?: boolean;
  /** Подмешивать голос с микрофона в это устройство (v2, сценарий саундпада). */
  mixMic?: boolean;
}

/** Конфиг голоса (v2): какой микрофон и с какой громкостью подмешивать.
 *  deviceId null = системный микрофон по умолчанию. */
export interface MicConfig {
  deviceId: string | null;
  /** 0–100, та же перцептивная кривая, что у остальных громкостей. */
  gain: number;
}

/** Тап фан-аута: ответвление финального сигнала на одно устройство.
 *  analyser → gain (громкость устройства) → MediaStreamAudioDestinationNode →
 *  скрытый <audio> с setSinkId(deviceId). Все тапы кормятся ОДНИМ analyser —
 *  выходы взаимно синхронны (нет эха между наушниками и кабелем). */
interface OutputTap {
  deviceId: string;
  gain: GainNode;
  dest: MediaStreamAudioDestinationNode;
  el: HTMLAudioElement;
  /** setSinkId+play прошли — тап реально звучит (до того gain держится в 0). */
  ok: boolean;
}

export interface EngineCallbacks {
  onTime: (sec: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  /** 'playing' активного слота — звук реально пошёл (телеметрия «клик→звук»,
   *  И3 2026-07-22). Опционален: тесты и старые вызовы не обязаны слушать. */
  onPlaying?: () => void;
}

/* ── Предгрев графа по первому жесту (2026-08-06) ─────────────────────────
 *
 *  ЗАЧЕМ. play() сперва ждал ensureGraph(url) и только потом присваивал el.src:
 *  пока не создан AudioContext, десять биквадов EQ, компрессор, анализатор на
 *  2048 точек и два MediaElementSource — элемент <audio> НЕ КАЧАЕТ НИ БАЙТА.
 *  Первый трек сессии платил это целиком (жалоба владельца «первый трек после
 *  запуска приложения особенно долгий»); дальше граф уже есть, и цена нулевая.
 *  Заранее строится ВСЁ, кроме MediaElementSource: он — и есть выбор
 *  webaudio/plain, а его делает CORS-проба, которой нужен URL (см. ensureGraph).
 *
 *  ПОЧЕМУ ЖЕСТ, А НЕ СТАРТ ПРИЛОЖЕНИЯ — три причины:
 *  1) контекст, созданный ДО всякой активации, политика автовоспроизведения
 *     запустить не даст вовсе: он останется suspended, пока не случится жест, и
 *     открытие аудио-устройства (те самые десятки мс) всё равно уехало бы на
 *     путь play() — то есть туда, откуда мы его и убираем;
 *  2) приостановленный контекст отпускает аудио-устройство ОС. ⚠️ Именно
 *     отпускает, а не «не будит»: `new AudioContext()` устройство как раз
 *     открывает — иначе suspend() был бы не нужен, — и на первом pointerdown
 *     сессии оно открывается и тиком позже гасится. Это осознанный размен;
 *  3) между pointerdown и play() лежат секунды добычи — граф успевает
 *     построиться в это окно бесплатно.
 *
 *  ПОЧЕМУ СОСТОЯНИЕ МОДУЛЬНОЕ, А НЕ ПОЛЕ КЛАССА. На ПЕРВОМ клике сессии движка
 *  ещё не существует: usePlayback создаёт AudioEngine лениво, уже ВНУТРИ
 *  startAt — то есть в момент pointerdown адресовать предгрев некому. Поэтому
 *  жест собирает цепь прямо здесь и паркует её, а родившийся движок забирает
 *  готовое (buildGraph). Через поле класса это не выразить: парковать надо
 *  раньше, чем появится сам объект. И это не педантизм: положи сборку в
 *  конструктор движка — она просто переедет из play() в клик, оставшись на том
 *  же пути «клик → звук». Уйти с него она может только ДО клика, то есть в
 *  pointerdown, где движка ещё нет. */
interface GraphNodes {
  eq: BiquadFilterNode[];
  preamp: GainNode;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
}

let parked: { ctx: AudioContext; nodes: GraphNodes } | null = null;
let gestureSeen = false;
let liveEngine: AudioEngine | null = null;

/** Сборка и разводка узлов — ЕДИНСТВЕННОЕ место, где описана цепь. Вынесена из
 *  класса потому, что предгрев строит её до появления движка (см. блок выше);
 *  всё, что зависит от состояния движка (громкость, полосы EQ), доливается
 *  снаружи — в buildGraph. */
function makeGraphNodes(ctx: AudioContext): GraphNodes {
  // EQ-цепь: shelf по краям, peaking в середине
  const eq = EQ_FREQS.map((freq, i) => {
    const f = ctx.createBiquadFilter();
    f.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
    f.frequency.value = freq;
    if (f.type === "peaking") f.Q.value = 1.1;
    f.gain.value = 0;
    return f;
  });
  for (let i = 0; i < eq.length - 1; i++) eq[i].connect(eq[i + 1]);
  // Преамп ПЕРЕД EQ: точка микса обоих слотов + хедрум под буст полос
  const preamp = ctx.createGain();
  preamp.connect(eq[0]);
  const master = ctx.createGain();
  eq[eq.length - 1].connect(master);
  // Лимитер ПОСЛЕ мастера (последний перед выходом): страховка от клиппинга
  // при бусте EQ + бусте нормализации. Не true-peak (нет lookahead/oversampling),
  // но ловит явный клип; апгрейд до AudioWorklet-brickwall — если услышим pumping.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; // dBFS
  limiter.knee.value = 0; // жёсткое колено
  limiter.ratio.value = 20; // ≈ лимитер
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  master.connect(limiter);
  // Визуализатор (Stage 6): analyser в конце цепи — видит финальный сигнал,
  // как его слышит юзер (после EQ, нормализации и лимитера)
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  // T14: 0.82 давал вялый, «нежёсткий» отклик баров — 0.7 живее, но не дёрганый.
  analyser.smoothingTimeConstant = 0.7;
  limiter.connect(analyser);
  analyser.connect(ctx.destination);
  return { eq, preamp, master, limiter, analyser };
}

/** Человек коснулся окна. Зовёт useWarmer: практически всегда — одноразовым
 *  слушателем на window в фазе захвата (он приходит первым), и вторым, уже
 *  бесполезным, дублем из pointerdown строки трека. Первый вызов строит граф
 *  заранее, остальные — no-op: повторный жест ничего не пересоздаёт. Тих там,
 *  где Web Audio нет вовсе. */
export function noteUserGesture(): void {
  if (gestureSeen) return;
  gestureSeen = true;
  if (liveEngine) {
    void liveEngine.prewarm();
    return;
  }
  if (typeof AudioContext === "undefined") return; // jsdom / окружение без Web Audio
  try {
    const ctx = new AudioContext();
    parked = { ctx, nodes: makeGraphNodes(ctx) };
    // Гасим немедленно: контекст, созданный по жесту, рождается running и
    // держал бы поток WASAPI всё время до первого трека (причина 2 выше).
    void ctx.suspend().catch(() => {});
  } catch {
    parked = null; // нет аудио-устройства — обычный путь построит граф сам
  }
}

/** Только для тестов: забыть жест, припаркованный граф и «живой» движок.
 *  Состояние модульное — без сброса тесты подтекали бы друг в друга. */
export function resetPrewarmForTests(): void {
  parked = null;
  gestureSeen = false;
  liveEngine = null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private slots: Slot[] = [];
  private active = 0;
  private eq: BiquadFilterNode[] = [];
  private preamp: GainNode | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private mode: "unknown" | "webaudio" | "plain" = "unknown";
  /** Предгрев в полёте (prewarm). ensureGraph ОБЯЗАН его дождаться: иначе
   *  первый play(), пришедший в середине предгрева, построил бы второй
   *  AudioContext поверх строящегося — два выхода на одно устройство. */
  private warmup: Promise<void> | null = null;

  // ── Вывод на устройства (2026-07-22) ─────────────────────────────
  /** Желаемые маршруты (уже сопоставленные с живыми устройствами —
   *  outputDevices.resolveRoutes). Пусто = системный выход, граф как раньше. */
  private routes: OutputRoute[] = [];
  private taps: OutputTap[] = [];
  /** analyser → ctx.destination подключён (истинно, пока нет живых тапов). */
  private defaultOut = true;
  /** Серийная очередь реконсиляций тапов: setSinkId/play асинхронны, а
   *  setOutputs может прилетать чаще (слайдеры) — без очереди интерливинг
   *  двух реконсиляций плодил бы тапы-сироты. */
  private tapWork: Promise<void> = Promise.resolve();
  // Голос (v2): один захват микрофона на движок, подмешивается в dest тапов
  // с mixMic МИМО tap.gain (громкость музыки не трогает голос) и мимо мастера.
  private micCfg: MicConfig = { deviceId: null, gain: 100 };
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGain: GainNode | null = null;
  private micTaps = new Set<OutputTap>();

  /** Слот, в котором доигрывает УХОДЯЩИЙ трек кроссфейда, и таймер его уборки.
   *  Почему это отдельное поле, а не «второй слот»: кривая громкости уходящего
   *  живёт на часах AudioContext и не связана с воспроизведением элемента —
   *  пауза активного слота уходящий не трогала вообще, и он честно доигрывал
   *  свою кривую целиком. На ползунке кроссфейда 8–12с это до двенадцати секунд
   *  музыки после нажатия «пауза» (аудит 2026-08-03). Все переходы, обрывающие
   *  стык (pause/seek/stop/новый play), обязаны звать dropFading(). */
  private fading: Slot | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  private volume = 64;
  private speed = 1;
  private eqOn = false;
  private eqBands: number[] = EQ_FREQS.map(() => 0);

  constructor(
    private readonly cb: EngineCallbacks,
    /** Перевод ошибок движка (см. шапку файла); опционален для тестов/старых
     *  вызовов — без него ошибки остаются на английском (DEFAULT_LANG). */
    private readonly t: (key: TranslationKey, params?: TParams) => string = (key, params) =>
      translate(DEFAULT_LANG, key, params),
  ) {
    liveEngine = this;
    // Жест уже был, а движок родился только сейчас — это и есть первый клик
    // сессии (pointerdown → startAt → new AudioEngine → секунды добычи →
    // play()). Греемся немедленно, чтобы постройка легла на окно добычи.
    if (gestureSeen) void this.prewarm();
  }

  private makeSlot(): Slot {
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous"; // asset-протокол отвечает CORS-заголовками
    // Скорость с сохранением тона: preservesPitch по умолчанию true, но выставляем
    // явно — гарантия «без бурундука» независимо от версии WebView2 (Chromium WSOLA)
    el.preservesPitch = true;
    // В DOM (скрыто): видно в инспекторе/тестах, и WebView стабильнее держит элемент
    el.style.display = "none";
    el.dataset.muzaSlot = String(document.querySelectorAll("audio[data-muza-slot]").length);
    document.body.appendChild(el);
    const slot: Slot = { el, source: null, gain: null, norm: 1, url: null };
    el.addEventListener("timeupdate", () => {
      if (this.slots[this.active] === slot) this.cb.onTime(el.currentTime);
    });
    el.addEventListener("playing", () => {
      if (this.slots[this.active] === slot) this.cb.onPlaying?.();
    });
    el.addEventListener("ended", () => {
      if (this.slots[this.active] === slot) this.cb.onEnded();
    });
    el.addEventListener("error", () => {
      if (this.slots[this.active] === slot && slot.url) {
        this.cb.onError(this.t("media.player.errors.playFailed"));
      }
    });
    return slot;
  }

  /** Определить режим (webaudio/plain) по CORS-пробе первого источника и
   *  ДОСТРОИТЬ граф под этот режим. Зовётся при первом воспроизведении.
   *
   *  Сам граф к этому моменту обычно уже построен предгревом (prewarm по
   *  первому жесту) — здесь остаётся только то, что без URL решить нельзя:
   *  подключение слотов через MediaElementSource, то есть выбор webaudio/plain.
   *
   *  Свои протоколы пробе НЕ подвергаются (И3 2026-07-22): asset.localhost и
   *  muza-stream.localhost отдают CORS-заголовки НА КАЖДОМ ответе (инвариант
   *  engine.rs, «CORS обязателен»), а проба до них — лишний последовательный
   *  round-trip ПЕРЕД первым звуком сессии; для живого muza-stream она к тому
   *  же дожидалась первых байт закачки, удваивая ожидание. Замер 22.07:
   *  первый трек сессии платил её целиком. Чужие url (если появятся) — проба
   *  как раньше: webaudio с не-CORS источником молчит навсегда, угадывать
   *  нельзя. */
  private async ensureGraph(probeUrl: string): Promise<void> {
    // Предгрев мог быть запущен первым жестом — дожидаемся его ДО проверки
    // режима: иначе построим второй контекст поверх строящегося (см. warmup).
    if (this.warmup) await this.warmup;
    if (this.mode !== "unknown") return;
    let corsOk = /^https?:\/\/(asset|muza-stream)\.localhost(?::\d+)?\//.test(probeUrl);
    if (!corsOk) {
      try {
        const res = await fetch(probeUrl, { headers: { Range: "bytes=0-1" } });
        corsOk = res.ok || res.status === 206;
      } catch {
        corsOk = false;
      }
    }
    if (this.slots.length === 0) {
      this.slots = [this.makeSlot(), this.makeSlot()];
    }
    if (!corsOk) {
      this.mode = "plain";
      // Предгретый граф не пригодился. Слоты к нему подключены ещё не были
      // (это делается ниже, уже зная ответ пробы) — сносим целиком, иначе
      // контекст висел бы suspended до конца сессии, ничего не проигрывая.
      this.discardGraph();
      return;
    }
    this.mode = "webaudio";
    if (!this.ctx) {
      try {
        this.buildGraph();
      } catch {
        // Web Audio недоступен (нет AudioContext, нет устройства) — играем
        // элементами напрямую: без EQ и нормализации, но играем.
        this.mode = "plain";
        this.discardGraph();
        return;
      }
    }
    const ctx = this.ctx;
    const preamp = this.preamp;
    if (!ctx || !preamp) {
      this.mode = "plain";
      this.discardGraph();
      return;
    }
    for (const slot of this.slots) {
      slot.source = ctx.createMediaElementSource(slot.el);
      slot.gain = ctx.createGain();
      slot.gain.gain.value = 0;
      slot.source.connect(slot.gain);
      slot.gain.connect(preamp);
    }
    // Маршруты вывода могли быть заданы ДО постройки графа (prefs применяются
    // при монтировании) — догоняем. Реконсиляция идемпотентна: тапы, поднятые
    // предгревом, не пересоздаются.
    if (this.routes.length > 0) this.queueTapReconcile();
  }

  /** Построить граф ЗАРАНЕЕ — до того, как станет известен URL трека (зачем и
   *  почему по жесту — блок «Предгрев графа по первому жесту» выше).
   *  Идемпотентен: повторные вызовы отдают тот же промис и ничего не
   *  пересоздают. Там, где Web Audio нет (jsdom, окружение без устройства), —
   *  тихо ничего не делает и НЕ бросает: предгрев не имеет права ломать старт.
   *
   *  ⚠️ Слоты к графу здесь НЕ подключаются. createMediaElementSource — это уже
   *  решение «webaudio или plain», а принимает его CORS-проба в ensureGraph,
   *  когда URL наконец известен: подключить раньше значило бы рискнуть вечной
   *  тишиной на не-CORS источнике (см. шапку файла, fallback «plain»). */
  prewarm(): Promise<void> {
    if (this.warmup) return this.warmup;
    if (this.mode !== "unknown" || this.ctx) return Promise.resolve();
    this.warmup = this.buildAhead();
    return this.warmup;
  }

  private async buildAhead(): Promise<void> {
    // Слоты от режима не зависят — их можно завести заранее вместе с графом.
    if (this.slots.length === 0) this.slots = [this.makeSlot(), this.makeSlot()];
    if (!parked && typeof AudioContext === "undefined") return;
    try {
      this.buildGraph();
    } catch {
      this.discardGraph(); // не построился — ensureGraph решит сам, как играть
      return;
    }
    // Приостановку ЗАПУСКАЕМ, но не ждём: `warmup` — это промис, которого ждёт
    // ensureGraph, а значит и play(). Ожидание приостановки внутри него клало на
    // путь «клик → звук» ровно ту задержку, которую предгрев снимает. Порядок
    // suspend/resume гарантирует сама платформа: операции над контекстом
    // выполняются в порядке вызова, и подъём из play() придёт после.
    void this.ctx?.suspend().catch(() => {});
    // Маршруты вывода (setSinkId, getUserMedia) — тоже цена первого клика:
    // раз уж мы внутри жеста, поднимаем тапы здесь же.
    if (this.routes.length > 0) this.queueTapReconcile();
  }

  /** Забрать граф себе — всё, что НЕ зависит от URL. Цепь либо уже собрана
   *  первым жестом и припаркована (обычный случай), либо собирается прямо
   *  здесь (жеста не было: тесты, программный старт). Слоты подключает
   *  ensureGraph, когда проба ответит про CORS. */
  private buildGraph(): void {
    let built = parked;
    parked = null;
    if (!built) {
      const ctx = new AudioContext();
      built = { ctx, nodes: makeGraphNodes(ctx) };
    }
    this.ctx = built.ctx;
    this.eq = built.nodes.eq;
    this.preamp = built.nodes.preamp;
    this.master = built.nodes.master;
    this.limiter = built.nodes.limiter;
    this.analyserNode = built.nodes.analyser;
    // Состояние движка на готовую цепь доливаем здесь: жест собирал её, ещё не
    // зная ни громкости, ни полос эквалайзера этого движка.
    this.master.gain.value = volCurve(this.volume);
    this.applyEq();
  }

  /** Снести граф: он не пригодился (проба сказала «plain») или не достроился.
   *  Контекст ЗАКРЫВАЕМ — предгретый и брошенный, он иначе висел бы suspended
   *  до конца сессии, держа за собой узлы и тапы. */
  private discardGraph(): void {
    const ctx = this.ctx;
    for (const tap of [...this.taps]) this.destroyTap(tap);
    this.stopMic();
    this.eq = [];
    this.preamp = null;
    this.master = null;
    this.limiter = null;
    this.analyserNode = null;
    this.defaultOut = true;
    this.ctx = null;
    if (!ctx) return;
    try {
      (ctx as { close?: () => Promise<void> }).close?.()?.catch(() => {});
    } catch {
      /* контекст уже закрыт или не умеет close — терять нечего */
    }
  }

  // ── Вывод на устройства: фан-аут финального сигнала ──────────────
  // Известное ограничение (отчёт P, ресёрч Chromium/WebView2 2026-07-22):
  // дрейф часов между двумя аудио-устройствами браузер НЕ компенсирует —
  // ~180 мс/час при типичных 50 ppm разницы кварцев. На двух независимых
  // тапах (наушники + кабель) это через час-полтора уже слышимый рассинхрон;
  // чинится это ресэмплингом по общим часам, которого у Web Audio API нет —
  // не чинится на этом уровне, это потолок платформы, не баг движка.

  /** Задать маршруты вывода. Пустой массив — вернуться к системному выходу.
   *  Безопасно звать до постройки графа (запомним и применим в предгреве или в
   *  ensureGraph — смотря что случится раньше)
   *  и сколь угодно часто (реконсиляции сериализованы). В plain-режиме
   *  маршрутизация недоступна — молча остаёмся на системном выходе. */
  setOutputs(routes: OutputRoute[]): void {
    this.routes = routes;
    if (!this.ctx || !this.analyserNode) return;
    this.queueTapReconcile();
  }

  private queueTapReconcile(): void {
    this.tapWork = this.tapWork.then(() => this.reconcileTaps()).catch(() => {});
  }

  private async reconcileTaps(): Promise<void> {
    const ctx = this.ctx;
    const analyser = this.analyserNode;
    if (!ctx || !analyser) return;
    // 1) убрать тапы устройств, которых больше нет в маршрутах
    for (const tap of [...this.taps]) {
      if (!this.routes.some((r) => r.deviceId === tap.deviceId)) this.destroyTap(tap);
    }
    // 2) создать недостающие
    for (const route of this.routes) {
      if (this.taps.some((t) => t.deviceId === route.deviceId)) continue;
      const gain = ctx.createGain();
      gain.gain.value = 0; // до успешного setSinkId — тишина (не дублить в дефолт)
      const dest = ctx.createMediaStreamDestination();
      analyser.connect(gain);
      gain.connect(dest);
      const el = new Audio();
      el.dataset.muzaTap = route.deviceId.slice(0, 10); // видно в инспекторе
      el.style.display = "none";
      document.body.appendChild(el);
      el.srcObject = dest.stream;
      const tap: OutputTap = { deviceId: route.deviceId, gain, dest, el, ok: false };
      this.taps.push(tap);
      try {
        await el.setSinkId(route.deviceId);
        // Читаем sinkId ОБРАТНО (отчёт P): на «устройство пропало между
        // enumerateDevices и setSinkId» Chromium не всегда бросает — спека
        // требует no-op/reject, реальность иногда молча падает на дефолт.
        // Без сверки тап считался бы живым (tap.ok=true) и тихо дублировал
        // бы дефолтный выход под видом выбранного устройства.
        if (el.sinkId !== route.deviceId) {
          throw new Error(`setSinkId не применился (устройство пропало?): ${route.deviceId}`);
        }
        await el.play();
        tap.ok = true;
      } catch {
        // устройство пропало/отказало — тап выпадает; маршрут остаётся в
        // prefs, вернётся вместе с устройством (resolveRoutes + devicechange)
        this.destroyTap(tap);
      }
    }
    // 3) системный выход: подключён ⇔ нет ни одного живого тапа. Все тапы
    // отказали при непустых маршрутах → остаёмся на дефолте (страховка от
    // полной тишины), а не глушим юзера.
    const live = this.taps.filter((t) => t.ok);
    const wantDefault = live.length === 0;
    if (wantDefault !== this.defaultOut) {
      if (wantDefault) analyser.connect(ctx.destination);
      else analyser.disconnect(ctx.destination);
      this.defaultOut = wantDefault;
    }
    this.applyOutputLevels();
    // 4) голос (v2) — после тапов: множество mixMic-получателей могло измениться
    await this.reconcileMic();
  }

  /** Задать микрофон и громкость голоса. Смена устройства пересоздаёт захват
   *  (если он жив); громкость применяется мгновенно. */
  setMicConfig(cfg: MicConfig): void {
    const deviceChanged = cfg.deviceId !== this.micCfg.deviceId;
    this.micCfg = cfg;
    if (this.micGain) this.micGain.gain.value = volCurve(cfg.gain);
    if (deviceChanged && this.micStream) this.stopMic();
    if (this.ctx) this.queueTapReconcile();
  }

  /** Захват микрофона жив ⇔ есть живой тап с mixMic. Голос идёт в dest тапа
   *  напрямую (мимо tap.gain и мастера): его уровень — только micGain.
   *  Отказ микрофона (занят/пропал) НЕ валит музыку — просто без голоса. */
  private async reconcileMic(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const want = this.taps.filter((t) => t.ok && this.routes.find((r) => r.deviceId === t.deviceId)?.mixMic);
    if (want.length === 0) {
      this.stopMic();
      return;
    }
    if (!this.micStream) {
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: this.micConstraints(this.micCfg.deviceId) });
        } catch {
          // выбранный микрофон пропал/занят — пробуем системный по умолчанию
          // (те же констрейнты: AEC/NS/AGC вырезают голос НЕЗАВИСИМО от того,
          // какое физическое устройство их применяет)
          stream = await navigator.mediaDevices.getUserMedia({ audio: this.micConstraints(null) });
        }
        // ⚠️ ГРАФ МОГ УМЕРЕТЬ, ПОКА ВИСЕЛ СИСТЕМНЫЙ ЗАПРОС РАЗРЕШЕНИЯ. Это окно —
        // секунды: пользователь читает диалог, а `discardGraph()` в это время
        // сносит цепь (проба сказала «plain») и зовёт `stopMic()`, который видит
        // `micStream === null` и не гасит ничего. Прилетевший следом поток
        // записывался в поле мёртвого движка и не останавливался НИКОГДА —
        // индикатор микрофона ОС горел до конца сессии. Снаружи это не лечилось:
        // `setOutputs([])` выходит по `!this.ctx`, а `setMicConfig` глушит только
        // при смене устройства. Сверяем контекст: не тот — гасим сразу.
        if (this.ctx !== ctx) {
          for (const tr of stream.getTracks()) tr.stop();
          return;
        }
        this.micStream = stream;
        this.micSource = ctx.createMediaStreamSource(stream);
        this.micGain = ctx.createGain();
        this.micGain.gain.value = volCurve(this.micCfg.gain);
        this.micSource.connect(this.micGain);
        // Спека — best effort, не гарантия: тихий маркер разработчику (не
        // тост юзеру — недиагностируемо с его стороны), если Chromium всё
        // же включил AEC/NS/AGC поверх запрошенного false (отчёт P).
        const micTrack = stream.getAudioTracks()[0];
        if (micTrack) {
          const settings = micTrack.getSettings();
          if (settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl) {
            console.warn(
              "[audioEngine] микрофон вернул AEC/NS/AGC=true поверх запрошенного false — Chromium мог проигнорировать констрейнты",
              settings,
            );
          }
        }
        // микрофон умер сам (USB выдернули) — прибрать и попробовать заново
        for (const tr of stream.getTracks()) {
          tr.onended = () => {
            this.stopMic();
            this.queueTapReconcile();
          };
        }
      } catch {
        return;
      }
    }
    for (const tap of this.taps) {
      const on = want.includes(tap);
      const has = this.micTaps.has(tap);
      if (on && !has && this.micGain) {
        this.micGain.connect(tap.dest);
        this.micTaps.add(tap);
        tap.el.dataset.muzaMic = "1"; // видно в инспекторе: в этот тап идёт голос
      } else if (!on && has) {
        try {
          this.micGain?.disconnect(tap.dest);
        } catch {
          /* уже отключён */
        }
        this.micTaps.delete(tap);
        delete tap.el.dataset.muzaMic;
      }
    }
  }

  /** Констрейнты захвата голоса (отчёт P, грабли Chromium): echoCancellation/
   *  noiseSuppression/autoGainControl ОБЯЗАНЫ жить ВНУТРИ audio-блока
   *  getUserMedia — на топ-левел объекте (audio: true, echoCancellation:
   *  false рядом) Chromium их молча игнорирует и включает AEC по умолчанию.
   *  AEC слышит музыку из динамиков/виртуального кабеля как «эхо» голоса и
   *  вырезает её из микса — без этого сценарий «голос в кабель» либо режет
   *  музыку, либо звучит артефактно. voiceIsolation — нестандартное поле
   *  Chromium (нет в lib.dom.d.ts) — добавляется через приведение типа. */
  private micConstraints(deviceId: string | null): MediaTrackConstraints {
    const c: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (deviceId) c.deviceId = { exact: deviceId };
    (c as Record<string, unknown>).voiceIsolation = false;
    return c;
  }

  private stopMic(): void {
    if (this.micStream) for (const tr of this.micStream.getTracks()) tr.stop();
    try {
      this.micGain?.disconnect();
    } catch {
      /* уже отключён */
    }
    this.micStream = null;
    this.micSource = null;
    this.micGain = null;
    for (const tap of this.micTaps) delete tap.el.dataset.muzaMic;
    this.micTaps.clear();
  }

  private destroyTap(tap: OutputTap): void {
    const i = this.taps.indexOf(tap);
    if (i >= 0) this.taps.splice(i, 1);
    if (this.micTaps.has(tap)) {
      try {
        this.micGain?.disconnect(tap.dest);
      } catch {
        /* уже отключён */
      }
      this.micTaps.delete(tap);
    }
    try {
      this.analyserNode?.disconnect(tap.gain);
    } catch {
      /* уже отключён */
    }
    try {
      tap.gain.disconnect();
    } catch {
      /* уже отключён */
    }
    tap.el.pause();
    tap.el.srcObject = null;
    tap.el.remove();
  }

  /** Громкости фан-аута. Мастер при живых тапах нейтрален (1): громкость
   *  приложения применяется ПЕР-ТАПОВО и только к followsMaster-маршрутам —
   *  так слайдер приложения ведёт наушники, не трогая уровень «в микрофон»
   *  (независимость громкостей — суть фичи). Без тапов мастер = слайдер,
   *  ровно как до фичи. */
  private applyOutputLevels(): void {
    if (!this.master) return;
    const live = this.taps.filter((t) => t.ok);
    this.master.gain.value = live.length > 0 ? 1 : volCurve(this.volume);
    for (const tap of live) {
      const route = this.routes.find((r) => r.deviceId === tap.deviceId);
      if (!route) continue;
      tap.gain.gain.value = volCurve(route.volume) * (route.followsMaster ? volCurve(this.volume) : 1);
    }
  }

  private applyEq(): void {
    this.eq.forEach((f, i) => {
      f.gain.value = this.eqOn ? (this.eqBands[i] ?? 0) : 0;
    });
    // Авто-преамп = −(макс. положительный буст полос): громкая полоса садится
    // к unity, EQ больше не выталкивает сигнал за 0 dBFS (приём Wavelet).
    if (this.preamp) {
      const maxBoost = this.eqOn ? Math.max(0, ...this.eqBands) : 0;
      this.preamp.gain.value = dbToLin(-maxBoost);
    }
  }

  /** Громкость слота: webaudio — гейн (норма может бустить >1),
   *  plain — el.volume (буст невозможен, клампим). */
  private applySlotLevel(slot: Slot, level: number): void {
    if (slot.gain) {
      slot.gain.gain.cancelScheduledValues(this.ctx?.currentTime ?? 0);
      slot.gain.gain.value = level * slot.norm;
    } else {
      slot.el.volume = Math.min(1, volCurve(this.volume) * Math.min(1, slot.norm) * level);
    }
  }

  /** Снять уходящий трек предыдущего кроссфейда: пауза, освобождение слота и
   *  обнуление его гейна (кривая могла замереть на середине — следующий трек в
   *  этом слоте заиграл бы на её остатке). Активный слот не трогаем никогда:
   *  если уходящий успел снова стать активным (второй стык подряд), им уже
   *  владеет обычный путь play(). */
  private dropFading(): void {
    const slot = this.fading;
    this.fading = null;
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (!slot || this.slots[this.active] === slot) return;
    slot.el.pause();
    slot.el.removeAttribute("src");
    slot.el.load();
    slot.url = null;
    if (slot.gain) {
      slot.gain.gain.cancelScheduledValues(this.ctx?.currentTime ?? 0);
      slot.gain.gain.value = 0;
    }
  }

  /** Играть URL в активном слоте; crossfadeSec > 0 — мягкий переход из
   *  текущего трека (слоты меняются местами). norm — множитель нормализации. */
  async play(url: string, norm: number, crossfadeSec = 0): Promise<void> {
    await this.ensureGraph(url);
    // ⚠️ ПОДЪЁМ КОНТЕКСТА ЗАПУСКАЕМ, НО НЕ ЖДЁМ ЗДЕСЬ. Предгретый контекст лежит
    // suspended (см. buildAhead), и `await resume()` стоял ровно перед
    // присвоением el.src — то есть возвращал на путь «клик → звук» ожидание,
    // ради снятия которого предгрев и делался. Загрузку это ожидание не
    // ускоряет: элементу, чтобы начать качать, контекст не нужен. Ждём ниже,
    // перед расписанием усилений и el.play(), — там подъём действительно нужен.
    const resuming = this.ctx?.state === "suspended" ? this.ctx.resume() : null;

    // Предыдущий стык мог ещё доигрывать в соседнем слоте — а именно он и
    // станет целью нового старта. Снимаем ДО того, как тронем слоты: иначе
    // старый уходящий либо продолжал бы звучать (новый старт без фейда), либо
    // его уборочный таймер сработал бы уже поверх нового трека.
    this.dropFading();
    const current = this.slots[this.active];
    const fade = crossfadeSec > 0 && current.url !== null && !current.el.paused;
    const nextIndex = fade ? 1 - this.active : this.active;
    const slot = this.slots[nextIndex];

    // Преднагрузка могла уже поставить этот url в слот — не перезагружаем
    if (slot.url !== url) {
      slot.url = url;
      slot.el.src = url;
      slot.el.load();
    }
    slot.norm = norm;
    slot.el.playbackRate = this.speed;

    // Закачка пошла — теперь дожидаемся подъёма: currentTime у приостановленного
    // контекста не идёт, и кривые кроссфейда, расписанные до resume, начались бы
    // не оттуда.
    if (resuming) {
      try {
        await resuming;
      } catch {
        /* контекст не поднялся — el.play() ниже сам скажет, что не вышло */
      }
    }

    if (fade && this.ctx && current.gain && slot.gain) {
      const t = this.ctx.currentTime;
      // Equal-power кривые (не linear): уходящий трек по cos от текущего уровня,
      // входящий по sin к своей норме — суммарная мощность на стыке постоянна
      current.gain.gain.cancelScheduledValues(t);
      current.gain.gain.setValueCurveAtTime(scaledCurve(XFADE_OUT, current.gain.gain.value), t, crossfadeSec);
      slot.gain.gain.cancelScheduledValues(t);
      slot.gain.gain.setValueCurveAtTime(scaledCurve(XFADE_IN, slot.norm), t, crossfadeSec);
      const old = current;
      this.fading = old; // пауза/сик/новый старт обязаны знать, кого ещё глушить
      this.fadeTimer = setTimeout(() => {
        this.fadeTimer = null;
        if (this.fading === old) this.fading = null;
        // к этому моменту слот мог снова стать активным — не трогаем тогда
        if (this.slots[this.active] !== old) {
          old.el.pause();
          old.el.removeAttribute("src");
          old.el.load();
          old.url = null;
        }
      }, crossfadeSec * 1000 + 200);
    } else {
      if (current !== slot) {
        current.el.pause();
        current.url = null;
      }
      this.applySlotLevel(slot, 1);
    }
    this.active = nextIndex;
    // Отказ el.play() ПРОБРАСЫВАЕТСЯ (аудит 2026-07-17): раньше здесь были
    // тост и «успех» — startAt считал трек заведённым (playing=true, авто-скип
    // мёртвых треков не запускался), и очередь замерзала на 0:00 под
    // «играющим» баром. Ошибкой владеет вызывающий: у startAt на неё есть
    // авто-скип на авто-переходе и честный стоп на ручном клике.
    try {
      await slot.el.play();
    } catch (e) {
      throw e instanceof Error ? e : new Error(this.t("media.player.errors.playbackDidNotStart"));
    }
  }

  /** Преднагрузка следующего трека в неактивный слот (gapless/кроссфейд). */
  preload(url: string): void {
    if (this.mode === "unknown" || this.slots.length < 2) return;
    const slot = this.slots[1 - this.active];
    if (slot.url === url) return;
    slot.url = url;
    slot.el.src = url;
    slot.el.load();
  }

  pause(): void {
    // Уходящий трек кроссфейда живёт в ДРУГОМ слоте и сам не замолкает —
    // без этого «пауза» оставляла бы его звучать до конца кривой (dropFading).
    this.dropFading();
    this.slots[this.active]?.el.pause();
  }

  /** Возобновить активный слот. Ответ — «звук реально пошёл?»: false и когда
   *  возобновлять нечего (пустой слот), и когда элемент отказал (файл выпал
   *  из LRU-кэша — Windows не держит asset-файл открытым, битые данные,
   *  умерший аудио-тракт). НЕ бросает и не тостит: что делать с отказом —
   *  пере-добыть или честно встать — решает usePlayback (healCurrent).
   *  Раньше отказ глотался молча, и рестарт repeat-one умирал тишиной под
   *  «играющим» баром (аудит 2026-07-17). */
  async resume(): Promise<boolean> {
    try {
      if (this.ctx?.state === "suspended") await this.ctx.resume();
    } catch {
      /* контекст мог умереть вместе с аудио-устройством — элемент пробуем всё равно */
    }
    const el = this.slots[this.active]?.el;
    if (!el?.src) return false;
    try {
      await el.play();
      return true;
    } catch {
      return false;
    }
  }

  /** Полная остановка: снять источник и обнулить оба слота. */
  stop(): void {
    this.dropFading(); // и снять уборочный таймер стыка — прибирать уже нечего
    for (const slot of this.slots) {
      slot.el.pause();
      slot.el.removeAttribute("src");
      slot.el.load();
      slot.url = null;
    }
  }

  /** Перемотка активного слота. keepCrossfade — НЕ обрывать идущий стык:
   *  единственный такой вызов — досик на сохранённую позицию сразу после
   *  старта трека («продолжить с места», usePlayback.startAt). Там стык только
   *  что начался, входящий трек ещё на нуле громкости — обрыв уходящего дал бы
   *  дыру тишиной на всю длину кривой. Обычная перемотка (человек тянет
   *  полоску) уходящий снимает: он привязан к моменту стыка, а не к новой
   *  позиции, и звучать поверх неё ему незачем. */
  seek(sec: number, keepCrossfade = false): void {
    if (!keepCrossfade) this.dropFading();
    const el = this.slots[this.active]?.el;
    if (el) el.currentTime = Math.max(0, sec);
  }

  position(): number {
    return this.slots[this.active]?.el.currentTime ?? 0;
  }

  setVolume(vol: number): void {
    this.volume = vol;
    if (this.master) {
      // applyOutputLevels сам решает, куда идёт слайдер: без тапов — в мастер
      // (как всегда было), с тапами — пер-тапово в followsMaster-маршруты.
      this.applyOutputLevels();
    } else {
      const slot = this.slots[this.active];
      if (slot) this.applySlotLevel(slot, 1);
    }
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    for (const slot of this.slots) slot.el.playbackRate = speed;
  }

  setEq(on: boolean, bands: number[]): void {
    this.eqOn = on;
    this.eqBands = bands;
    this.applyEq();
  }

  /** Анализатор для визуализатора (Stage 6); null — plain-режим или граф ещё
   *  не построен (браузер без CORS-чистого источника — plain-режим). С
   *  предгревом узел появляется ДО первого трека и до этого момента отдаёт
   *  тишину — это правда о сигнале, а не поломка: играть ещё нечему. */
  analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  /** Множитель нормализации по integrated loudness (EBU R128 → −14 LUFS). */
  static normFactor(loudness: number | null, enabled: boolean): number {
    if (!enabled || loudness === null) return 1;
    const db = Math.max(-12, Math.min(12, TARGET_LUFS - loudness));
    return dbToLin(db);
  }
}
