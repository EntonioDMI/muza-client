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
import { AudioEngine, noteUserGesture, resetPrewarmForTests } from "./audioEngine";

const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");
const loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load");

let onError: ReturnType<typeof vi.fn<(message: string) => void>>;
/** Сколько AudioContext создано за тест и сколько раз собиралась цепь узлов
 *  (анализатор в ней один — по нему и считаем). MockAudioContext инкрементит
 *  сам. Смысл предгрева — построить граф ОДИН раз и ЗАРАНЕЕ; счётчики ловят
 *  оба края: и второй контекст, и тихую пересборку узлов. */
let ctxCount = 0;
let chainCount = 0;

const makeEngine = () => {
  onError = vi.fn<(message: string) => void>();
  return new AudioEngine({ onTime: () => {}, onEnded: () => {}, onError });
};

beforeEach(() => {
  // Предгрев держит МОДУЛЬНОЕ состояние (жест был / припаркованный контекст /
  // последний созданный движок) — без сброса тесты подтекали бы друг в друга.
  resetPrewarmForTests();
  ctxCount = 0;
  chainCount = 0;
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
  constructor() {
    ctxCount++;
  }
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
    chainCount++; // анализатор в цепи один — считает пересборки всей цепи
    return new MockAnalyserNode() as unknown as AnalyserNode;
  }
  resume = vi.fn(async () => {
    this.state = "running";
  });
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

/** Приватные поля AudioEngine, нужные только тестам (см. шапку выше). */
interface EngineInternals {
  taps: { deviceId: string; ok: boolean; el: HTMLAudioElement; gain: { gain: { value: number } } }[];
  master: { gain: { value: number } } | null;
  micTaps: Set<unknown>;
  micStream: MediaStream | null;
  tapWork: Promise<void>;
  ctx: MockAudioContext | null;
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

    it("граф снесён, пока висел системный запрос микрофона → поток гасится, а не течёт", async () => {
      // ⚠️ СТОРОЖ ПРОТИВ УТЕЧКИ 06.08. Системный диалог «разрешить микрофон»
      // висит СЕКУНДАМИ, и за это окно граф может умереть (проба сказала
      // «plain»). discardGraph() зовёт stopMic(), но micStream ещё null —
      // гасить нечего; прилетевший следом поток записывался в поле мёртвого
      // движка, и индикатор микрофона ОС горел до конца сессии. Снаружи не
      // лечилось: setOutputs([]) выходит по !this.ctx.
      const track = micTrack();
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
      let release!: () => void;
      const pending = new Promise<void>((r) => {
        release = r;
      });
      let entered!: () => void;
      const asked = new Promise<void>((r) => {
        entered = r;
      });
      const getUserMedia = vi.fn(async () => {
        entered();
        await pending; // запрос «висит», как настоящий системный диалог
        return stream as unknown as MediaStream;
      });
      (navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia };

      const engine = makeEngine();
      await engine.play(ASSET_URL, 1, 0);
      engine.setOutputs([{ deviceId: "dev-mic", volume: 100, mixMic: true }]);
      await asked; // разрешение спросили — дальше «диалог висит»

      // граф умирает, пока запрос в полёте
      (engine as unknown as { discardGraph: () => void }).discardGraph();
      release();
      await flush(engine);

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(track.stop).toHaveBeenCalled(); // поток погашен, а не осиротел
      expect(peek(engine).micStream).toBeNull();
    });
  });
});

/** Пауза во время кроссфейда (аудит 2026-08-03). Уходящий трек живёт в ДРУГОМ
 *  слоте, чем активный: pause() глушил только активный, а уходящий доигрывал
 *  свою кривую громкости целиком — на ползунке 8–12с это до двенадцати секунд
 *  музыки после нажатия «пауза». Кривая идёт по часам AudioContext и паузу
 *  элемента не замечает, поэтому «оно само стихнет» здесь неверно: стихнет
 *  ровно через crossfadeSec, а не сейчас.
 *
 *  Стенд webaudio (MockAudioContext) обязателен: в plain-режиме ветки фейда
 *  вообще нет (см. play(): `fade && this.ctx && ...`). jsdom не проигрывает
 *  медиа — признак paused держим сами через шпионы play/pause, иначе условие
 *  `!current.el.paused` не пустило бы код в ветку кроссфейда вообще. */
