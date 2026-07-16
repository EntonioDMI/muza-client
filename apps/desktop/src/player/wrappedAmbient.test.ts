/** Эмбиент-канал Wrapped (редизайн 2026-07-16): пока открыт оверлей «Итоги
 *  года», тихо играет топ-трек — ОТДЕЛЬНЫМ <audio>, не через usePlayback
 *  (startAt перезаписал бы очередь/позицию пользователя, восстановление
 *  хрупкое — см. бриф).
 *
 *  Контракт по брифу владельца:
 *  - вход: основной плеер играл → пауза СРАЗУ (не после резолва), запомнить;
 *  - fade-in ПОСЛЕ готовности резолва (кэш-мисс может занять секунды,
 *    оверлей звука не ждёт);
 *  - выход: fade-out ~200 мс → стоп; плеер вернуть, если играл на входе
 *    И сейчас молчит (медиа-клавишей могли возобновить раньше нас);
 *  - ошибка резолва → молча без звука, оверлей живёт;
 *  - закрыли раньше, чем дорезолвилось → звук НЕ стартует (гонка).
 *
 *  Всё проверяется по наблюдаемому поведению стаба <audio> и колбэков
 *  плеера — внутренние флаги класса тестов не интересуют. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AMBIENT_FADE_IN_MS,
  AMBIENT_FADE_OUT_MS,
  ambientGain,
  WrappedAmbient,
} from "./wrappedAmbient";

/** Стаб <audio>: ровно те поля, которые трогает канал. */
function makeAudioStub() {
  const el = {
    src: "",
    loop: false,
    volume: 1,
    paused: true,
    preload: "",
    play: vi.fn(async () => {
      el.paused = false;
    }),
    pause: vi.fn(() => {
      el.paused = true;
    }),
    removeAttribute: vi.fn((name: string) => {
      if (name === "src") el.src = "";
    }),
    load: vi.fn(),
  };
  return el;
}

type AudioStub = ReturnType<typeof makeAudioStub>;

function makeHarness(opts?: { playing?: boolean }) {
  let resolveUrl!: (url: string) => void;
  let rejectUrl!: (e: Error) => void;
  const resolved = new Promise<string>((res, rej) => {
    resolveUrl = res;
    rejectUrl = rej;
  });
  const audio = makeAudioStub();
  const playerPlaying = { current: opts?.playing ?? true };
  const deps = {
    resolve: vi.fn(() => resolved),
    pausePlayer: vi.fn(() => {
      playerPlaying.current = false;
    }),
    resumePlayer: vi.fn(() => {
      playerPlaying.current = true;
    }),
    isPlayerPlaying: () => playerPlaying.current,
    createAudio: () => audio as unknown as HTMLAudioElement,
  };
  const ambient = new WrappedAmbient(deps);
  return { ambient, audio, deps, playerPlaying, resolveUrl, rejectUrl };
}

/** Дать микротаскам резолва добежать (fake timers их не двигают). */
const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve());

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ambientGain", () => {
  it("перцептивная кривая: 0 → 0, 100 → 1, 20 → тихие ~4%", () => {
    expect(ambientGain(0)).toBe(0);
    expect(ambientGain(100)).toBe(1);
    expect(ambientGain(20)).toBeCloseTo(0.04, 5);
  });
});

describe("WrappedAmbient: вход", () => {
  it("играющий плеер ставится на паузу сразу, не дожидаясь резолва", () => {
    const { ambient, deps } = makeHarness({ playing: true });
    ambient.start(20);
    expect(deps.pausePlayer).toHaveBeenCalledTimes(1);
    expect(deps.resolve).toHaveBeenCalledTimes(1);
  });

  it("молчащий плеер не трогаем — ни паузы на входе, ни resume на выходе", async () => {
    const { ambient, deps, resolveUrl } = makeHarness({ playing: false });
    ambient.start(20);
    expect(deps.pausePlayer).not.toHaveBeenCalled();
    resolveUrl("asset://top-track");
    await flushMicrotasks();
    ambient.stop();
    vi.advanceTimersByTime(AMBIENT_FADE_OUT_MS + 100);
    expect(deps.resumePlayer).not.toHaveBeenCalled();
  });

  it("после резолва звук стартует с нуля и плавно доезжает до целевой громкости", async () => {
    const { ambient, audio, resolveUrl } = makeHarness();
    ambient.start(20);
    resolveUrl("asset://top-track");
    await flushMicrotasks();
    expect(audio.src).toBe("asset://top-track");
    expect(audio.loop).toBe(true);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.volume).toBeLessThan(0.005); // фейд начинается из тишины
    vi.advanceTimersByTime(AMBIENT_FADE_IN_MS + 100);
    expect(audio.volume).toBeCloseTo(ambientGain(20), 3);
  });
});

