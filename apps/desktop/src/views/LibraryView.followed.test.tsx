import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MuzaApi, PlaylistMeta } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { LibraryView } from "./LibraryView";

// Подписанные плейлисты в библиотеке (2026-07-17): плитка с автором;
// скрытый владельцем (available=false) — погашен и не открывается.
// Без LanguageProvider → DEFAULT_LANG="en" (прецедент PlaylistView.test.tsx).

afterEach(() => cleanup());

const meta = (over: Partial<PlaylistMeta> = {}): PlaylistMeta => ({
  id: "10",
  name: "Best phonk 2026",
  trackCount: 42,
  createdAt: "2026-07-01T00:00:00.000Z",
  role: "follower",
  ownerUsername: "creator",
  collaboratorsCount: 0,
  available: true,
  icon: null,
  iconCoverUrl: null,
  ...over,
});

const noop = () => undefined;

function renderView(playlists: PlaylistMeta[], extra: { onOpenPlaylist?: (id: string) => void; onNotify?: (m: string) => void } = {}) {
  return render(
    <DragLayer>
      <LibraryView
        api={{} as MuzaApi}
        canSearch
        srvPlaylists={playlists}
        currentId={null}
        playing={false}
        favoritesCount={0}
        onOpenFavorites={noop}
        onOpenPlaylist={extra.onOpenPlaylist ?? noop}
        onPlayLocal={noop}
        onAddToPlaylist={noop}
        onAddLink={noop}
        onImport={noop}
        onJoinCode={noop}
        onNotify={extra.onNotify ?? noop}
      />
    </DragLayer>,
  );
}

describe("LibraryView — подписанные плейлисты", () => {
  it("плитка follower подписана автором", () => {
    renderView([meta()]);

    expect(screen.getByText("Best phonk 2026")).toBeTruthy();
    expect(screen.getByText(/by creator/)).toBeTruthy();
  });

  it("скрытый владельцем: погашен, клик не открывает, а объясняет", () => {
    const onOpenPlaylist = vi.fn();
    const onNotify = vi.fn();
    renderView([meta({ available: false })], { onOpenPlaylist, onNotify });

    expect(screen.getByText(/hidden by the owner/)).toBeTruthy();
    const tile = screen.getByText("Best phonk 2026").closest("[aria-disabled]");
    expect(tile?.getAttribute("aria-disabled")).toBe("true");

    screen.getByText("Best phonk 2026").click();
    expect(onOpenPlaylist).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalled();
  });

  it("свой плейлист рендерится как раньше — числом треков", () => {
    renderView([meta({ role: "owner", ownerUsername: "" })]);

    expect(screen.getByText(/42 tr\./)).toBeTruthy();
  });
});