describe("AudioEngine: обрыв кроссфейда (пауза/сик/новый старт)", () => {
  const origPaused = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "paused");
  type FakeEl = HTMLMediaElement & { _paused?: boolean };
  const A_URL = "http://asset.localhost/a.webm";
  const B_URL = "http://asset.localhost/b.webm";
  const slotEls = () => [...document.querySelectorAll("audio[data-muza-slot]")] as HTMLAudioElement[];
  const soundingEls = () => slotEls().filter((el) => !el.paused);

  beforeEach(() => {
    vi.stubGlobal("AudioContext", MockAudioContext);
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get(this: FakeEl) {
        return this._paused !== false;
      },
    });
    playSpy.mockImplementation(async function (this: FakeEl) {
      this._paused = false;
    });
    pauseSpy.mockImplementation(function (this: FakeEl) {
      this._paused = true;
    });
  });

  afterEach(() => {
    if (origPaused) Object.defineProperty(HTMLMediaElement.prototype, "paused", origPaused);
  });

  /** Завести кроссфейд длиной sec: A играет, поверх него стартует B. */
  const startCrossfade = async (sec: number): Promise<AudioEngine> => {
    const engine = makeEngine();
    await engine.play(A_URL, 1, 0);
    await engine.play(B_URL, 1, sec);
    expect(soundingEls()).toHaveLength(2); // оба слота звучат — стык реально идёт
    return engine;
  };

  it("pause() глушит ОБА слота, а не только активный", async () => {
    const engine = await startCrossfade(12);

    engine.pause();

    expect(soundingEls()).toHaveLength(0);
  });

  it("seek() снимает уходящий трек", async () => {
    const engine = await startCrossfade(12);

    engine.seek(30);

    expect(soundingEls()).toHaveLength(1); // остался только тот, по которому прыгнули
  });

  it("seek(keepCrossfade) стык НЕ рвёт — это досик «продолжить с места» на старте трека", async () => {
    const engine = await startCrossfade(12);

    engine.seek(30, true);

    // Входящий трек в этот момент ещё на нуле кривой: сняли бы уходящего —
    // получили бы дыру тишиной на всю длину кроссфейда.
    expect(soundingEls()).toHaveLength(2);
  });

  it("новый старт БЕЗ фейда не оставляет уходящий доигрывать", async () => {
    const engine = await startCrossfade(12);
    // Кроссфейд выключили / трек преднагружен — старт идёт мгновенной веткой,
    // а она меняет содержимое АКТИВНОГО слота, уходящего не касаясь.
    await engine.play("http://asset.localhost/c.webm", 1, 0);

    expect(soundingEls()).toHaveLength(1);
  });

  it("resume() после паузы не воскрешает уходящий трек", async () => {
    const engine = await startCrossfade(12);
    engine.pause();

    await expect(engine.resume()).resolves.toBe(true);

    expect(soundingEls()).toHaveLength(1);
  });
});

/** Предгрев графа Web Audio по первому жесту (2026-08-06).
 *
 *  До него play() сперва ждал ensureGraph — создание AudioContext, десяти
 *  биквадов EQ, компрессора и анализатора, — и только потом присваивал el.src:
 *  всё это время элемент не качал ни байта, и первый трек сессии платил цену
 *  постройки целиком. Теперь граф строит первый pointerdown (useWarmer), а
 *  play() достраивает лишь то, что без URL решить нельзя, — подключение слотов.
 *
 *  Стенд — тот же MockAudioContext, что у маршрутизации; он же считает
 *  созданные контексты (ctxCount). Проверяются границы контракта: граф строится
 *  ОДИН раз и заранее, повторный жест ничего не пересоздаёт, предгретый
 *  контекст приостановлен, окружение без Web Audio предгрев не роняет, а
 *  сорвавшаяся CORS-проба не оставляет висеть ненужный контекст. */
