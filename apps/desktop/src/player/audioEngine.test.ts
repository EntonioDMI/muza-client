/** Движок: граница «звук не завёлся» (аудит 2026-07-17, «повтор трека больше
 *  никогда не останавливается сам»). Прежний контракт молча глотал отказ
 *  el.play(): resume() — совсем без следа (рестарт repeat-one умирал тишиной
 *  под «играющим» баром), play() — тостом без проброса (startAt считал старт
 *  успешным, и авто-скип мёртвых треков с фикса 2026-07-16 не запускался).
 *  Тесты держат контракт: play() пробрасывает отказ вызывающему (тостом и
 *  восстановлением владеет usePlayback), resume() честно отвечает true/false.
 *
 *  Стенд: plain-режим (CORS-проба падает → граф Web Audio не строится) —
 *  jsdom без AudioContext; play/pause/load стабятся на прототипе. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audioEngine";

const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");
const loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load");

let onError: ReturnType<typeof vi.fn<(message: string) => void>>;

const makeEngine = () => {
  onError = vi.fn<(message: string) => void>();
  return new AudioEngine({ onTime: () => {}, onEnded: () => {}, onError });
};

beforeEach(() => {
  // CORS-проба ensureGraph падает → plain-режим (jsdom не умеет AudioContext)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("нет CORS в стенде");
    }),
  );
  // шпионы живут на прототипе и переживают тесты — историю вызовов чистим
  playSpy.mockClear().mockResolvedValue(undefined);
  pauseSpy.mockClear().mockImplementation(() => {});
  loadSpy.mockClear().mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  // слоты вешаются в document.body — прибираем, чтобы нумерация data-muza-slot
  // и события не переживали соседние тесты
  document.querySelectorAll("audio[data-muza-slot]").forEach((el) => el.remove());
  // тапы вывода на устройства (2026-07-22) — тот же приём, свой атрибут
  document.querySelectorAll("audio[data-muza-tap]").forEach((el) => el.remove());
});

describe("AudioEngine: отказ старта звука не глотается", () => {
  it("play(): отказ el.play() пробрасывается вызывающему, тост не дублируется", async () => {
    const engine = makeEngine();
    playSpy.mockRejectedValueOnce(new Error("NotSupportedError: источник мёртв"));

    await expect(engine.play("asset://localhost/dead.webm", 1, 0)).rejects.toThrow(/источник мёртв/);
    // Ошибкой владеет вызывающий (startAt: авто-скип/честный стоп) — движок
    // не показывает второй тост поверх его.
    expect(onError).not.toHaveBeenCalled();
  });

  it("resume(): звук реально завёлся → true", async () => {
    const engine = makeEngine();
    await engine.play("asset://localhost/a.webm", 1, 0);

    await expect(engine.resume()).resolves.toBe(true);
  });

  it("resume(): элемент отказал → false, без исключения и без тоста", async () => {
    const engine = makeEngine();
    await engine.play("asset://localhost/a.webm", 1, 0);
    playSpy.mockRejectedValueOnce(new Error("файл выпал из кэша"));

    await expect(engine.resume()).resolves.toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("resume(): пустой слот (нечего возобновлять) → false", async () => {
    const engine = makeEngine();

    await expect(engine.resume()).resolves.toBe(false);
    expect(playSpy).not.toHaveBeenCalled();
  });
});

/** Вывод на устройства (2026-07-22) + голос (v2): полноценный Web Audio-граф
 *  в jsdom неподъёмен (нет AudioContext/MediaStream) — ОГРАНИЧЕНИЕ теста:
 *  вместо реальной проверки звука строим МИНИМАЛЬНЫЙ мок AudioContext (узлы —
 *  пустые заглушки connect/disconnect) и проверяем ИНТЕРФЕЙСНЫЕ эффекты: какие
 *  <audio>-тапы созданы в DOM, с каким deviceId позвали setSinkId, какие
 *  значения легли в gain-параметры узлов. Приватные поля движка (taps/master/
 *  micTaps) читаем через приведение типа — это НАМЕРЕННО замена недоступному
 *  публичному API, а не леность: снаружи класс их не отдаёт, а сравнить
 *  громкость тапа с громкостью мастера иначе нечем.
 *
 *  Проба CORS (ensureGraph) обходится намеренно: url вида
 *  http://asset.localhost/... матчит "свой протокол" в регэкспе и не идёт
 *  через fetch — webaudio-режим включается без похода в сеть (см. gochi в
 *  шапке ensureGraph). */
class MockAudioParam {
  value = 0;
  setValueCurveAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}
