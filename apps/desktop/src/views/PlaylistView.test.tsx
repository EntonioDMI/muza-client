import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, PlaylistDetail } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { PlaylistView } from "./PlaylistView";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
beforeEach(() => localStorage.clear());

/** Снапшот владельческого плейлиста (все дефолты PlaylistDetail заполнены). */
const ownerDetail: PlaylistDetail = {
  id: "pl1",
  name: "Мой микс",
  tracks: [],
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
};

/** Ключ снапшота повторяет формат offlineSnapshot.ts: PREFIX+scope+key.
 *  scope пуст (setSnapshotScope в тесте не зовём) → двойное двоеточие. */
const SNAPSHOT_KEY = "muza.snapshot.v1::playlist:pl1";

const noop = () => undefined;

/** <DragLayer> обязателен: строки плейлиста — источники переноса, а сам список
 *  — зона приёма, поэтому вью зовёт useDrag()/useDropZone(), а те без слоя
 *  бросают. В приложении слой стоит на корне дерева Player (App.tsx). */
function renderView(api: MuzaApi, extra: { onReplaceVersion?: (t: { id: string }, reload: () => void) => void } = {}) {
  return render(
    <DragLayer>
      <PlaylistView
        api={api}
        playlistId="pl1"
        userId="u1"
        likes={[]}
        currentId=""
        playing={false}
        onPlayCatalog={noop}
        onLike={noop}
        onNotify={noop}
        onVersions={noop}
        onReplaceVersion={extra.onReplaceVersion ?? noop}
        onShare={noop}
        onSaveOffline={noop}
        onChanged={noop}
        onDeleted={noop}
        onChangeIcon={noop}
      />
    </DragLayer>,
  );
}

// T31 (i18n): PlaylistView зовёт useT() — рендер здесь БЕЗ LanguageProvider,
// поэтому useT() фолбэкает на DEFAULT_LANG="en" (см. i18n/index.tsx и
// прецедент в shell/MeaningDialog.test.tsx). Ассерты — на английский текст.
describe("PlaylistView — владельческие кнопки", () => {
  it("прячет «Rename»/«Delete playlist» на оффлайн-снапшоте удалённого плейлиста", async () => {
    // Сервер отдаёт удалённый плейлист (404), но локально есть снапшот, где
    // пользователь был владельцем → withSnapshot вернёт offline:true с isOwner.
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(ownerDetail));
    const api = {
      getPlaylist: vi.fn().mockRejectedValue(new Error("404 not found")),
    } as unknown as MuzaApi;

    renderView(api);

    // Дожидаемся, пока страница осядет в состоянии «offline copy».
    await waitFor(() => expect(screen.getByText(/offline copy/)).toBeTruthy());

    // Кнопки владельца, бьющие по мёртвому id, не должны быть отрисованы.
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete playlist" })).toBeNull();
  });

  it("показывает «Rename»/«Delete playlist» для живого плейлиста владельца", async () => {
    // Онлайн-ответ сервера: offline:false, isOwner:true → кнопки на месте.
    const api = {
      getPlaylist: vi.fn().mockResolvedValue(ownerDetail),
    } as unknown as MuzaApi;

    renderView(api);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Delete playlist" })).toBeTruthy();
    // Контроль: это не оффлайн-состояние.
    expect(screen.getByText(/syncing/)).toBeTruthy();
  });
});

// Публичные плейлисты (2026-07-17): чужой открытый плейлист — role viewer.
// Read-only: правок нет вовсе, зато есть подписка «В библиотеку».
const viewerDetail: PlaylistDetail = {
  ...ownerDetail,
  isOwner: false,
  role: "viewer",
  ownerUsername: "creator",
  visibility: "public",
  followersCount: 5,
  isFollowing: false,
  tracks: [
    {
      id: "t1",
      artist: "A",
      title: "Первый",
      durationSec: 100,
      coverUrl: null,
      isCached: true,
      sources: ["youtube"],
      loudness: null,
      localHash: null,
    },
  ],
};

describe("PlaylistView — режим viewer (чужой публичный)", () => {
  it("прячет правки и совместный доступ, показывает «Add to library» и автора", async () => {
    const api = { getPlaylist: vi.fn().mockResolvedValue(viewerDetail) } as unknown as MuzaApi;

    renderView(api);

    await waitFor(() => expect(screen.getByRole("button", { name: "Add to library" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete playlist" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Shared access" })).toBeNull();
    expect(screen.getByText(/public · by creator/)).toBeTruthy();
    expect(screen.getByText(/5 listeners/)).toBeTruthy();
  });

  it("подписка: клик зовёт followPlaylist, после перезагрузки — «Remove from library»", async () => {
    const getPlaylist = vi
      .fn()
      .mockResolvedValueOnce(viewerDetail)
      .mockResolvedValue({ ...viewerDetail, isFollowing: true, followersCount: 6 });
    const followPlaylist = vi.fn().mockResolvedValue({});
    const api = { getPlaylist, followPlaylist } as unknown as MuzaApi;

    renderView(api);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to library" })).toBeTruthy());

    screen.getByRole("button", { name: "Add to library" }).click();

    await waitFor(() => expect(followPlaylist).toHaveBeenCalledWith("pl1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove from library" })).toBeTruthy());
  });

  it("в меню трека нет «Remove from playlist» и «Replace version»", async () => {
    const api = { getPlaylist: vi.fn().mockResolvedValue(viewerDetail) } as unknown as MuzaApi;

    renderView(api);
    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());

    // «⋯» рисуется только у подсвеченной строки (lit = hover || focused);
    // фокус на play-кнопке строки поджигает её надёжнее, чем mouseenter в jsdom
    fireEvent.focus(screen.getByRole("button", { name: "Listen: Первый" }));
    const more = await screen.findByRole("button", { name: "More" });
    more.click();

    await waitFor(() => expect(screen.getByText("Sources")).toBeTruthy());
    expect(screen.queryByText("Remove from playlist")).toBeNull();
    // 2026-07-18: замена версии — тоже правка состава, viewer её не видит
    expect(screen.queryByText("Replace version")).toBeNull();
  });
});

// «Заменить версию» (2026-07-18): пункт ПКМ-меню трека у владельца/участника.
describe("PlaylistView — «Replace version» в меню трека", () => {
  it("у владельца пункт есть и отдаёт кликнутый трек", async () => {
    const detailWithTrack = { ...ownerDetail, tracks: viewerDetail.tracks };
    const api = { getPlaylist: vi.fn().mockResolvedValue(detailWithTrack) } as unknown as MuzaApi;
    const onReplaceVersion = vi.fn();

    renderView(api, { onReplaceVersion });
    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());

    fireEvent.focus(screen.getByRole("button", { name: "Listen: Первый" }));
    const more = await screen.findByRole("button", { name: "More" });
    more.click();

    const item = await screen.findByText("Replace version");
    item.click();

    expect(onReplaceVersion).toHaveBeenCalledTimes(1);
    expect(onReplaceVersion.mock.calls[0][0]).toMatchObject({ id: "t1", title: "Первый" });
    expect(typeof onReplaceVersion.mock.calls[0][1]).toBe("function");
  });
});
