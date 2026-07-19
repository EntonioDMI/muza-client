import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, PublicPlaylistHit } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { SearchView } from "./SearchView";

// Публичные плейлисты в поиске (2026-07-17): режим кода PL_…, плашка
// «Лучший результат» (только именные совпадения) и витрина под выдачей.
// Рендер без LanguageProvider → фолбэк DEFAULT_LANG="en", ассерты на английский
// (прецедент — PlaylistView.test.tsx).

afterEach(() => cleanup());

const hit = (over: Partial<PublicPlaylistHit> = {}): PublicPlaylistHit => ({
  id: "10",
  name: "Best phonk 2026",
  ownerUsername: "creator",
  trackCount: 42,
  followersCount: 5,
  handle: null,
  icon: null,
  iconCoverUrl: null,
  nameMatched: true,
  ...over,
});

function makeApi(over: Partial<Record<keyof MuzaApi, unknown>> = {}): MuzaApi {
  return {
    // живой каталожный поиск (grouped-дефолт) — пустая выдача
    searchGrouped: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    searchPublicPlaylists: vi.fn().mockResolvedValue([]),
    getPublicPlaylistByCode: vi.fn().mockResolvedValue(hit()),
    getPublicPlaylistByHandle: vi.fn().mockResolvedValue(hit({ handle: "fonk_2026" })),
    followPlaylist: vi.fn().mockResolvedValue({}),
    ...over,
  } as unknown as MuzaApi;
}

const noop = () => undefined;

function renderView(api: MuzaApi, extra: { onNotify?: (m: string) => void; onPlaylistsChanged?: () => void } = {}) {
  return render(
    <DragLayer>
      <SearchView
        api={api}
        canSearch
        currentId={null}
        playing={false}
        likes={[]}
        onPlayCatalog={noop}
        onLike={noop}
        onNotify={extra.onNotify ?? noop}
        onCatalogMenu={noop}
        onOpenPlaylist={noop}
        onPlaylistsChanged={extra.onPlaylistsChanged}
      />
    </DragLayer>,
  );
}

const typeQuery = (value: string) => {
  fireEvent.change(screen.getByPlaceholderText("Track, artist, album"), { target: { value } });
};

describe("SearchView — режим кода PL_…", () => {
  it("код целиком → карточка по коду, трековый поиск молчит", async () => {
    const api = makeApi();
    renderView(api);

    typeQuery("pl_ggcrygb8");

    await waitFor(() => expect(screen.getByTestId("public-playlist-hero")).toBeTruthy());
    expect(api.getPublicPlaylistByCode).toHaveBeenCalledWith("PL_GGCRYGB8");
    expect(api.searchGrouped).not.toHaveBeenCalled();
    expect(api.searchPublicPlaylists).not.toHaveBeenCalled();
    expect(screen.getByText("Best phonk 2026")).toBeTruthy();
    expect(screen.getByText(/by creator/)).toBeTruthy();
  });

  it("ошибка кода → деликатный текст сервера, без падения", async () => {
    const api = makeApi({
      getPublicPlaylistByCode: vi.fn().mockRejectedValue(new Error("Код не найден")),
    });
    renderView(api);

    typeQuery("PL_XXXXXXXX");

    await waitFor(() => expect(screen.getByText("Код не найден")).toBeTruthy());
  });

  it("«В библиотеку» → followPlaylist + обновление списка плейлистов", async () => {
    const onPlaylistsChanged = vi.fn();
    const api = makeApi();
    renderView(api, { onPlaylistsChanged });

    typeQuery("PL_GGCRYGB8");
    await waitFor(() => expect(screen.getByTestId("public-playlist-hero")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Add to library/ }));

    await waitFor(() => expect(api.followPlaylist).toHaveBeenCalledWith("10"));
    expect(onPlaylistsChanged).toHaveBeenCalled();
  });
});

describe("SearchView — режим @адреса", () => {
  it("@имя целиком → by-handle карточка с адресом, трековый поиск молчит", async () => {
    const api = makeApi();
    renderView(api);

    typeQuery("@Fonk_2026");

    await waitFor(() => expect(screen.getByTestId("public-playlist-hero")).toBeTruthy());
    expect(api.getPublicPlaylistByHandle).toHaveBeenCalledWith("fonk_2026");
    expect(api.getPublicPlaylistByCode).not.toHaveBeenCalled();
    expect(api.searchGrouped).not.toHaveBeenCalled();
    expect(screen.getByText(/@fonk_2026/)).toBeTruthy();
  });

  it("замороженный/кривой адрес → деликатный текст сервера", async () => {
    const api = makeApi({
      getPublicPlaylistByHandle: vi.fn().mockRejectedValue(new Error("Адрес не найден")),
    });
    renderView(api);

    typeQuery("@nope_here");

    await waitFor(() => expect(screen.getByText("Адрес не найден")).toBeTruthy());
  });

  it("@ внутри фразы — обычный трековый поиск", async () => {
    const api = makeApi();
    renderView(api);

    typeQuery("скинь @fonk_2026");

    await waitFor(() => expect(api.searchGrouped).toHaveBeenCalled());
    expect(api.getPublicPlaylistByHandle).not.toHaveBeenCalled();
  });
});

describe("SearchView — плейлисты в обычной выдаче", () => {
  it("именной хит → плашка «Top result», остальные — в витрине", async () => {
    const api = makeApi({
      searchPublicPlaylists: vi.fn().mockResolvedValue([
        hit(),
        hit({ id: "11", name: "Random mix", nameMatched: false }),
      ]),
    });
    renderView(api);

    typeQuery("phonk");

    await waitFor(() => expect(screen.getByTestId("public-playlist-hero")).toBeTruthy());
    expect(screen.getByText("Top result")).toBeTruthy();
    const shelf = screen.getByTestId("public-playlists-shelf");
    expect(shelf.textContent).toContain("Random mix");
    // плашечный хит в витрине не дублируется
    expect(shelf.textContent).not.toContain("Best phonk 2026");
  });

  it("совпадение только по артистам — плашки нет, витрина есть", async () => {
    const api = makeApi({
      searchPublicPlaylists: vi.fn().mockResolvedValue([hit({ nameMatched: false })]),
    });
    renderView(api);

    typeQuery("phonk");

    await waitFor(() => expect(screen.getByTestId("public-playlists-shelf")).toBeTruthy());
    expect(screen.queryByTestId("public-playlist-hero")).toBeNull();
  });

  it("ошибка поиска плейлистов не роняет трековую выдачу", async () => {
    const api = makeApi({
      searchPublicPlaylists: vi.fn().mockRejectedValue(new Error("boom")),
    });
    renderView(api);

    typeQuery("phonk");

    await waitFor(() => expect(api.searchGrouped).toHaveBeenCalled());
    expect(screen.queryByTestId("public-playlists-shelf")).toBeNull();
    expect(screen.getByText("Results")).toBeTruthy();
  });
});
