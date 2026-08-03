/** Гонка загрузок страницы плейлиста (правка 2026-08-03).
 *
 *  Симптом: клик по плейлисту A, сразу по B. Ответ A приходил ВТОРЫМ и
 *  затирал уже показанный B — на экране оказывались имя и треки A, а «убрать
 *  трек», перестановка и переименование били по B (playlistId в обработчиках
 *  уже был его). Читаешь одно, правишь другое.
 *
 *  Лечится номером актуальной загрузки: ответ с чужим номером не пишет НИЧЕГО
 *  — ни данных, ни ошибки (иначе отказ A вешал бы красную строку над живым B).
 *
 *  Без LanguageProvider useT() отдаёт DEFAULT_LANG="en" — ассерты английские. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ApiError, type MuzaApi, type PlaylistDetail } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { ContextMenuProvider } from "../shell/ContextMenu";
import type { MenuAbilities } from "../shell/menuActions";
import { PlaylistView } from "./PlaylistView";

afterEach(cleanup);

const detail = (id: string, name: string, trackTitle: string): PlaylistDetail => ({
  id,
  name,
  tracks: [
    {
      id: `${id}-t1`,
      artist: "A",
      title: trackTitle,
      durationSec: 100,
      coverUrl: null,
      isCached: true,
      sources: ["youtube"],
      loudness: null,
      localHash: null,
    },
  ],
  isOwner: true,
  role: "owner",
  ownerUsername: "",
  inviteCode: null,
  publicCode: null,
  handle: null,
  visibility: "private",
  followersCount: 0,
  isFollowing: false,
  collaborators: [],
  addedBy: {},
  icon: null,
  iconCoverUrl: null,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const noop = () => undefined;

const ABILITIES: MenuAbilities = {
  addToPlaylist: noop,
  isLiked: () => false,
  toggleLike: noop,
  addManyToPlaylist: noop,
  likeMany: noop,
};

function renderAt(api: MuzaApi, playlistId: string) {
  return render(
    <ContextMenuProvider ctx={ABILITIES} suppressNativeMenu={false}>
      <DragLayer>
        <PlaylistView
          api={api}
          playlistId={playlistId}
          userId="u1"
          likes={[]}
          currentId={null}
          playing={false}
          onPlayCatalog={noop}
          onLike={noop}
          onNotify={noop}
          onShare={noop}
          onChanged={noop}
          onDeleted={noop}
          onChangeIcon={noop}
        />
      </DragLayer>
    </ContextMenuProvider>,
  );
}

describe("PlaylistView — ответ прошлой страницы не пишет на экран", () => {
  it("A открыт и брошен ради B; ответ A пришёл вторым — на экране всё равно B", async () => {
    const slowA = deferred<PlaylistDetail>();
    const api = {
      getPlaylist: vi.fn((id: string) => (id === "A" ? slowA.promise : Promise.resolve(detail("B", "Второй", "Трек B")))),
    } as unknown as MuzaApi;

    const view = renderAt(api, "A");
    view.rerender(
      <ContextMenuProvider ctx={ABILITIES} suppressNativeMenu={false}>
        <DragLayer>
          <PlaylistView
            api={api}
            playlistId="B"
            userId="u1"
            likes={[]}
            currentId={null}
            playing={false}
            onPlayCatalog={noop}
            onLike={noop}
            onNotify={noop}
            onShare={noop}
            onChanged={noop}
            onDeleted={noop}
            onChangeIcon={noop}
          />
        </DragLayer>
      </ContextMenuProvider>,
    );

    await waitFor(() => expect(screen.getByText("Трек B")).toBeTruthy());
    slowA.resolve(detail("A", "Первый", "Трек A"));

    // окно, в котором старый код успевал подменить содержимое
    await Promise.resolve();
    await waitFor(() => expect(screen.getByText("Трек B")).toBeTruthy());
    expect(screen.queryByText("Трек A")).toBeNull();
    expect(screen.queryByText("Первый")).toBeNull();
  });

  it("отказ брошенной страницы не вешает ошибку над живой", async () => {
    const slowA = deferred<PlaylistDetail>();
    const api = {
      getPlaylist: vi.fn((id: string) => (id === "A" ? slowA.promise : Promise.resolve(detail("B", "Второй", "Трек B")))),
    } as unknown as MuzaApi;

    const view = renderAt(api, "A");
    view.rerender(
      <ContextMenuProvider ctx={ABILITIES} suppressNativeMenu={false}>
        <DragLayer>
          <PlaylistView
            api={api}
            playlistId="B"
            userId="u1"
            likes={[]}
            currentId={null}
            playing={false}
            onPlayCatalog={noop}
            onLike={noop}
            onNotify={noop}
            onShare={noop}
            onChanged={noop}
            onDeleted={noop}
            onChangeIcon={noop}
          />
        </DragLayer>
      </ContextMenuProvider>,
    );

    await waitFor(() => expect(screen.getByText("Трек B")).toBeTruthy());
    slowA.reject(new ApiError(404, "Плейлист удалён"));

    await Promise.resolve();
    await waitFor(() => expect(screen.getByText("Трек B")).toBeTruthy());
    expect(screen.queryByText("Плейлист удалён")).toBeNull();
  });
});
