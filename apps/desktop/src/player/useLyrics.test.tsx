/** Тексты трека: показ текущего + упреждающая загрузка соседа по очереди.
 *
 *  Замер, ради которого хук трогали (14.08, полный путь «трек сменился →
 *  строки готовы», 5 холодных треков БЕЗ текста на живом сервере):
 *  без упреждения 3049–3694 мс (среднее 3330), с упреждением 0 мс во всех пяти.
 *  Тесты ниже держат именно то поведение, которое дало эти нули. */

import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { PREFETCH_DWELL_MS, useLyrics, type TrackLyricsView } from "./useLyrics";
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

const SYNCED = {
  synced: [{ t: 1, line: "строка" }],
  plain: null,
  source: "lrclib",
  sourceKey: "lrclib:17594385",
  rejected: 0,
};
const NOTHING = { synced: null, plain: null, source: null, sourceKey: null, rejected: 0 };

function makeApi(byId: Record<string, unknown> = {}): {
  api: MuzaApi;
  getLyrics: ReturnType<typeof vi.fn>;
  rejectLyrics: ReturnType<typeof vi.fn>;
  restoreLyrics: ReturnType<typeof vi.fn>;
} {
  const getLyrics = vi.fn(async (id: string) => byId[id] ?? NOTHING);
  const rejectLyrics = vi.fn(async () => NOTHING);
  const restoreLyrics = vi.fn(async () => NOTHING);
  return {
    api: { getLyrics, rejectLyrics, restoreLyrics } as unknown as MuzaApi,
    getLyrics,
    rejectLyrics,
    restoreLyrics,
  };
}

/** Хук под наблюдением: отдаёт последнее состояние наружу. */
function mount(api: MuzaApi, cur: PlayerTrack | null, next: PlayerTrack | null, canFetch = true) {
  const seen: TrackLyricsView[] = [];
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

// ── «Текст не от этой песни» (14.08) ──────────────────────────────────
//
// У LRCLIB нашлась запись, подписанная нашим треком точно (артист, название,
// альбом, длительность), а текст в ней от другой песни. Проверки такое не
// ловят по построению — ловит человек. Ниже держится главное свойство: отказ
// обязан ПЕРЕЖИТЬ сессионный кэш этого же хука, иначе на возврате к треку
// отвергнутый текст вернётся из нашей памяти и кнопка будет выглядеть
// сломанной, хотя на сервере всё записано.

describe("useLyrics — отказ от текста", () => {
  it("запись источника доезжает до вызывающего — ею и отвергают", async () => {
    const { api } = makeApi({ "1": SYNCED });
    const v = mount(api, track("1"), null);
    await waitFor(() => expect(v.last().sourceKey).toBe("lrclib:17594385"));
    v.unmount();
  });

  it("отказ шлёт ИМЕННО показанную запись и заменяет текст ответом сервера", async () => {
    const other = { synced: null, plain: "другой", source: "netease", sourceKey: "netease:5", rejected: 1 };
    const { api, rejectLyrics } = makeApi({ "1": SYNCED });
    (api.rejectLyrics as ReturnType<typeof vi.fn>).mockResolvedValue(other);
    const v = mount(api, track("1"), null);
    await waitFor(() => expect(v.last().sourceKey).toBe("lrclib:17594385"));

    let found: boolean | undefined;
    await act(async () => {
      found = await v.last().reject();
    });

    expect(rejectLyrics).toHaveBeenCalledWith("1", "lrclib:17594385");
    expect(found).toBe(true);
    expect(v.last().lines).toEqual([{ t: 0, text: "другой" }]);
    expect(v.last().rejected).toBe(1);
    v.unmount();
  });

  it("отказ перезаписывает сессионный кэш: возврат к треку не воскрешает чужой текст", async () => {
    const { api, getLyrics } = makeApi({ "1": SYNCED, "2": SYNCED });
    (api.rejectLyrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      synced: null,
      plain: "другой",
      source: "netease",
      sourceKey: "netease:5",
      rejected: 1,
    });
    const v = mount(api, track("1"), null);
    await waitFor(() => expect(v.last().sourceKey).toBe("lrclib:17594385"));
    await act(async () => {
      await v.last().reject();
    });

    // ушли на другой трек и вернулись — сервер не спрашивается (кэш сессии),
    // и именно поэтому кэш обязан хранить УЖЕ новый текст
    getLyrics.mockClear();
    await act(async () => {
      v.setTracks(track("2"), null);
    });
    await act(async () => {
      v.setTracks(track("1"), null);
    });
    expect(getLyrics).not.toHaveBeenCalledWith("1");
    expect(v.last().lines).toEqual([{ t: 0, text: "другой" }]);
    v.unmount();
  });

  it("текста больше не нашлось — отказ честно возвращает false, но счётчик отказов жив", async () => {
    // Счётчик и есть единственный вход обратно: без него человек застрял бы в
    // «текста нет» без возможности вернуть.
    const { api } = makeApi({ "1": SYNCED });
    (api.rejectLyrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      synced: null,
      plain: null,
      source: null,
      sourceKey: null,
      rejected: 1,
    });
    const v = mount(api, track("1"), null);
    await waitFor(() => expect(v.last().sourceKey).toBe("lrclib:17594385"));

    let found: boolean | undefined;
    await act(async () => {
      found = await v.last().reject();
    });

    expect(found).toBe(false);
    expect(v.last().lines).toEqual([]);
    expect(v.last().rejected).toBe(1);
    v.unmount();
  });

  it("возврат работает и из состояния «текста нет» — id берётся у играющего трека", async () => {
    const { api, restoreLyrics } = makeApi({ "1": NOTHING });
    (api.restoreLyrics as ReturnType<typeof vi.fn>).mockResolvedValue(SYNCED);
    const v = mount(api, track("1"), null);
    await waitFor(() => expect(v.last().loading).toBe(false));

    await act(async () => {
      await v.last().restore();
    });

    expect(restoreLyrics).toHaveBeenCalledWith("1");
    expect(v.last().lines).toEqual([{ t: 1, text: "строка" }]);
    v.unmount();
  });

  it("отвергать нечего (текста нет) — в сеть не идём", async () => {
    const { api, rejectLyrics } = makeApi({ "1": NOTHING });
    const v = mount(api, track("1"), null);
    await waitFor(() => expect(v.last().loading).toBe(false));
    await act(async () => {
      expect(await v.last().reject()).toBe(false);
    });
    expect(rejectLyrics).not.toHaveBeenCalled();
    v.unmount();
  });
});
