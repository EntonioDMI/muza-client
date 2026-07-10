/** Аудио-движок Stage 3: два <audio>-слота (кроссфейд и преднагрузка
 *  следующего трека) → Web Audio-граф (пер-слотовый гейн = фейд × нормализация
 *  лаудности → общий 10-полосный EQ → мастер-громкость).
 *
 *  Fallback «plain»: MediaElementSource без CORS-чистого источника выдаёт
 *  тишину — перед постройкой графа источник проверяется fetch-пробой; если
 *  CORS не прошёл, играем элементами напрямую (без EQ и буста нормализации). */

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
/** Целевая integrated loudness для нормализации (стриминговый стандарт). */
const TARGET_LUFS = -14;

const dbToLin = (db: number) => Math.pow(10, db / 20);
/** Перцептивная кривая громкости: слайдер 0–100 → квадрат. */
const volCurve = (vol: number) => Math.pow(Math.max(0, Math.min(100, vol)) / 100, 2);

interface Slot {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
  /** Множитель нормализации текущего трека слота (фейды рампят к нему). */
  norm: number;
  url: string | null;
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
  private master: GainNode | null = null;
  private mode: "unknown" | "webaudio" | "plain" = "unknown";

  private volume = 64;
  private speed = 1;
  private eqOn = false;
  private eqBands: number[] = EQ_FREQS.map(() => 0);

  constructor(private readonly cb: EngineCallbacks) {}

  private makeSlot(): Slot {
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous"; // asset-протокол отвечает CORS-заголовками
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
        this.cb.onError("Не удалось воспроизвести файл");
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
    this.master = ctx.createGain();
    this.eq[this.eq.length - 1].connect(this.master);
    this.master.connect(ctx.destination);
    this.master.gain.value = volCurve(this.volume);
    for (const slot of this.slots) {
      slot.source = ctx.createMediaElementSource(slot.el);
      slot.gain = ctx.createGain();
      slot.gain.gain.value = 0;
      slot.source.connect(slot.gain);
      slot.gain.connect(this.eq[0]);
    }
    this.applyEq();
  }

  private applyEq(): void {
    this.eq.forEach((f, i) => {
      f.gain.value = this.eqOn ? (this.eqBands[i] ?? 0) : 0;
    });
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
      current.gain.gain.cancelScheduledValues(t);
      current.gain.gain.setValueAtTime(current.gain.gain.value, t);
      current.gain.gain.linearRampToValueAtTime(0, t + crossfadeSec);
      slot.gain.gain.cancelScheduledValues(t);
      slot.gain.gain.setValueAtTime(0, t);
      slot.gain.gain.linearRampToValueAtTime(slot.norm, t + crossfadeSec);
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
    try {
      await slot.el.play();
    } catch (e) {
      this.cb.onError(e instanceof Error ? e.message : "Воспроизведение не стартовало");
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

  async resume(): Promise<void> {
    if (this.ctx?.state === "suspended") await this.ctx.resume();
    const el = this.slots[this.active]?.el;
    if (el?.src) {
      try {
        await el.play();
      } catch {
        /* нет источника — нечего возобновлять */
      }
    }
  }

  /** Полная остановка (переход на демо-симуляцию). */
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
      this.master.gain.value = volCurve(vol);
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

  /** Множитель нормализации по integrated loudness (EBU R128 → −14 LUFS). */
  static normFactor(loudness: number | null, enabled: boolean): number {
    if (!enabled || loudness === null) return 1;
    const db = Math.max(-12, Math.min(12, TARGET_LUFS - loudness));
    return dbToLin(db);
  }
}