class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}
class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}
class MockBiquadNode extends MockAudioNode {
  type = "";
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
  gain = new MockAudioParam();
}
class MockCompressorNode extends MockAudioNode {
  threshold = new MockAudioParam();
  knee = new MockAudioParam();
  ratio = new MockAudioParam();
  attack = new MockAudioParam();
  release = new MockAudioParam();
}
class MockAnalyserNode extends MockAudioNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
}
class MockStreamDestNode extends MockAudioNode {
  stream = {} as MediaStream;
}
class MockAudioContext {
  destination = {};
  currentTime = 0;
  state = "running";
  createBiquadFilter() {
    return new MockBiquadNode() as unknown as BiquadFilterNode;
  }
  createGain() {
    return new MockGainNode() as unknown as GainNode;
  }
  createMediaElementSource() {
    return new MockAudioNode() as unknown as MediaElementAudioSourceNode;
  }
  createMediaStreamSource() {
    return new MockAudioNode() as unknown as MediaStreamAudioSourceNode;
  }
  createMediaStreamDestination() {
    return new MockStreamDestNode() as unknown as MediaStreamAudioDestinationNode;
  }
  createDynamicsCompressor() {
    return new MockCompressorNode() as unknown as DynamicsCompressorNode;
  }
  createAnalyser() {
    return new MockAnalyserNode() as unknown as AnalyserNode;
  }
  resume = vi.fn(async () => {});
}

/** Приватные поля AudioEngine, нужные только тестам (см. шапку выше). */
interface EngineInternals {
  taps: { deviceId: string; ok: boolean; el: HTMLAudioElement; gain: { gain: { value: number } } }[];
  master: { gain: { value: number } } | null;
  micTaps: Set<unknown>;
  tapWork: Promise<void>;
}
const peek = (e: AudioEngine): EngineInternals => e as unknown as EngineInternals;
/** Дождаться конца текущей реконсиляции тапов (setSinkId/play/reconcileMic —
 *  всё асинхронно и сериализовано одной очередью, см. queueTapReconcile). */
const flush = (e: AudioEngine): Promise<void> => peek(e).tapWork;
/** Та же перцептивная кривая громкости, что в audioEngine.ts (volCurve) —
 *  дубль намеренный, регресс-страховка формулы, как TTL_MS в usePlayback.test.ts. */
const volCurve = (v: number) => Math.pow(Math.max(0, Math.min(100, v)) / 100, 2);
const ASSET_URL = "http://asset.localhost/x.webm"; // обходит CORS-пробу — сразу webaudio

