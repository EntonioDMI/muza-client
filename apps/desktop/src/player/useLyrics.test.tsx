/** Тексты трека: показ текущего + упреждающая загрузка соседа по очереди.
 *
 *  Замер, ради которого хук трогали (14.08, полный путь «трек сменился →
 *  строки готовы», 5 холодных треков БЕЗ текста на живом сервере):
 *  без упреждения 3049–3694 мс (среднее 3330), с упреждением 0 мс во всех пяти.
 *  Тесты ниже держат именно то поведение, которое дало эти нули. */

import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { PREFETCH_DWELL_MS, useLyrics, type TrackLyrics } from "./useLyrics";
import type { PlayerTrack } from "./types";

const track = (id: string, kind: PlayerTrack["kind"] = "catalog"): PlayerTrack => ({
  id,
  kind,
  title: `t${id}`,
  artist: "a",
  album: "",
  duration: 200,
  cover: null,
  explicit: false,
  loudness: null,
});

const SYNCED = { synced: [{ t: 1, line: "строка" }], plain: null, source: "lrclib" };
const NOTHING = { synced: null, plain: null, source: null };

function makeApi(byId: Record<string, unknown> = {}): { api: MuzaApi; getLyrics: ReturnType<typeof vi.fn> } {
  const getLyrics = vi.fn(async (id: string) => byId[id] ?? NOTHING);
  return { api: { getLyrics } as unknown as MuzaApi, getLyrics };
}

/** Хук под наблюдением: отдаёт последнее состояние наружу. */
function mount(api: MuzaApi, cur: PlayerTrack | null, next: PlayerTrack | null, canFetch = true) {
  const seen: TrackLyrics[] = [];
  function Probe({ t, n }: { t: PlayerTrack | null; n: PlayerTrack | null }) {
    seen.push(useLyrics(api, t, canFetch, n));
    return null;
  }
  const view = render(<Probe t={cur} n={next} />);
  return {
    seen,
    last: () => seen[seen.length - 1],
    setTracks: (t: PlayerTrack | null, n: PlayerTrack | null) => view.rerender(<Probe t={t} n={n} />),
    unmount: () => view.unmount(),
  };
}

describe("useLyrics", () => {
  it("текущий трек запрашивается сразу на смене трека, без ожидания караоке", async () => {
    const { api, getLyrics } = makeApi({ "1": SYNCED });
    const v = mount(api, track("1"), null);
    await waitFor(() => expect(v.last().synced).toBe(true));
    expect(getLyrics).toHaveBeenCalledWith("1");
    expect(v.last().lines).toEqual([{ t: 1, text: "строка" }]);
    v.unmount();
  });

  it("сосед по очереди подтягивается заранее — на переходе ждать нечего", async () => {
    vi.useFakeTimers();
    try {
      const { api, getLyrics } = makeApi({ "1": SYNCED, "2": SYNCED });
      const v = mount(api, track("1"), track("2"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PREFETCH_DWELL_MS + 10);
      });
      expect(getLyrics).toHaveBeenCalledWith("2");

      // ← трек сменился. Ответ уже в кэше сессии: НИ ОДНОГО нового запроса и
      // ни одного кадра с loading — ровно это и даёт 0 мс на полном пути.
      getLyrics.mockClear();
      const before = v.seen.length;
      await act(async () => {
        v.setTracks(track("2"), null);
      });
      expect(getLyrics).not.toHaveBeenCalled();
      expect(v.seen.slice(before).some((s) => s.loading)).toBe(false);
      expect(v.last().lines).toEqual([{ t: 1, text: "строка" }]);
      v.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("выдержка защищает бюджет сервера: серия скипов не рождает запросов", async () => {
    // ⚠️ Регресс-барьер на лимит промахов (20/мин на пользователя,
    // tracks.controller). Без выдержки каждое нажатие «дальше» меняло бы
    // «следующего» и слало запрос — и настоящий текст ловил бы 429.
    vi.useFakeTimers();
    try {
      const { api, getLyrics } = makeApi();
      const v = mount(api, track("1"), track("2"));
      for (const id of ["3", "4", "5", "6", "7"]) {
        await act(async () => {
          v.setTracks(track("1"), track(id));
          await vi.advanceTimersByTimeAsync(PREFETCH_DWELL_MS / 4);
        });
      }
      // за всю серию упреждающих запросов не ушло — только текущий трек
      expect(getLyrics.mock.calls.map(([id]) => id)).toEqual(["1"]);
      v.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("локальный файл не греем: серверных текстов у него нет, был бы 404", async () => {
    vi.useFakeTimers();
    try {
      const { api, getLyrics } = makeApi();
      const v = mount(api, track("1"), track("local-хэш", "local"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PREFETCH_DWELL_MS + 10);
      });
      expect(getLyrics.mock.calls.map(([id]) => id)).toEqual(["1"]);
      v.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("переход на трек, чей текст ЕЩЁ едет, не заводит второй запрос", async () => {
    // карта полёта общая для показа и упреждения: иначе сервер склеил бы
    // запросы, но свой бюджет промахов потратил бы дважды
    let release: ((v: unknown) => void) | null = null;
    const getLyrics = vi.fn(
      (id: string) => (id === "2" ? new Promise((r) => (release = r)) : Promise.resolve(SYNCED)),
    );
    const api = { getLyrics } as unknown as MuzaApi;
    vi.useFakeTimers();
    try {
      const v = mount(api, track("1"), track("2"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PREFETCH_DWELL_MS + 10);
      });
      expect(getLyrics).toHaveBeenCalledWith("2");
      getLyrics.mockClear();
      await act(async () => {
        v.setTracks(track("2"), null);
      });
      expect(getLyrics).not.toHaveBeenCalled();
      // тот же промис доезжает — и показ подхватывает его результат
      // (waitFor здесь не годится: он опрашивает по таймеру, а таймеры фейковые)
      await act(async () => {
        release?.(SYNCED);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(v.last().lines).toEqual([{ t: 1, text: "строка" }]);
      expect(v.last().loading).toBe(false);
      v.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("без серверной сессии не ходим ни за текущим, ни за соседом", async () => {
    vi.useFakeTimers();
    try {
      const { api, getLyrics } = makeApi();
      const v = mount(api, track("1"), track("2"), false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PREFETCH_DWELL_MS + 10);
      });
      expect(getLyrics).not.toHaveBeenCalled();
      v.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
