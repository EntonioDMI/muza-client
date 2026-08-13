/** Регресс 12.08: нативный путь молчал вместо того, чтобы признать отказ.
 *
 *  Жалоба владельца (пункт 1 из семи): «функция локальной библиотеки вообще
 *  перестала работать с новым движком». Разбор показал, что виноват не выбор
 *  файлов, а РЕАКЦИЯ движка на неудачу — она отсутствовала целиком:
 *
 *  1) `play()` для файла на диске звал `native_play` через хелпер `call()`,
 *     который глотает любой отказ в `undefined`. Порядок строк при этом был
 *     самоубийственный: прежний движок глушился и `native = true` ставилось ДО
 *     вызова. Файла нет / формат чужой / устройство занято — прежний движок уже
 *     выключен, нативный не завёлся, а плеер уверен, что музыка идёт.
 *
 *  2) Отказ ПОСЛЕ старта (проба формата живёт внутри потока декодера, до
 *     возврата из команды её результат неизвестен) вообще никуда не приезжал:
 *     Rust писал причину в `eprintln!`, у собранного приложения консоли нет.
 *     `drained` при этом не выставлялся, поэтому не приходил и конец трека —
 *     плеер вставал навсегда с бегущей полоской и без звука.
 *
 *  Оба сценария ниже проверяют ОДИН инвариант: нативный путь не имеет права
 *  оставить человека в тишине молча. Не завелось — отдай трек прежнему движку;
 *  не смог и он — скажи вслух. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

/** Прежний движок подменяем целиком: нас интересует, ПОЗВАЛИ ли его. */
const webPlay = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const webStop = vi.hoisted(() => vi.fn());
vi.mock("./audioEngine", () => ({
  AudioEngine: class {
    play = webPlay;
    stop = webStop;
    preload = vi.fn();
    pause = vi.fn();
  },
}));

const { HybridAudioEngine } = await import("./nativeEngine");

const POLL_MS = 250;
/** Адрес файла на диске — по нему движок выбирает нативный путь. */
const FILE_URL = "http://asset.localhost/C%3A%5CMusic%5C1.mp3";

interface Status {
  position: number;
  ended: boolean;
  playing: boolean;
  error: string | null;
}

const ok = (over: Partial<Status> = {}): Status => ({
  position: 0,
  ended: false,
  playing: true,
  error: null,
  ...over,
});

describe("нативный путь не завёлся", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    webPlay.mockClear();
    webStop.mockClear();
  });

  it("отказ native_play отдаёт трек прежнему движку, а не тишине", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "native_play") return Promise.reject(new Error("открыть файл: не найден"));
      if (cmd === "native_status") return Promise.resolve(ok());
      return Promise.resolve(undefined);
    });
    const onError = vi.fn();
    const engine = new HybridAudioEngine({ onEnded: vi.fn(), onTime: vi.fn(), onError } as never);

    await engine.play(FILE_URL, 1);

    // Главное: трек ушёл прежнему движку с тем же адресом.
    expect(webPlay).toHaveBeenCalledWith(FILE_URL, 1, 0);
    engine.stop();
  });

  it("прежний движок не глушится, пока нативный не подтвердил старт", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "native_play") return Promise.reject(new Error("нет устройства вывода"));
      return Promise.resolve(ok());
    });
    const engine = new HybridAudioEngine({
      onEnded: vi.fn(),
      onTime: vi.fn(),
      onError: vi.fn(),
    } as never);

    await engine.play(FILE_URL, 1);

    // До починки stop() стоял ПЕРЕД вызовом — прежний движок оставался
    // выключенным при неудаче, и играть было нечему.
    expect(webStop).not.toHaveBeenCalled();
    engine.stop();
  });
});

describe("декодер умер уже после старта", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    webPlay.mockClear();
    webStop.mockClear();
  });

  it("причина из статуса поднимает откат на прежний движок", async () => {
    let status = ok();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "native_status") return Promise.resolve(status);
      return Promise.resolve(undefined);
    });
    const engine = new HybridAudioEngine({
      onEnded: vi.fn(),
      onTime: vi.fn(),
      onError: vi.fn(),
    } as never);
    await engine.play(FILE_URL, 1);
    expect(webPlay).not.toHaveBeenCalled(); // старт удался — прежний движок не нужен

    // Проба формата провалилась уже в потоке декодера.
    status = ok({ error: "источник не открылся: unsupported format" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(webPlay).toHaveBeenCalledWith(FILE_URL, 1, 0);
    engine.stop();
  });

  it("откат делается ОДИН раз, а не каждый такт опроса", async () => {
    const status = ok({ error: "декодирование оборвалось: I/O" });
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "native_status") return Promise.resolve(status);
      return Promise.resolve(undefined);
    });
    const engine = new HybridAudioEngine({
      onEnded: vi.fn(),
      onTime: vi.fn(),
      onError: vi.fn(),
    } as never);
    await engine.play(FILE_URL, 1);

    // Статус опрашивается 4 раза в секунду: без защёлки один мёртвый декодер
    // перезапускал бы прежний движок бесконечно.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(webPlay).toHaveBeenCalledTimes(1);
    engine.stop();
  });
});

/** Регресс 13.08: настройки, выставленные ДО первого трека, пропадали молча.
 *
 *  Тот же инвариант, что и у соседей по файлу («не оставлять человека в тишине
 *  молча»), только с другой стороны: у высоты тона и характера темпа стояло
 *  `if (!this.native) return;`. Флаг `native` поднимается ТОЛЬКО внутри play(),
 *  а usePlayback доносит сохранённые значения сразу после создания движка —
 *  то есть до первого трека, ровно в этот `return`.
 *
 *  Итог: высота из прошлой сессии и включённый в настройках WSOLA не доезжали
 *  до Rust никогда. На экране «−2», в звуке ноль.
 *
 *  Адресат у команды есть всегда: `native_set_pitch`/`native_set_tempo_mode`
 *  пишут значение в сессионное состояние Rust (`EngineState`), и каждый новый
 *  трек забирает его сам. Проверяем именно это — команда ушла, хотя ни одного
 *  play() ещё не было. */
describe("настройки до первого трека доезжают до Rust", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("высота тона уходит в Rust и без играющего трека", () => {
    const engine = new HybridAudioEngine({ onEnded: vi.fn(), onTime: vi.fn(), onError: vi.fn() } as never);

    engine.setPitch(-2);

    expect(invoke).toHaveBeenCalledWith("native_set_pitch", { semitones: -2 });
  });

  it("характер темпа уходит в Rust и без играющего трека", () => {
    const engine = new HybridAudioEngine({ onEnded: vi.fn(), onTime: vi.fn(), onError: vi.fn() } as never);

    engine.setTempoMode(true);

    expect(invoke).toHaveBeenCalledWith("native_set_tempo_mode", { wsola: true });
  });
});
