/** Гибридный движок: звук из процесса приложения там, где это возможно.
 *
 *  ЗАЧЕМ. Пока звук рендерит WebView2, «захват аудио приложения» (OBS и всё на
 *  том же Windows API) окно «Муза» не слышит: обход дерева процессов
 *  обрывается на границе muza-desktop.exe → msedgewebview2.exe. Замер 10.08 —
 *  RMS 0.000000 из окна против 0.0028 при наведении прямо на процессы WebView2.
 *  Нативный вывод это чинит: те же замеры дали 0.087 на mp3 и 0.370 на Opus.
 *  Разбор — docs/notes/2026-08-10-обс-не-видит-звук-музы.md.
 *
 *  ЧТО ИДЁТ НАТИВНО. Файлы из кэша и ЕЩЁ КАЧАЮЩИЕСЯ треки: Rust читает
 *  растущий `.part` напрямую и ждёт байты, вместо того чтобы ходить за ними по
 *  HTTP через muza-stream (та петля нужна только элементу `<audio>`).
 *  Прежний движок остаётся запасным путём: чужие https-источники, режим без
 *  Web Audio и случай, когда живой закачки уже нет в реестре.
 *
 *  Вся обработка перенесена: эквалайзер, преамп и лимитер (dsp.rs), кроссфейд,
 *  вывод на несколько устройств, подмешивание голоса, визуализатор и скорость
 *  с сохранением тона.
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

/** Подмена AnalyserNode для нативного пути.
 *
 *  Визуализатор берёт у анализатора ровно четыре вещи — размер окна, число
 *  полос и два метода снятия данных. Поэтому вместо переписывания
 *  визуализатора отдаём объект с той же поверхностью, а данные считает Rust
 *  (тем же окном 2048 и той же шкалой в дБ, что были у Web Audio).
 *
 *  Опрос ленивый: он заводится при первом обращении и глохнет через секунду
 *  после последнего. Визуализатор закрыт — преобразование Фурье не считается
 *  вообще, а открыт он далеко не всегда. */
export class NativeAnalyser {
  readonly fftSize = 2048;
  readonly frequencyBinCount = 1024;
  /** Визуализатор берёт частоту дискретизации ОТСЮДА, чтобы разложить полосы
   *  по частотам: `analyser.context.sampleRate`. У Web Audio её давал
   *  AudioContext; здесь её присылает Rust вместе со спектром.
   *
   *  ⚠️ Пропустив это поле, я уронил режим прослушивания целиком: компонент
   *  падал на чтении sampleRate, и экран не открывался вовсе (жалоба владельца
   *  10.08). Подменяя чужой объект, мало реализовать методы — нужны и поля, к
   *  которым обращаются потребители. */
  readonly context = { sampleRate: 48000 };
  private freq = new Uint8Array(1024);
  private wave = new Uint8Array(2048).fill(128);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAsk = 0;

  private ensurePolling(): void {
    this.lastAsk = Date.now();
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      // Никто не спрашивал секунду — визуализатор закрыт, глушим опрос.
      if (Date.now() - this.lastAsk > 1000) {
        this.stop();
        return;
      }
      void call<{ freq: number[]; wave: number[]; rate: number }>("native_scope").then((scope) => {
        // Пусто — движок остановился между кадрами; оставляем прошлую картинку.
        if (!scope) return;
        this.freq = new Uint8Array(scope.freq);
        this.wave = new Uint8Array(scope.wave);
        if (scope.rate > 0) this.context.sampleRate = scope.rate;
      });
    }, 33); // ~30 кадров в секунду: чаще глаз не различает
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.freq = new Uint8Array(1024);
    this.wave = new Uint8Array(2048).fill(128);
  }

  getByteFrequencyData(target: Uint8Array): void {
    this.ensurePolling();
    target.set(this.freq.subarray(0, target.length));
  }

  getByteTimeDomainData(target: Uint8Array): void {
    this.ensurePolling();
    target.set(this.wave.subarray(0, target.length));
  }
}

/** Вызов команды Rust, который не роняет движок.
 *
 *  Команда может не ответить по трём причинам: окно закрывается, движок уже
 *  остановлен, или мы вообще не в Tauri (тесты, веб). Ни одна из них не должна
 *  прерывать воспроизведение, поэтому результат всегда промис, а отказ
 *  превращается в undefined. `Promise.resolve` здесь обязателен: без него на
 *  подменённом `invoke`, который возвращает не промис, падал бы сам вызов. */
function call<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    return Promise.resolve(invoke<T>(command, args)).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

/** Список устройств браузера — или null, если его в этой среде нет.
 *
 *  Нужен, чтобы сопоставить выбранное устройство с именем, по которому его
 *  знает Rust. В тестах и до выдачи доступа к устройствам `mediaDevices`
 *  отсутствует, и обращение к нему роняло бы движок прямо в конструкторе:
 *  usePlayback настраивает микрофон и маршруты сразу при создании. */