describe("AudioEngine: маршрутизация на устройства (тапы)", () => {
  let setSinkIdSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("AudioContext", MockAudioContext);
    setSinkIdSpy = vi.fn(async function (this: HTMLMediaElement, id: string) {
      Object.defineProperty(this, "sinkId", { value: id, configurable: true });
    });
    (HTMLMediaElement.prototype as unknown as { setSinkId: typeof setSinkIdSpy }).setSinkId = setSinkIdSpy;
    if (!("sinkId" in HTMLMediaElement.prototype)) {
      Object.defineProperty(HTMLMediaElement.prototype, "sinkId", { value: "", writable: true, configurable: true });
    }
  });

  it("setOutputs(): создаёт тап на маршрут (setSinkId+play), пустой список сносит его", async () => {
    const engine = makeEngine();
    await engine.play(ASSET_URL, 1, 0);

    engine.setOutputs([{ deviceId: "dev1", volume: 50 }]);
    await flush(engine);

    expect(setSinkIdSpy).toHaveBeenCalledWith("dev1");
    expect(document.querySelectorAll("audio[data-muza-tap]")).toHaveLength(1);
    const taps = peek(engine).taps;
    expect(taps).toHaveLength(1);
    expect(taps[0]).toMatchObject({ deviceId: "dev1", ok: true });

    // Пустой список маршрутов — снос тапа (возврат к системному выходу)
    engine.setOutputs([]);
    await flush(engine);
    expect(peek(engine).taps).toHaveLength(0);
    expect(document.querySelectorAll("audio[data-muza-tap]")).toHaveLength(0);
  });

  it("setOutputs(): второй вызов сносит маршруты, которых больше нет, и создаёт новые — без дублей", async () => {
    const engine = makeEngine();
    await engine.play(ASSET_URL, 1, 0);

    engine.setOutputs([{ deviceId: "dev1", volume: 50 }]);
    await flush(engine);
    expect(peek(engine).taps.map((t) => t.deviceId)).toEqual(["dev1"]);

    engine.setOutputs([{ deviceId: "dev2", volume: 50 }]);
    await flush(engine);
    expect(peek(engine).taps.map((t) => t.deviceId)).toEqual(["dev2"]);
    expect(document.querySelectorAll("audio[data-muza-tap]")).toHaveLength(1); // dev1 снесён, не задвоился

    // Тот же маршрут повторно — реконсиляция идемпотентна, тап не пересоздаётся
    setSinkIdSpy.mockClear();
    engine.setOutputs([{ deviceId: "dev2", volume: 50 }]);
    await flush(engine);
    expect(setSinkIdSpy).not.toHaveBeenCalled();
    expect(peek(engine).taps).toHaveLength(1);
  });

  it("громкость тапа НЕЗАВИСИМА от мастера: followsMaster решает, без него — мастер не участвует", async () => {
    const engine = makeEngine();
    await engine.play(ASSET_URL, 1, 0);

    engine.setOutputs([
      { deviceId: "dev-free", volume: 80 }, // followsMaster не задан — мастер игнорируется
      { deviceId: "dev-follow", volume: 60, followsMaster: true },
    ]);
    await flush(engine);

    engine.setVolume(10); // почти тихий мастер (слайдер приложения)

    const taps = peek(engine).taps;
    const free = taps.find((t) => t.deviceId === "dev-free")!;
    const follow = taps.find((t) => t.deviceId === "dev-follow")!;

    expect(free.gain.gain.value).toBeCloseTo(volCurve(80)); // мастер не домножен
    expect(follow.gain.gain.value).toBeCloseTo(volCurve(60) * volCurve(10)); // мастер домножен
    // Мастер при живых тапах нейтрален (1) — громкость приложения раздаётся
    // ПЕР-ТАПОВО, а не через общий гейн (иначе dev-free тоже присел бы).
    expect(peek(engine).master?.gain.value).toBe(1);
  });

  it("укрепление: setSinkId read-back — несовпадение el.sinkId топит тап (Chromium молча падает на дефолт)", async () => {
    setSinkIdSpy.mockImplementation(async function (this: HTMLMediaElement) {
      // Устройство пропало между enumerate и setSinkId — Chromium НЕ бросает,
      // просто остаётся на дефолтном выходе (отчёт P).
      Object.defineProperty(this, "sinkId", { value: "", configurable: true });
    });
    const engine = makeEngine();
    await engine.play(ASSET_URL, 1, 0);

    engine.setOutputs([{ deviceId: "dev-ghost", volume: 100 }]);
    await flush(engine);

    expect(peek(engine).taps).toHaveLength(0); // тап не прижился — считаем отказом
    expect(document.querySelectorAll("audio[data-muza-tap]")).toHaveLength(0);
  });

  describe("голос (mixMic) — reconcileMic", () => {
    const micTrack = () => ({
      onended: null as (() => void) | null,
      stop: vi.fn(),
      getSettings: () => ({}) as MediaTrackSettings,
    });

    afterEach(() => {
      delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    });

    it("mixMic-тап получает голос микрофона, тап без mixMic — нет", async () => {
      const track = micTrack();
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
      const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
      (navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia };

      const engine = makeEngine();
      await engine.play(ASSET_URL, 1, 0);
      engine.setOutputs([
        { deviceId: "dev-mic", volume: 100, mixMic: true },
        { deviceId: "dev-plain", volume: 100 },
      ]);
      await flush(engine);

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      const taps = peek(engine).taps;
      const micTap = taps.find((t) => t.deviceId === "dev-mic")!;
      const plainTap = taps.find((t) => t.deviceId === "dev-plain")!;
      expect(micTap.el.dataset.muzaMic).toBe("1");
      expect(plainTap.el.dataset.muzaMic).toBeUndefined();
      expect(peek(engine).micTaps.has(micTap)).toBe(true);
      expect(peek(engine).micTaps.has(plainTap)).toBe(false);

      // Сняли mixMic-маршрут — голосу больше некуда идти, микрофон глушится
      engine.setOutputs([{ deviceId: "dev-plain", volume: 100 }]);
      await flush(engine);
      expect(track.stop).toHaveBeenCalled();
      expect(getUserMedia).toHaveBeenCalledTimes(1); // не переоткрывали заново
    });

    it("укрепление: getUserMedia получает echoCancellation/noiseSuppression/autoGainControl=false ВНУТРИ audio", async () => {
      const track = micTrack();
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
      const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
      (navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia };

      const engine = makeEngine();
      await engine.play(ASSET_URL, 1, 0);
      engine.setOutputs([{ deviceId: "dev-mic", volume: 100, mixMic: true }]);
      await flush(engine);

      // Констрейнты ВНУТРИ audio-блока (не на топ-левел getUserMedia) — гоча
      // Chromium из шапки reconcileMic/micConstraints.
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: expect.objectContaining({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          voiceIsolation: false,
        }),
      });
    });

    it("укрепление: Chromium вернул AEC=true поверх запрошенного false — тихий маркер в console.warn", async () => {
      const track = {
        ...micTrack(),
        getSettings: () => ({ echoCancellation: true, noiseSuppression: false, autoGainControl: false }),
      };
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
      const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
      (navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia };
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const engine = makeEngine();
      await engine.play(ASSET_URL, 1, 0);
      engine.setOutputs([{ deviceId: "dev-mic", volume: 100, mixMic: true }]);
      await flush(engine);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("AEC/NS/AGC"), expect.anything());
      warnSpy.mockRestore();
    });
  });
});
