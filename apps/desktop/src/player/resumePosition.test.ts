/** Регресс 11.08: «продолжить с места» срабатывало не только при возврате в
 *  приложение, но и на КАЖДОМ повторном запуске песни в той же сессии.
 *
 *  Жалоба владельца: «слушаешь песню, на середине переключаешься на другой
 *  трек, возвращаешься — и он продолжает с того места, а не с начала».
 *
 *  Причина: досик в usePlayback.startAt стоял безусловно, для любого трека, у
 *  которого нашлась запись в resumeStore. А карта помнит позиции сотен треков
 *  (LRU на 300) — то есть любой повторный запуск подхватывал прошлую секунду.
 *  Для песни это неверно: включил заново — значит с начала.
 *
 *  Восстановлению подлежит РОВНО тот трек, который App.tsx положил в очередь
 *  при запуске (initialPlaybackState), и ровно один раз за сессию. */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzaApi } from "@muza/api-client";
import { DEFAULT_PREFS } from "../types";
import type { EngineCallbacks } from "./audioEngine";
import type { PlayerTrack } from "./types";
import { usePlayback } from "./usePlayback";

const h = vi.hoisted(() => ({
  resolvePlayable: vi.fn(),
  getTrackSources: vi.fn(),
  onError: vi.fn(),
  resumeGet: vi.fn(),
  seek: vi.fn(),
  play: vi.fn(),
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
  cacheRemove: vi.fn(),
  engineStreamStart: vi.fn(),
}));

vi.mock("../lib/resumeStore", () => ({
  resumeStore: { get: h.resumeGet, save: vi.fn(), saveLast: vi.fn(), getLast: vi.fn() },
}));

vi.mock("./audioEngine", async (orig) => {
  const real = await orig<typeof import("./audioEngine")>();
  return {
    ...real,
    AudioEngine: class {
      static normFactor = () => 1;
      play = h.play;
      seek = h.seek;
      pause = vi.fn();
      resume = vi.fn();
      stop = vi.fn();
      position = vi.fn(() => 0);
      preload = vi.fn();
      setVolume = vi.fn();
      setSpeed = vi.fn();
      setEq = vi.fn();
      setOutputs = vi.fn();
      setMicConfig = vi.fn();
      analyser = vi.fn();
      constructor(cb: EngineCallbacks) {
        h.cb.current = cb;
      }
    },
  };
});

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

/** 90 секунд — «осмысленная» позиция: не у начала (>5) и не у конца (<190). */
const SAVED = 90;

function mount(initialPos: number) {
  return renderHook(() =>
    usePlayback({
      api,
      initialQueue: [A, B],
      initialPos,
      prefs: { ...DEFAULT_PREFS, resumePosition: true },
      onError: h.onError,
    }),
  );
}

describe("«продолжить с места» применяется только к восстановленному треку", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.resolvePlayable.mockResolvedValue({ url: "asset://x", provider: "youtube" });
    h.getTrackSources.mockResolvedValue([{ provider: "youtube", url: "u" }]);
    // Позиция сохранена у ОБОИХ треков — как в жизни: карта помнит всё, что
    // слушали. Различать их обязан не resumeStore, а сам плеер.
    h.resumeGet.mockReturnValue(SAVED);
  });

  it("трек, восстановленный при запуске, продолжается с сохранённой секунды", async () => {
    const { result } = mount(SAVED);

    await act(async () => {
      result.current.playContext([A, B], "a");
    });

    expect(h.seek).toHaveBeenCalledWith(SAVED, true);
  });

  it("тот же трек, включённый заново в той же сессии, играет С НАЧАЛА", async () => {
    const { result } = mount(SAVED);

    // Восстановленный старт — досик законен.
    await act(async () => {
      result.current.playContext([A, B], "a");
    });
    h.seek.mockClear();

    // Ушли на соседний трек и вернулись. До починки здесь снова прилетал
    // seek(90) — ровно то, на что жаловался владелец.
    await act(async () => {
      result.current.playContext([A, B], "b");
    });
    await act(async () => {
      result.current.playContext([A, B], "a");
    });

    expect(h.seek).not.toHaveBeenCalled();
  });

  it("сессия без восстановления: первый же трек играет с начала", async () => {
    const { result } = mount(0);

    await act(async () => {
      result.current.playContext([A, B], "a");
    });

    expect(h.seek).not.toHaveBeenCalled();
  });
});