function deviceList(): Promise<MediaDeviceInfo[]> | null {
  const devices = globalThis.navigator?.mediaDevices;
  if (typeof devices?.enumerateDevices !== "function") return null;
  return devices.enumerateDevices();
}

/** Ключ живой закачки из URL потока (`muza-stream.localhost/<ns>/<id>`).
 *  По нему Rust находит растущий файл и читает его напрямую, минуя HTTP —
 *  та петля существует только ради элемента `<audio>` в WebView2. */
export function streamKeyFromUrl(url: string): { ns: string; id: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "muza-stream.localhost") return null;
    const [ns, id] = parsed.pathname.replace(/^\//, "").split("/");
    if (!ns || !id) return null;
    return { ns: decodeURIComponent(ns), id: decodeURIComponent(id) };
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
  private readonly nativeAnalyser = new NativeAnalyser();
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
      void call<NativeStatus>("native_status")
        .then((status) => {
          // Пусто — команда не ответила (окно закрывается, движок остановлен).
          if (!status) return;
          // ⚠️ КОНЕЦ ТРЕКА ПРОВЕРЯЕТСЯ ДО ГВАРДА `playing` (11.08.2026).
          // Раньше `if (!status.playing) return;` стоял ПЕРЕД этой проверкой, и
          // это мина: `playing` на стороне Rust означает всего лишь «движок
          // существует». Стоит ему когда-нибудь начать значить правду — «звук
          // идёт», — и конец трека перестанет доезжать вовсе, потому что на
          // конце звук как раз не идёт. Конец важнее такта позиции: пропустив
          // его, плеер молча встаёт навсегда.
          if (status.ended && !this.endedSent) {
            this.endedSent = true;
            this.cb.onEnded();
          }
          if (!status.playing) return;
          this.lastPosition = status.position;
          this.cb.onTime(status.position);
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
    await call("native_stop");
    this.stopPolling();
    this.nativeAnalyser.stop();
    this.native = false;
  }

  async play(url: string, norm: number, crossfadeSec = 0): Promise<void> {
    const path = assetUrlToPath(url);
    this.norm = norm;
    if (path === null) {
      // Ещё качающийся трек: Rust умеет читать растущий файл, если закачка
      // жива. Не нашлась — отдаём прежнему движку, как раньше.
      const stream = streamKeyFromUrl(url);
      if (stream !== null) {
        const started = await call<boolean>("native_play_stream", {
          ns: stream.ns,
          id: stream.id,
          volume: this.gain(),
          crossfadeSec,
        }).catch(() => false);
        if (started) {
          this.web.stop();
          this.native = true;
          this.lastPosition = 0;
          if (this.eqBands.length > 0) {
            void call("native_set_eq", { on: this.eqOn, bands: this.eqBands });
          }
          this.startPolling();
          this.cb.onPlaying?.();
          return;
        }
      }
      // Чужой источник или закачки уже нет — прежний движок; нативный глушим,
      // иначе два трека звучали бы одновременно.
      if (this.native) await this.stopNative();
      return this.web.play(url, norm, crossfadeSec);
    }
    // Файл на диске — играем из своего процесса. Прежний движок глушим по той
    // же причине.
    this.web.stop();
    this.native = true;
    this.lastPosition = 0;
    await call("native_play", { path, volume: this.gain(), crossfadeSec });
    // Движок только что родился и про настройки не знает — доносим их.
    if (this.eqBands.length > 0) {
      void call("native_set_eq", { on: this.eqOn, bands: this.eqBands });
    }
    this.startPolling();
    this.cb.onPlaying?.();
  }

  preload(url: string): void {
    // Нативный слот пока один: преднагружать некуда (придёт с кроссфейдом).
    if (!this.native) this.web.preload(url);
  }

  pause(): void {
    if (this.native) void call("native_set_paused", { paused: true });
    else this.web.pause();
  }

  async resume(): Promise<boolean> {
    if (!this.native) return this.web.resume();
    try {
      await call("native_set_paused", { paused: false });
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    if (this.native) void this.stopNative();
    this.web.stop();
  }

  seek(sec: number, keepCrossfade?: boolean): void {
    if (this.native) {
      this.lastPosition = Math.max(0, sec);
      // ⚠️ ПЕРЕМОТКА УВОДИТ С КОНЦА — ЗАЩЁЛКУ СНИМАЕМ (11.08.2026).
      // `endedSent` гасит повторную отправку конца, и сбрасывался он ТОЛЬКО в
      // startPolling(), то есть при новом play(). Повтор трека play() не зовёт:
      // он отматывает на ноль и снимает паузу. Значит второй конец того же
      // трека не доехал бы никогда — повтор сработал бы РОВНО ОДИН РАЗ, а на
      // втором круге трек домолчал бы до конца и встал. Отмотали — конец снова
      // впереди, и о нём обязаны сообщить.
      this.endedSent = false;
      void call("native_seek", { sec: Math.max(0, sec) });
      return;
    }
    // Второй аргумент прокидываем ТОЛЬКО если его задали: прежний движок
    // отличает «перемотка без уточнений» от явного keepCrossfade, и лишний
    // параметр менял бы поведение стыка.
    if (keepCrossfade === undefined) this.web.seek(sec);
    else this.web.seek(sec, keepCrossfade);
  }

  position(): number {
    return this.native ? this.lastPosition : this.web.position();
  }

  setVolume(vol: number): void {
    this.volume = vol;
    this.web.setVolume(vol);
    if (this.native) void call("native_set_volume", { gain: this.gain() });
  }

  setSpeed(speed: number): void {
    this.web.setSpeed(speed);
    // Нативно тон не едет: время растягивает фазовый вокодер, а не пересчёт
    // частоты. Именно поэтому звучит как запись в другом темпе, а не как
    // ускоренная плёнка.
    void call("native_set_speed", { speed });
  }

  /** Высота тона в полутонах, НЕЗАВИСИМО от скорости («стретч»).
   *
   *  Пара к setSpeed и стоит рядом с ней намеренно: вместе они и есть то, что
   *  прежний путь одной ручкой выразить не мог. Пересчёт частоты двигал время и
   *  высоту сцепленно — медленнее значило ниже. Вокодер эту связь рвёт.
   *
   *  ⚠️ Веб-путь высоту НЕ УМЕЕТ: у <audio> есть только playbackRate, а он
   *  тянет тон за собой. Молча делать вид, что получилось, нельзя — ручка
   *  показывается по supportsPitch, и на веб-пути её просто нет. */
  setPitch(semitones: number): void {
    if (!this.native) return;
    void call("native_set_pitch", { semitones });
  }

  /** Характер растяжения темпа: true — WSOLA (держит удары), false — фазовый
   *  вокодер (гладок на тянущемся). Два РАЗНЫХ метода, а не «лучше/хуже»:
   *  разбор — в шапке src-tauri/src/wsola.rs. На веб-пути выбора нет вовсе,
   *  там темп меняет сам браузер. */
  setTempoMode(wsola: boolean): void {
    if (!this.native) return;
    void call("native_set_tempo_mode", { wsola });
  }

  /** Умеет ли текущий путь двигать высоту отдельно от времени. */
  get supportsPitch(): boolean {
    return this.native;
  }

  setEq(on: boolean, bands: number[]): void {
    this.eqOn = on;
    this.eqBands = bands;
    this.web.setEq(on, bands);
    if (this.native) void call("native_set_eq", { on, bands });
  }

  setOutputs(routes: OutputRoute[]): void {
    // Веб-путь настраиваем всегда: он обслуживает треки, которые ещё качаются.
    this.web.setOutputs(routes);
    // Нативному нужны ПОДПИСИ устройств: браузерные идентификаторы — это хеши,
    // которых в системе не существует, а cpal перечисляет устройства по именам.
    // Точного соответствия между двумя перечислениями в Windows нет, поэтому
    // сверка идёт по вхождению подстроки уже на стороне Rust.
    const listing = deviceList();
    if (listing === null) return;
    void listing
      .then((devices) => {
        const named = routes
          .map((route) => ({
            name: devices.find((d) => d.deviceId === route.deviceId)?.label ?? "",
            volume: volCurve(route.volume),
            mixMic: route.mixMic === true,
          }))
          .filter((route) => route.name.length > 0);
        return call("native_set_outputs", { routes: named });
      })
      .catch(() => {
        /* доступ к списку устройств ещё не выдан — придёт со следующей правкой */
      });
  }

  setMicConfig(cfg: MicConfig): void {
    this.web.setMicConfig(cfg);
    // null в устройстве — системный микрофон по умолчанию; Rust это понимает.
    const listing = deviceList();
    if (listing === null) return;
    void listing
      .then((devices) => {
        const name = cfg.deviceId
          ? (devices.find((d) => d.deviceId === cfg.deviceId)?.label ?? null)
          : null;
        return call("native_set_mic", { name, gain: volCurve(cfg.gain) });
      })
      .catch(() => {
        /* список устройств ещё не доступен — догоним следующей правкой */
      });
  }

  prewarm(): Promise<void> {
    return this.web.prewarm();
  }

  /** На нативном пути отдаём подменный анализатор: данные считает Rust, а
   *  поверхность та же, что у AnalyserNode — визуализатор не отличает.
   *  Приведение типа честное по составу: визуализатор берёт только fftSize,
   *  frequencyBinCount и два метода снятия данных, всё это реализовано. */
  analyser(): AnalyserNode | null {
    if (!this.native) return this.web.analyser();
    return this.nativeAnalyser as unknown as AnalyserNode;
  }

  static normFactor(loudness: number | null, enabled: boolean): number {
    return AudioEngine.normFactor(loudness, enabled);
  }
}