describe("AudioEngine: предгрев графа по первому жесту", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", MockAudioContext);
  });

  it("жест до рождения движка: граф готов ДО play(), а play() второй не строит", async () => {
    // Ровно первый клик сессии: pointerdown прошёл, движка ещё нет — его
    // создаст startAt, уже после жеста (usePlayback заводит движок лениво).
    noteUserGesture();

    // Главное в предгреве: цепь собрана ЗДЕСЬ, на жесте, а не при рождении
    // движка. Иначе постройка просто переехала бы из play() в конструктор —
    // тот же путь «клик → звук», только раньше по нему.
    expect(ctxCount).toBe(1);
    expect(chainCount).toBe(1);

    const engine = makeEngine();
    await engine.prewarm(); // тот же промис, что запустил конструктор

    expect(engine.analyser()).not.toBeNull(); // граф есть ДО всякого URL

    await engine.play(ASSET_URL, 1, 0);

    // play() переиспользовал предгретые контекст и цепь, не пересобрал их
    expect(ctxCount).toBe(1);
    expect(chainCount).toBe(1);
  });

  it("повторный жест ничего не пересоздаёт", async () => {
    noteUserGesture();
    const engine = makeEngine();
    await engine.prewarm();
    const analyser = engine.analyser();

    noteUserGesture();
    noteUserGesture();
    await engine.prewarm();

    expect(ctxCount).toBe(1);
    expect(chainCount).toBe(1);
    expect(engine.analyser()).toBe(analyser); // тот же узел, а не новый граф
  });

  it("предгретый контекст приостановлен (не держит поток WASAPI), play() его будит", async () => {
    noteUserGesture();
    const engine = makeEngine();
    await engine.prewarm();

    const ctx = peek(engine).ctx!;
    expect(ctx.suspend).toHaveBeenCalled();
    expect(ctx.state).toBe("suspended");

    await engine.play(ASSET_URL, 1, 0);

    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.state).toBe("running");
  });

  it("жест после рождения движка греет уже созданный движок", async () => {
    const engine = makeEngine();
    expect(ctxCount).toBe(0); // жеста не было — граф не строится сам по себе

    noteUserGesture();
    await engine.prewarm();

    expect(ctxCount).toBe(1);
    expect(engine.analyser()).not.toBeNull();
  });

  it("play() посреди незавершённого предгрева не строит второй контекст", async () => {
    const engine = makeEngine();
    noteUserGesture(); // предгрев в полёте: suspend ещё не доехал
    await engine.play(ASSET_URL, 1, 0);

    expect(ctxCount).toBe(1);
    // Предгрев дождались, а не бросили на полпути (иначе suspend/resume
    // разъехались бы, и контекст остался бы в неопределённом состоянии).
    expect(peek(engine).ctx?.suspend).toHaveBeenCalled();
  });

  it("проба CORS не прошла → предгретый граф сносится, играем элементами", async () => {
    noteUserGesture();
    const engine = makeEngine();
    await engine.prewarm();
    const ctx = peek(engine).ctx!;

    // Чужой url (не asset/muza-stream) идёт через fetch-пробу, а она в стенде
    // падает — это plain-режим, и предгретый граф в нём бесполезен.
    await engine.play("https://cdn.example/x.mp3", 1, 0);

    expect(ctx.close).toHaveBeenCalled(); // не висит suspended до конца сессии
    expect(engine.analyser()).toBeNull();
    expect(playSpy).toHaveBeenCalled(); // но звук всё равно пошёл
  });

  it("окружение без Web Audio (jsdom как есть): предгрев тих, старт играет в plain", async () => {
    vi.stubGlobal("AudioContext", undefined);

    noteUserGesture();
    const engine = makeEngine();

    await expect(engine.prewarm()).resolves.toBeUndefined();
    await expect(engine.play("https://cdn.example/x.mp3", 1, 0)).resolves.toBeUndefined();
    expect(playSpy).toHaveBeenCalled();
  });

  it("без жеста вовсе play() строит граф сам — старый путь цел", async () => {
    const engine = makeEngine();

    await engine.play(ASSET_URL, 1, 0);

    expect(ctxCount).toBe(1);
    expect(engine.analyser()).not.toBeNull();
  });
});
