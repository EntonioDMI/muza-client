import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AdminPublicPlaylist, MuzaApi } from "@muza/api-client";
import { AdminPublicPlaylistsSection } from "./AdminView";

// Рубильник публичных плейлистов в админке (2026-07-17).
// Без LanguageProvider → DEFAULT_LANG="en".

afterEach(() => cleanup());

const row = (over: Partial<AdminPublicPlaylist> = {}): AdminPublicPlaylist => ({
  id: "10",
  name: "Лучший фонк 2026",
  ownerUsername: "creator",
  trackCount: 42,
  followersCount: 5,
  handle: null,
  publishedAt: "2026-07-10T00:00:00.000Z",
  ...over,
});

function makeApi(rows: AdminPublicPlaylist[][]) {
  // каждый вызов отдаёт следующий снимок (после unpublish — перечитка)
  const getAdminPublicPlaylists = vi.fn();
  for (const r of rows) getAdminPublicPlaylists.mockResolvedValueOnce(r);
  getAdminPublicPlaylists.mockResolvedValue(rows[rows.length - 1] ?? []);
  const unpublishAdminPlaylist = vi.fn().mockResolvedValue(undefined);
  return { api: { getAdminPublicPlaylists, unpublishAdminPlaylist } as unknown as MuzaApi, unpublishAdminPlaylist };
}

describe("AdminPublicPlaylistsSection — рубильник", () => {
  it("рендерит строки: имя, автор, метрики", async () => {
    const { api } = makeApi([[row()]]);
    render(<AdminPublicPlaylistsSection api={api} />);

    await waitFor(() => expect(screen.getByText("Лучший фонк 2026")).toBeTruthy());
    expect(screen.getByText(/creator/)).toBeTruthy();
    expect(screen.getByText(/42 tr\. · 5 listeners/)).toBeTruthy();
  });

  it("«Unpublish» без чекбокса → ban=false, строка исчезает после перечитки", async () => {
    const { api, unpublishAdminPlaylist } = makeApi([[row()], []]);
    render(<AdminPublicPlaylistsSection api={api} />);
    await waitFor(() => expect(screen.getByText("Лучший фонк 2026")).toBeTruthy());

    screen.getByRole("button", { name: "Unpublish" }).click();

    await waitFor(() => expect(unpublishAdminPlaylist).toHaveBeenCalledWith("10", false));
    await waitFor(() => expect(screen.queryByText("Лучший фонк 2026")).toBeNull());
    expect(screen.getByText("Nothing is published right now")).toBeTruthy();
  });

  it("с чекбоксом бана → ban=true", async () => {
    const { api, unpublishAdminPlaylist } = makeApi([[row()], []]);
    render(<AdminPublicPlaylistsSection api={api} />);
    await waitFor(() => expect(screen.getByText("Лучший фонк 2026")).toBeTruthy());

    screen.getByRole("checkbox").click();
    screen.getByRole("button", { name: "Unpublish" }).click();

    await waitFor(() => expect(unpublishAdminPlaylist).toHaveBeenCalledWith("10", true));
  });
});