describe("WrappedAmbient: выход", () => {
  it("fade-out ~200мс, затем стоп и возврат игравшего плеера", async () => {
    const { ambient, audio, deps, playerPlaying, resolveUrl } = makeHarness({ playing: true });
    ambient.start(20);
    resolveUrl("asset://top-track");
    await flushMicrotasks();
    vi.advanceTimersByTime(AMBIENT_FADE_IN_MS + 100);

    playerPlaying.current = false; // пауза с входа всё ещё действует
    ambient.stop();
    expect(audio.pause).not.toHaveBeenCalled(); // фейд ещё идёт
    vi.advanceTimersByTime(AMBIENT_FADE_OUT_MS + 100);
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.src).toBe(""); // источник снят — файл кэша не держим
    expect(deps.resumePlayer).toHaveBeenCalledTimes(1);
  });

  it("если плеер уже возобновили (медиа-клавиша) — второй раз не запускаем", async () => {
    const { ambient, deps, playerPlaying, resolveUrl } = makeHarness({ playing: true });
    ambient.start(20);
    resolveUrl("asset://top-track");
    await flushMicrotasks();
    playerPlaying.current = true; // SMTC play пока оверлей открыт
    ambient.stop();
    vi.advanceTimersByTime(AMBIENT_FADE_OUT_MS + 100);
    expect(deps.resumePlayer).not.toHaveBeenCalled();
  });

  it("stop без start — тихий no-op", () => {
    const { ambient, audio, deps } = makeHarness();
    ambient.stop();
    vi.advanceTimersByTime(1000);
    expect(audio.pause).not.toHaveBeenCalled();
    expect(deps.resumePlayer).not.toHaveBeenCalled();
  });
});

describe("WrappedAmbient: гонки и ошибки", () => {
  it("закрыли раньше, чем дорезолвилось — звук не стартует, плеер возвращён", async () => {
    const { ambient, audio, deps, playerPlaying, resolveUrl } = makeHarness({ playing: true });
    ambient.start(20);
    playerPlaying.current = false;
    ambient.stop(); // оверлей закрыт, добыча ещё идёт
    vi.advanceTimersByTime(AMBIENT_FADE_OUT_MS + 100);
    expect(deps.resumePlayer).toHaveBeenCalledTimes(1);

    resolveUrl("asset://too-late");
    await flushMicrotasks();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("ошибка резолва — молча без звука; выход всё равно возвращает плеер", async () => {
    const { ambient, audio, deps, playerPlaying, rejectUrl } = makeHarness({ playing: true });
    ambient.start(20);
    rejectUrl(new Error("нет живых источников"));
    await flushMicrotasks();
    expect(audio.play).not.toHaveBeenCalled();

    playerPlaying.current = false;
    ambient.stop();
    vi.advanceTimersByTime(AMBIENT_FADE_OUT_MS + 100);
    expect(deps.resumePlayer).toHaveBeenCalledTimes(1);
  });

  it("повторный start после stop — новая сессия, звук снова играет", async () => {
    const first = makeHarness({ playing: false });
    first.ambient.start(20);
    first.resolveUrl("asset://one");
    await flushMicrotasks();
    first.ambient.stop();
    vi.advanceTimersByTime(AMBIENT_FADE_OUT_MS + 100);

    first.ambient.start(20);
    await flushMicrotasks();
    vi.advanceTimersByTime(AMBIENT_FADE_IN_MS + 100);
    expect(first.audio.play).toHaveBeenCalledTimes(2);
    expect(first.audio.volume).toBeCloseTo(ambientGain(20), 3);
  });
});

describe("WrappedAmbient: регулятор", () => {
  it("setVolume меняет громкость играющего звука по кривой", async () => {
    const { ambient, audio, resolveUrl } = makeHarness();
    ambient.start(20);
    resolveUrl("asset://top-track");
    await flushMicrotasks();
    vi.advanceTimersByTime(AMBIENT_FADE_IN_MS + 100);

    ambient.setVolume(60);
    expect(audio.volume).toBeCloseTo(ambientGain(60), 3);
    ambient.setVolume(0);
    expect(audio.volume).toBe(0);
  });
});
