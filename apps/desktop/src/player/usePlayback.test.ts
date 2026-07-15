/** Репро жалобы владельца (2026-07-15): «включаешь песню, она ещё не
 *  загрузилась — играет старая, и её никак не выключить, пока новая не
 *  загрузится».
 *
 *  Оба дефекта проверяются по НАБЛЮДАЕМОМУ поведению движка (шпионы
 *  play/pause), а не по внутренним флагам хука и не по новым модулям:
 *  тест обязан краснеть на СТАРОМ коде по существу («старый трек не
 *  заглушили», «трек заиграл после паузы»), а не на отсутствии импорта.
 *
 *  Управляемая добыча (deferResolve) — стенд вместо живого cache-miss:
 *  yt-dlp качает файл секундами, и всё окно между кликом и engine.play()
 *  и есть предмет бага. */

import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzaApi } from "@muza/api-client";
import { DEFAULT_PREFS, type Prefs } from "../types";
import type { EngineCallbacks } from "./audioEngine";
import type { PlayerTrack } from "./types";
import { usePlayback } from "./usePlayback";

const h = vi.hoisted(() => ({
  resolvePlayable: vi.fn(),
  getTrackSources: vi.fn(),
  onError: vi.fn(),
  engine: {
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    position: vi.fn(),
    preload: vi.fn(),
    setVolume: vi.fn(),
    setSpeed: vi.fn(),
    setEq: vi.fn(),
    analyser: vi.fn(),
  },
  /** Колбэки, которые usePlayback отдал движку — ими эмулируем timeupdate. */
  cb: { current: null as EngineCallbacks | null },
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  isTauri: () => true,
  invoke: vi.fn(),
}));

vi.mock("../lib/engine", () => ({
  engineAvailable: () => true,
  resolvePlayable: h.resolvePlayable,
}));

vi.mock("./audioEngine", () => ({
  AudioEngine: class {
    static normFactor = () => 1;
    play = h.engine.play;
    pause = h.engine.pause;
    resume = h.engine.resume;
    stop = h.engine.stop;
    seek = h.engine.seek;
    position = h.engine.position;
    preload = h.engine.preload;
    setVolume = h.engine.setVolume;
    setSpeed = h.engine.setSpeed;
    setEq = h.engine.setEq;
    analyser = h.engine.analyser;
    constructor(cb: EngineCallbacks) {
      h.cb.current = cb;
    }
  },
}));

const trk = (id: string): PlayerTrack => ({
  id,
  kind: "catalog",
  title: `Track ${id}`,
  artist: "Artist",
  album: "",
  duration: 200,
  cover: null,
  explicit: false,
  loudness: null,
});

const A = trk("a");
const B = trk("b");

const api = { getTrackSources: h.getTrackSources } as unknown as MuzaApi;

const mount = (prefs: Partial<Prefs> = {}) =>
  renderHook(() =>
    usePlayback({
      api,
      initialQueue: [A, B],
      prefs: { ...DEFAULT_PREFS, ...prefs },
      onError: h.onError,
    }),
  );

type Hook = RenderHookResult<ReturnType<typeof usePlayback>, unknown>;

/** Держим добычу «висящей», как yt-dlp на cache-miss; вернувшийся колбэк её отпускает. */
function deferResolve(url: string): () => void {
  let release!: () => void;
  h.resolvePlayable.mockReturnValueOnce(
    new Promise((res) => {
      release = () => res({ url, fromCache: false, provider: "youtube" });
    }),
  );
  return release;
}

