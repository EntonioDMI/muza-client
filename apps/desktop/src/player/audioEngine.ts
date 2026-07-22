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
  ) {}

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

  /** Определить режим (webaudio/plain) по CORS-пробе первого источника
   *  и построить граф. Зовётся при первом реальном воспроизведении. */
  private async ensureGraph(probeUrl: string): Promise<void> {
    if (this.mode !== "unknown") return;
    let corsOk = false;
    try {
      const res = await fetch(probeUrl, { headers: { Range: "bytes=0-1" } });
      corsOk = res.ok || res.status === 206;
    } catch {
      corsOk = false;
    }
    if (this.slots.length === 0) {
      this.slots = [this.makeSlot(), this.makeSlot()];
    }
    if (!corsOk) {
      this.mode = "plain";
      return;
    }
    this.mode = "webaudio";
    const ctx = new AudioContext();
    this.ctx = ctx;
    // EQ-цепь: shelf по краям, peaking в середине
    this.eq = EQ_FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
      f.frequency.value = freq;
      if (f.type === "peaking") f.Q.value = 1.1;
      f.gain.value = 0;
      return f;
    });
    for (let i = 0; i < this.eq.length - 1; i++) this.eq[i].connect(this.eq[i + 1]);
    // Преамп ПЕРЕД EQ: точка микса обоих слотов + хедрум под буст полос
    this.preamp = ctx.createGain();
    this.preamp.connect(this.eq[0]);
    this.master = ctx.createGain();
    this.eq[this.eq.length - 1].connect(this.master);
    // Лимитер ПОСЛЕ мастера (последний перед выходом): страховка от клиппинга
    // при бусте EQ + бусте нормализации. Не true-peak (нет lookahead/oversampling),
    // но ловит явный клип; апгрейд до AudioWorklet-brickwall — если услышим pumping.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; // dBFS
    this.limiter.knee.value = 0; // жёсткое колено
    this.limiter.ratio.value = 20; // ≈ лимитер
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.master.connect(this.limiter);
    // Визуализатор (Stage 6): analyser в конце цепи — видит финальный сигнал,
    // как его слышит юзер (после EQ, нормализации и лимитера)
    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    // T14: 0.82 давал вялый, «нежёсткий» отклик баров — 0.7 живее, но не дёрганый.
    this.analyserNode.smoothingTimeConstant = 0.7;
    this.limiter.connect(this.analyserNode);
    this.analyserNode.connect(ctx.destination);
    this.master.gain.value = volCurve(this.volume);
    for (const slot of this.slots) {
      slot.source = ctx.createMediaElementSource(slot.el);
      slot.gain = ctx.createGain();
      slot.gain.gain.value = 0;
      slot.source.connect(slot.gain);
      slot.gain.connect(this.preamp);
    }
    this.applyEq();
    // Маршруты вывода могли быть заданы ДО постройки графа (prefs применяются
    // при монтировании, граф строится при первом воспроизведении) — догоняем.
    if (this.routes.length > 0) this.queueTapReconcile();
  }

  // ── Вывод на устройства: фан-аут финального сигнала ──────────────

  /** Задать маршруты вывода. Пустой массив — вернуться к системному выходу.
   *  Безопасно звать до постройки графа (запомним и применим в ensureGraph)
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
          stream = await navigator.mediaDevices.getUserMedia({
            audio: this.micCfg.deviceId ? { deviceId: { exact: this.micCfg.deviceId } } : true,
          });
        } catch {
          // выбранный микрофон пропал/занят — пробуем системный по умолчанию
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        this.micStream = stream;
        this.micSource = ctx.createMediaStreamSource(stream);
        this.micGain = ctx.createGain();
        this.micGain.gain.value = volCurve(this.micCfg.gain);
        this.micSource.connect(this.micGain);
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

  /** Играть URL в активном слоте; crossfadeSec > 0 — мягкий переход из
   *  текущего трека (слоты меняются местами). norm — множитель нормализации. */
  async play(url: string, norm: number, crossfadeSec = 0): Promise<void> {
    await this.ensureGraph(url);
    if (this.ctx?.state === "suspended") await this.ctx.resume();

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

    if (fade && this.ctx && current.gain && slot.gain) {
      const t = this.ctx.currentTime;
      // Equal-power кривые (не linear): уходящий трек по cos от текущего уровня,
      // входящий по sin к своей норме — суммарная мощность на стыке постоянна
      current.gain.gain.cancelScheduledValues(t);
      current.gain.gain.setValueCurveAtTime(scaledCurve(XFADE_OUT, current.gain.gain.value), t, crossfadeSec);
      slot.gain.gain.cancelScheduledValues(t);
      slot.gain.gain.setValueCurveAtTime(scaledCurve(XFADE_IN, slot.norm), t, crossfadeSec);
      const old = current;
      setTimeout(() => {
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
    for (const slot of this.slots) {
      slot.el.pause();
      slot.el.removeAttribute("src");
      slot.el.load();
      slot.url = null;
    }
  }

  seek(sec: number): void {
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

  /** Анализатор для визуализатора (Stage 6); null — plain-режим или граф
   *  ещё не построен (браузер без CORS-чистого источника — plain-режим). */
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
