/** Гибридный движок: звук из процесса приложения там, где это возможно.
 *
 *  ЗАЧЕМ. Пока звук рендерит WebView2, «захват аудио приложения» (OBS и всё на
 *  том же Windows API) окно «Муза» не слышит: обход дерева процессов
 *  обрывается на границе muza-desktop.exe → msedgewebview2.exe. Замер 10.08 —
 *  RMS 0.000000 из окна против 0.0028 при наведении прямо на процессы WebView2.
 *  Нативный вывод это чинит: те же замеры дали 0.087 на mp3 и 0.370 на Opus.
 *  Разбор — docs/notes/2026-08-10-обс-не-видит-звук-музы.md.
 *
 *  ПОЧЕМУ ГИБРИД, А НЕ ЗАМЕНА. Нативный движок читает файл с диска, а трек,
 *  которого ещё нет в кэше, играет с первых килобайт через muza-stream — там
 *  файла целиком не существует. Поэтому: есть файл на диске — играем нативно,
 *  иначе отдаём прежнему движку. Гибрид схлопнется, когда Rust научится
 *  играть растущий файл.
 *
 *  ⚠️ ЧТО ПОКА ТЕРЯЕТСЯ НА НАТИВНОМ ПУТИ (по одной задаче на каждое):
 *  кроссфейд и gapless, вывод на несколько устройств с подмешиванием голоса,
 *  визуализатор и скорость с сохранением тона. Всё это на веб-пути продолжает
 *  работать как раньше. Эквалайзер, преамп и лимитер уже перенесены (dsp.rs).
 */
import { invoke } from "@tauri-apps/api/core";
import { AudioEngine, type EngineCallbacks, type MicConfig, type OutputRoute } from "./audioEngine";
import type { TParams, TranslationKey } from "../i18n";

/** Перцептивная кривая громкости — та же, что в audioEngine (слайдер 0–100 →
 *  квадрат). Дублируется намеренно: движки независимы, а ползунок обязан
 *  вести себя одинаково на обоих путях. */
const volCurve = (vol: number) => Math.pow(Math.max(0, Math.min(100, vol)) / 100, 2);

/** Как часто спрашиваем позицию у Rust. Прежний движок слал timeupdate ~4 раза
 *  в секунду — держим тот же темп, чтобы потребители позиции (текст песни,
 *  караоке, полоса) вели себя как раньше. */
const POLL_MS = 250;

/** Путь к файлу из URL, которым его отдали бы WebView. `convertFileSrc` делает
 *  из пути `http://asset.localhost/<url-encoded>` — разбираем обратно.
 *  Возвращает null для всего, что файлом на диске не является (muza-stream,
 *  чужие https) — такое играет прежним движком. */
export function assetUrlToPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "asset.localhost") return null;
    const raw = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

interface NativeStatus {
  position: number;
  ended: boolean;
  playing: boolean;
}

export class HybridAudioEngine {
  private readonly web: AudioEngine;
  /** Играет ли сейчас нативный путь. false — всё делегируется web. */
  private native = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  private volume = 64;
  /** Множитель нормализации текущего трека: на нативном пути он входит в
   *  громкость, потому что отдельного гейна слота там пока нет. */
  private norm = 1;
  private endedSent = false;
  /** Состояние эквалайзера храним у себя: нативный движок рождается вместе с
   *  треком, а полосы человек мог выставить до него — их надо донести. */
  private eqOn = false;
  private eqBands: number[] = [];
  /** Последняя известная позиция нативного пути: команда асинхронна, а
   *  вызывающие position() ждут число немедленно. */
  private lastPosition = 0;

  constructor(
    private readonly cb: EngineCallbacks,
    t?: (key: TranslationKey, params?: TParams) => string,
  ) {
    this.web = t ? new AudioEngine(cb, t) : new AudioEngine(cb);
  }

  private gain(): number {
    return volCurve(this.volume) * this.norm;
  }

  private startPolling(): void {
    this.stopPolling();
    this.endedSent = false;
    this.poll = setInterval(() => {
      void invoke<NativeStatus>("native_status")
        .then((status) => {
          if (!status.playing) return;
          this.lastPosition = status.position;
          this.cb.onTime(status.position);
          if (status.ended && !this.endedSent) {
            this.endedSent = true;
            this.cb.onEnded();
          }
        })
        .catch(() => {
          /* окно закрывается — команда может не ответить, это не сбой плеера */
        });
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll !== null) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  private async stopNative(): Promise<void> {
    await invoke("native_stop").catch(() => {});
    this.stopPolling();
    this.native = false;
  }

  async play(url: string, norm: number, crossfadeSec = 0): Promise<void> {
    const path = assetUrlToPath(url);
    this.norm = norm;
    if (path === null) {
      // Поток или чужой источник — прежний движок; нативный глушим, иначе два
      // трека звучали бы одновременно.
      if (this.native) await this.stopNative();
      return this.web.play(url, norm, crossfadeSec);
    }
    // Файл на диске — играем из своего процесса. Прежний движок глушим по той
    // же причине.
    this.web.stop();
    this.native = true;
    this.lastPosition = 0;
    await invoke("native_play", { path, volume: this.gain() });
    // Движок только что родился и про настройки не знает — доносим их.
    if (this.eqBands.length > 0) {
      void invoke("native_set_eq", { on: this.eqOn, bands: this.eqBands }).catch(() => {});
    }
    this.startPolling();
    this.cb.onPlaying?.();
  }

  preload(url: string): void {
    // Нативный слот пока один: преднагружать некуда (придёт с кроссфейдом).
    if (!this.native) this.web.preload(url);
  }

  pause(): void {
    if (this.native) void invoke("native_set_paused", { paused: true }).catch(() => {});
    else this.web.pause();
  }

  async resume(): Promise<boolean> {
    if (!this.native) return this.web.resume();
    try {
      await invoke("native_set_paused", { paused: false });
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    if (this.native) void this.stopNative();
    this.web.stop();
  }

  seek(sec: number, keepCrossfade = false): void {
    if (this.native) {
      this.lastPosition = Math.max(0, sec);
      void invoke("native_seek", { sec: Math.max(0, sec) }).catch(() => {});
    } else {
      this.web.seek(sec, keepCrossfade);
    }
  }

  position(): number {
    return this.native ? this.lastPosition : this.web.position();
  }

  setVolume(vol: number): void {
    this.volume = vol;
    this.web.setVolume(vol);
    if (this.native) void invoke("native_set_volume", { gain: this.gain() }).catch(() => {});
  }

  setSpeed(speed: number): void {
    // Скорость с сохранением тона нативно ещё не сделана (нужен WSOLA) —
    // на нативном пути молча остаёмся на 1x, вместо «бурундука».
    this.web.setSpeed(speed);
  }

  setEq(on: boolean, bands: number[]): void {
    this.eqOn = on;
    this.eqBands = bands;
    this.web.setEq(on, bands);
    if (this.native) void invoke("native_set_eq", { on, bands }).catch(() => {});
  }

  setOutputs(routes: OutputRoute[]): void {
    this.web.setOutputs(routes);
  }

  setMicConfig(cfg: MicConfig): void {
    this.web.setMicConfig(cfg);
  }

  prewarm(): Promise<void> {
    return this.web.prewarm();
  }

  /** На нативном пути анализатор молчит: сигнал не проходит через Web Audio.
   *  Визуализатор это переживает — он и так рассчитан на null. */
  analyser(): AnalyserNode | null {
    return this.native ? null : this.web.analyser();
  }

  static normFactor(loudness: number | null, enabled: boolean): number {
    return AudioEngine.normFactor(loudness, enabled);
  }
}