/** Довести трек A до реально играющего состояния (добыча мгновенна = кэш-хит). */
async function playA({ result }: Hook): Promise<void> {
  h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
  await act(async () => {
    result.current.playContext([A, B], "a");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Реализации задаём явно: clearAllMocks стирает только вызовы, а reset —
  // и реализации; position без неё вернул бы undefined и remaining стал бы NaN.
  h.engine.play.mockImplementation(async () => {});
  h.engine.resume.mockImplementation(async () => {});
  h.engine.position.mockReturnValue(0);
  h.engine.analyser.mockReturnValue(null);
  h.resolvePlayable.mockReset();
  h.getTrackSources.mockImplementation(async () => []);
  h.cb.current = null;
});

describe("usePlayback: старый трек и добыча нового", () => {
  it("ручной клик глушит играющий трек ДО добычи нового, а не после", async () => {
    const hook = mount();
    await playA(hook);
    expect(h.engine.play).toHaveBeenCalledTimes(1);
    h.engine.pause.mockClear();

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      hook.result.current.playContext([A, B], "b");
    });

    // Добыча B ещё идёт (releaseB не вызван) — ровно то окно, в котором
    // владелец слышит старую песню. Движок обязан уже молчать.
    expect(h.engine.pause).toHaveBeenCalledTimes(1);
    expect(h.engine.play).toHaveBeenCalledTimes(1); // новый ещё не заводился
    expect(hook.result.current.buffering).toBe(true);

    await act(async () => {
      releaseB();
    });
    expect(h.engine.play).toHaveBeenCalledTimes(2); // добыли — заиграл
  });

  it("пауза во время добычи не даёт треку заиграть, когда добыча пришла", async () => {
    const hook = mount();
    await playA(hook);

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      hook.result.current.playContext([A, B], "b");
    });
    expect(hook.result.current.buffering).toBe(true);

    // Пользователь жмёт паузу, пока крутится спиннер добычи
    await act(async () => {
      hook.result.current.toggle();
    });
    expect(hook.result.current.playing).toBe(false);

    const playsBefore = h.engine.play.mock.calls.length;
    await act(async () => {
      releaseB();
    });

    // Нажатие паузы обязано пережить приход добычи: трек не заводится сам.
    expect(h.engine.play).toHaveBeenCalledTimes(playsBefore);
    expect(hook.result.current.playing).toBe(false);
    // Спиннер тоже обязан погаснуть — ждать больше нечего.
    expect(hook.result.current.buffering).toBe(false);
  });

  it("после паузы во время добычи play заводит трек заново", async () => {
    const hook = mount();
    await playA(hook);

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      hook.result.current.playContext([A, B], "b");
    });
    await act(async () => {
      hook.result.current.toggle();
    });
    await act(async () => {
      releaseB();
    });

    // Отменённый старт не оставил движок заряженным — play обязан добыть
    // заново, а не «возобновить» слот (там ещё старый трек: resume завёл бы
    // ЕГО, а бар показывал бы новый — ровно тот рассинхрон, от которого
    // startedIdRef и заведён, см. T2 в knowledge).
    h.resolvePlayable.mockResolvedValueOnce({ url: "b.webm", fromCache: true, provider: "youtube" });
    await act(async () => {
      hook.result.current.toggle();
    });
    expect(hook.result.current.playing).toBe(true);
    expect(h.engine.resume).not.toHaveBeenCalled();
    expect(h.engine.play).toHaveBeenLastCalledWith("b.webm", 1, 0);
  });

  it("автопереход с кроссфейдом НЕ глушит старый трек — он перетекает в новый", async () => {
    const hook = mount({ crossfade: true });
    await playA(hook);
    // Шаффл — чтобы соседа НЕ преднагрузили (usePlayback не греет его при
    // shuffle) и авто-переход пошёл через живую добычу. Иначе тест прошёл бы
    // по мгновенной ветке preloaded и про auto не доказал бы ничего.
    act(() => {
      hook.result.current.toggleShuffle();
    });
    h.engine.pause.mockClear();

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      h.cb.current?.onTime(197); // remaining 3с ≤ кроссфейд 4с → ранний стык
    });

    expect(h.engine.pause).not.toHaveBeenCalled();
    await act(async () => {
      releaseB();
    });
    // Кроссфейд доехал до движка — глушение его не подменило
    expect(h.engine.play).toHaveBeenLastCalledWith("b.webm", 1, 4);
  });

  it("предзагруженный трек стартует мгновенно — глушить нечего", async () => {
    const hook = mount();
    await playA(hook);

    // Прогреваем преднагрузку соседа (remaining 15с ≤ PRELOAD_AHEAD_SEC)
    h.resolvePlayable.mockResolvedValueOnce({ url: "b.webm", fromCache: true, provider: "youtube" });
    await act(async () => {
      h.cb.current?.onTime(185);
    });
    expect(h.engine.preload).toHaveBeenCalledWith("b.webm");
    h.engine.pause.mockClear();

    // Ручной next: URL уже в руках, добычи не будет — паузе взяться неоткуда
    await act(async () => {
      hook.result.current.next();
    });

    expect(h.engine.pause).not.toHaveBeenCalled();
    expect(h.engine.play).toHaveBeenCalledTimes(2);
  });
});
