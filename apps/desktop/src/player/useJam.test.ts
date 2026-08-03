/** «Слушаем вместе» под переносом позиции из состояния React (03.08).
 *
 *  Jam — самый чувствительный к точности позиции потребитель во всём
 *  приложении, и единственный, чья ошибка СЛЫШНА: хост шлёт гостю свою
 *  позицию, гость сверяет её со своей, порог дрейфа 3 секунды. Загрубление
 *  позиции хотя бы на секунду с каждой стороны пробивает этот порог шумом — и
 *  у гостя срабатывает seek, музыка в наушниках прыгает на ходу.
 *
 *  Поэтому тесты здесь стерегут не «сколько рендеров», а ЗНАЧЕНИЯ:
 *   • хост шлёт позицию, живую на момент отправки, а не снятую на последнем
 *     рендере (после переноса рендеров при игре почти нет — снимок протух бы
 *     на секунды);
 *   • детект сика по-прежнему срабатывает на каждый тик, а не раз в heartbeat;
 *   • гость решает про seek по своей ЖИВОЙ позиции. */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JamEvent, JamSnapshot, MuzaApi } from "@muza/api-client";
import { createPositionStore, type PositionStore } from "./positionStore";
import type { PlayerTrack } from "./types";
import { useJam, type JamPlayback } from "./useJam";

const TRACK: PlayerTrack = {
  id: "42",
  kind: "catalog",
  title: "Трек",
  artist: "Автор",
  album: "",
  duration: 200,
  cover: null,
  explicit: false,
  loudness: null,
};

const snapshot = (isHost: boolean): JamSnapshot => ({
  code: "ABC123",
  host: { id: "u1", username: "host" },
  members: [],
  state: null,
  isHost,
});

let store: PositionStore;
let emit: (event: JamEvent) => void;
let api: MuzaApi;
let pushJamState: ReturnType<typeof vi.fn>;
let seek: ReturnType<typeof vi.fn<(sec: number) => void>>;

function playback(over: Partial<JamPlayback> = {}): JamPlayback {
  return {
    track: TRACK,
    posStore: store,
    playing: true,
    speed: 1,
    playContext: vi.fn(),
    seek,
    pause: vi.fn(),
    toggle: vi.fn(),
    insertInQueue: vi.fn(),
    queueLength: 1,
    ...over,
  };
}

const mount = (pb: JamPlayback = playback()) =>
  renderHook(() => useJam({ api, enabled: true, pb, onNotify: vi.fn() }));

beforeEach(() => {
  store = createPositionStore(0);
  seek = vi.fn<(sec: number) => void>();
  pushJamState = vi.fn().mockResolvedValue(undefined);
  emit = () => {};
  api = {
    createJam: vi.fn().mockResolvedValue(snapshot(true)),
    joinJam: vi.fn().mockResolvedValue(snapshot(false)),
    leaveJam: vi.fn().mockResolvedValue(undefined),
    pushJamState,
    addJamTrack: vi.fn().mockResolvedValue(undefined),
    getTrack: vi.fn().mockResolvedValue({ id: "42" }),
    subscribeJamEvents: vi.fn((_code: string, onEvent: (e: JamEvent) => void) => {
      emit = onEvent;
      return () => {};
    }),
  } as unknown as MuzaApi;
});

describe("useJam — хост шлёт ЖИВУЮ позицию", () => {
  it("heartbeat шлёт позицию, живую на момент отправки, а не с последнего рендера", async () => {
    vi.useFakeTimers();
    try {
      const hook = mount();
      await act(async () => {
        await hook.result.current.create();
      });

      // Ни одного рендера отсюда и до конца теста: ровно так приложение и
      // живёт после переноса позиции — играет музыка, React молчит. Снимок
      // рендера протух бы здесь на минуту с лишним.
      act(() => {
        store.set(75.4);
      });
      pushJamState.mockClear();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(pushJamState).toHaveBeenCalledTimes(1);
      expect(pushJamState.mock.calls[0][1]).toMatchObject({ posSec: 75.4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("сик хоста доезжает до гостей на тике, а не ждёт heartbeat", async () => {
    const hook = mount();
    await act(async () => {
      await hook.result.current.create();
    });
    // обычный ход времени: разрыв меньше порога — пушить нечего
    act(() => {
      store.set(0.25);
      store.set(0.5);
    });
    pushJamState.mockClear();

    act(() => {
      store.set(90); // человек перетащил полосу
    });

    expect(pushJamState).toHaveBeenCalledTimes(1);
    expect(pushJamState.mock.calls[0][1]).toMatchObject({ posSec: 90 });
  });
});

describe("useJam — гость решает про seek по своей живой позиции", () => {
  it("расхождение в пределах порога — музыку не дёргаем", async () => {
    const hook = mount();
    await act(async () => {
      await hook.result.current.join("ABC123");
    });
    act(() => {
      store.set(101); // гость идёт почти вровень с хостом
    });

    act(() => {
      emit({
        type: "state",
        state: {
          trackId: "42",
          title: "Трек",
          artist: "Автор",
          coverUrl: null,
          durationSec: 200,
          posSec: 100,
          playing: true,
          updatedAt: Date.now(),
        },
      });
    });

    expect(seek).not.toHaveBeenCalled();
  });

  it("настоящий разъезд — догоняем", async () => {
    const hook = mount();
    await act(async () => {
      await hook.result.current.join("ABC123");
    });
    act(() => {
      store.set(60);
    });

    act(() => {
      emit({
        type: "state",
        state: {
          trackId: "42",
          title: "Трек",
          artist: "Автор",
          coverUrl: null,
          durationSec: 200,
          posSec: 100,
          playing: true,
          updatedAt: Date.now(),
        },
      });
    });

    expect(seek).toHaveBeenCalledWith(100);
  });
});
