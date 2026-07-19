import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, Track, TrackAlternative } from "@muza/api-client";
import { ReplaceVersionDialog, type ReplaceCtx } from "./ReplaceVersionDialog";

// «Заменить версию» (2026-07-18): кандидаты с сервера, Δ-бейдж, прослушка,
// замена в плейлисте/Любимом. Без LanguageProvider → DEFAULT_LANG="en".

afterEach(() => cleanup());

const track = (id: string, over: Partial<Track> = {}): Track => ({
  id,
  artist: "Daft Punk",
  title: "Get Lucky",
  durationSec: 248,
  coverUrl: null,
  isCached: false,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
  ...over,
});

const alt = (id: string, over: Partial<Track> = {}, extra: Partial<TrackAlternative> = {}): TrackAlternative => ({
  track: track(id, over),
  score: 3,
  matched: true,
  ...extra,
});

const playlistCtx = (reload = () => undefined): ReplaceCtx => ({
  track: track("old1"),
  target: { kind: "playlist", playlistId: "pl1", reload },
});

function renderDialog(
  api: Partial<MuzaApi>,
  ctx: ReplaceCtx | null,
  extra: {
    onNotify?: (m: string, icon?: string) => void;
    onPlayCatalog?: (tracks: Track[], id: string) => void;
    onReplaced?: (oldId: string, newTrack: Track) => void;
    onClose?: () => void;
  } = {},
) {
  return render(
    <ReplaceVersionDialog
      api={api as MuzaApi}
      ctx={ctx}
      onClose={extra.onClose ?? (() => undefined)}
      onNotify={extra.onNotify ?? (() => undefined)}
      onPlayCatalog={extra.onPlayCatalog ?? (() => undefined)}
      currentId={null}
      playing={false}
      onReplaced={extra.onReplaced ?? (() => undefined)}
    />,
  );
}

describe("ReplaceVersionDialog — загрузка и список", () => {
  it("показывает кандидатов: заголовок, Δ длительности, пометка matched", async () => {
    const getTrackAlternatives = vi.fn().mockResolvedValue([
      alt("a1", { title: "Get Lucky (Official)", durationSec: 255 }),
      alt("a2", { title: "GET LUCKY BEST", artist: "PHONK DOMAIN" }, { score: 0, matched: false }),
    ]);
    renderDialog({ getTrackAlternatives }, playlistCtx());

    expect(getTrackAlternatives).toHaveBeenCalledWith("old1");
    await waitFor(() => expect(screen.getByText("Get Lucky (Official)")).toBeTruthy());
    // Δ = 255 − 248 = +7 с — главный маркер замедленных копий
    expect(screen.getByText(/\+7 s/)).toBeTruthy();
    // matched-подпись только у первого кандидата
    expect(screen.getAllByText("likely the same song")).toHaveLength(1);

    // Скролл списка без горизонтальной полосы; вертикальную красит глобальное
    // правило ДС (base.css, ::-webkit-scrollbar) — inline scrollbarWidth снят.
    const list = screen.getByText("Get Lucky (Official)").closest("button")?.parentElement?.parentElement;
    expect(list?.style.overflowY).toBe("auto");
    expect(list?.style.overflowX).toBe("hidden");
  });

  it("пустой ответ — говорит, что других загрузок нет", async () => {
    renderDialog({ getTrackAlternatives: vi.fn().mockResolvedValue([]) }, playlistCtx());
    await waitFor(() => expect(screen.getByText("No other uploads of this song found.")).toBeTruthy());
  });

  it("ошибка сервера — показывается в диалоге", async () => {
    const getTrackAlternatives = vi.fn().mockRejectedValue(new Error("Слишком часто ищешь — подожди минуту"));
    renderDialog({ getTrackAlternatives }, playlistCtx());
    await waitFor(() => expect(screen.getByText("Слишком часто ищешь — подожди минуту")).toBeTruthy());
  });
});

describe("ReplaceVersionDialog — прослушка", () => {
  it("▶ зовёт onPlayCatalog с кандидатом и НЕ запускает замену", async () => {
    const replacePlaylistTrack = vi.fn();
    const onPlayCatalog = vi.fn();
    renderDialog(
      { getTrackAlternatives: vi.fn().mockResolvedValue([alt("a1")]), replacePlaylistTrack },
      playlistCtx(),
      { onPlayCatalog },
    );
    await waitFor(() => expect(screen.getByLabelText("Preview")).toBeTruthy());

    screen.getByLabelText("Preview").click();

    expect(onPlayCatalog).toHaveBeenCalledWith([expect.objectContaining({ id: "a1" })], "a1");
    expect(replacePlaylistTrack).not.toHaveBeenCalled();
  });
});

describe("ReplaceVersionDialog — замена", () => {
  it("клик по кандидату в плейлисте: replacePlaylistTrack + onReplaced + закрытие", async () => {
    const replacePlaylistTrack = vi.fn().mockResolvedValue(undefined);
    const onReplaced = vi.fn();
    const onClose = vi.fn();
    const onNotify = vi.fn();
    renderDialog(
      { getTrackAlternatives: vi.fn().mockResolvedValue([alt("a1")]), replacePlaylistTrack },
      playlistCtx(),
      { onReplaced, onClose, onNotify },
    );
    await waitFor(() => expect(screen.getByText("Get Lucky")).toBeTruthy());

    screen.getByText("Get Lucky").click();

    await waitFor(() => expect(replacePlaylistTrack).toHaveBeenCalledWith("pl1", "old1", "a1"));
    expect(onReplaced).toHaveBeenCalledWith("old1", expect.objectContaining({ id: "a1" }));
    expect(onNotify).toHaveBeenCalledWith("Version replaced", "check");
    expect(onClose).toHaveBeenCalled();
  });

  it("в Любимом зовётся replaceFavorite со своим тостом", async () => {
    const replaceFavorite = vi.fn().mockResolvedValue(undefined);
    const onNotify = vi.fn();
    renderDialog(
      { getTrackAlternatives: vi.fn().mockResolvedValue([alt("a1")]), replaceFavorite },
      { track: track("old1"), target: { kind: "favorites" } },
      { onNotify },
    );
    await waitFor(() => expect(screen.getByText("Get Lucky")).toBeTruthy());

    screen.getByText("Get Lucky").click();

    await waitFor(() => expect(replaceFavorite).toHaveBeenCalledWith("old1", "a1"));
    expect(onNotify).toHaveBeenCalledWith("Version replaced in Favorites", "check");
  });

  it("ошибка замены — тост с ошибкой, диалог не закрывается", async () => {
    const replacePlaylistTrack = vi.fn().mockRejectedValue(new Error("Трека нет в плейлисте"));
    const onClose = vi.fn();
    const onNotify = vi.fn();
    renderDialog(
      { getTrackAlternatives: vi.fn().mockResolvedValue([alt("a1")]), replacePlaylistTrack },
      playlistCtx(),
      { onClose, onNotify },
    );
    await waitFor(() => expect(screen.getByText("Get Lucky")).toBeTruthy());

    screen.getByText("Get Lucky").click();

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("Трека нет в плейлисте", "x"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Get Lucky")).toBeTruthy();
  });
});
