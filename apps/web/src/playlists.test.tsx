/** Порядок плейлистов: инвариант «урезанного индекса».
 *
 *  ЗАЧЕМ. Ручка-⠿ отдаёт `toIndex` в координатах ПОДВИЖНЫХ строк: подписки и
 *  закреплённые в перетаскивание не входят вовсе. Сложить его с позицией в
 *  полном списке — промах ровно на число исключённых, и промах гарантирован,
 *  потому что закреплённые всегда сверху. Симптом злой: сдвиг молча не даёт
 *  ничего, а испорченный порядок уезжает на сервер и переживает перезапуск.
 *  Эту ошибку чинили в приложении 2026-08-02, а в вебе тот же расчёт до
 *  2026-08-03 стоял ДВУМЯ дословными копиями (боковая панель и медиатека) —
 *  теперь он один, в usePlaylists, и потому проверяем его здесь.
 *
 *  Проверяется НАБЛЮДАЕМОЕ: какой порядок id ушёл на сервер и что показано
 *  человеку сразу после жеста (оптимистично, до ответа). */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaylistMeta } from "@muza/api-client";

/** Плеер подменён: usePlaylists соседствует с usePlayPlaylist, тот тянет
 *  настоящий плеер (два `<audio>`, Web Audio, таймеры) — к порядку строк это
 *  отношения не имеет. */
vi.mock("./player", () => ({
  usePlayer: () => ({ current: null, playing: false, playContext: () => undefined }),
}));

const reorderCalls: string[][] = [];
const api = {
  onSessionRevoked: () => undefined,
  restoreSession: () =>
    Promise.resolve({ user: { id: "u-1", username: "kto", anonymous: false }, accessToken: "a", refreshToken: null }),
  getPlaylists: () => Promise.resolve(LIST),
  reorderPlaylists: (ids: string[]) => {
    reorderCalls.push(ids);
    return Promise.resolve();
  },
};
vi.mock("./api", () => ({ getApi: () => api }));

const { PlaylistsProvider, usePlaylists } = await import("./playlists");
const { SessionProvider } = await import("./session");

function pl(id: string, extra: Partial<PlaylistMeta> = {}): PlaylistMeta {
  return {
    id,
    name: id,
    trackCount: 0,
    createdAt: "2026-01-01",
    role: "owner",
    ownerUsername: "kto",
    collaboratorsCount: 0,
    available: true,
    icon: null,
    iconCoverUrl: null,
    pinned: false,
    ...extra,
  };
}

/** Закреплённый сверху, подписка, три обычных — то есть ДВА неподвижных перед
 *  подвижными: именно на столько и промахивался расчёт без пересчёта индекса. */
const LIST: PlaylistMeta[] = [pl("P", { pinned: true }), pl("F", { role: "follower" }), pl("A"), pl("B"), pl("C")];

describe("usePlaylists.reorder", () => {
  // vitest здесь без globals — авто-очистки testing-library нет
  afterEach(cleanup);

  it("считает toIndex в координатах подвижных, неподвижных не двигает", async () => {
    let ctx: ReturnType<typeof usePlaylists> | null = null;
    function Probe() {
      ctx = usePlaylists();
      return null;
    }
    render(
      <SessionProvider>
        <PlaylistsProvider>
          <Probe />
        </PlaylistsProvider>
      </SessionProvider>,
    );
    await waitFor(() => expect(ctx!.playlists).toHaveLength(5));

    // «C» (третий среди подвижных) переносим в начало ПОДВИЖНЫХ
    await act(async () => {
      await ctx!.reorder("C", 0);
    });

    // P и F остались на своих местах, между собой перетасовались только A/B/C
    expect(reorderCalls).toEqual([["P", "F", "C", "A", "B"]]);
    // и то же самое человек видит сразу, не дожидаясь перечитки
    expect(ctx!.playlists.map((p) => p.id)).toEqual(["P", "F", "C", "A", "B"]);
  });

  it("бессмысленный жест на сервер не уходит", async () => {
    reorderCalls.length = 0;
    let ctx: ReturnType<typeof usePlaylists> | null = null;
    function Probe() {
      ctx = usePlaylists();
      return null;
    }
    render(
      <SessionProvider>
        <PlaylistsProvider>
          <Probe />
        </PlaylistsProvider>
      </SessionProvider>,
    );
    await waitFor(() => expect(ctx!.playlists).toHaveLength(5));

    await act(async () => {
      await ctx!.reorder("A", 0); // A и так первый среди подвижных
      await ctx!.reorder("P", 0); // закреплённый в перетаскивание не входит
      await ctx!.reorder("A", 9); // индекса за пределами подвижных не бывает
    });

    expect(reorderCalls).toEqual([]);
  });
});
