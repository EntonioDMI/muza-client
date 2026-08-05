import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AdminPublicPlaylist, MuzaApi } from "@muza/api-client";
import { AdminPublicPlaylistsSection } from "./AdminView";

// Рубильник публичных плейлистов в админке (2026-07-17).
// Без LanguageProvider → DEFAULT_LANG="en".
//
// 05.08: список стал настоящей таблицей со страницами по 50 и счётчиком
// «показаны N из M» — сервер отдаёт ВСЕ публикации одним ответом. Заодно
// чекбокс «запретить снова» заменён на Switch из ДС (role="switch").

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
    const cells = within(screen.getAllByRole("row")[1])
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(0, 4)).toEqual(["Лучший фонк 2026", "creator", "42", "5"]);
  });

  it("«Unpublish» без переключателя → ban=false, строка исчезает после перечитки", async () => {
    const { api, unpublishAdminPlaylist } = makeApi([[row()], []]);
    render(<AdminPublicPlaylistsSection api={api} />);
    await waitFor(() => expect(screen.getByText("Лучший фонк 2026")).toBeTruthy());

    screen.getByRole("button", { name: "Unpublish" }).click();

    await waitFor(() => expect(unpublishAdminPlaylist).toHaveBeenCalledWith("10", false));
    await waitFor(() => expect(screen.queryByText("Лучший фонк 2026")).toBeNull());
    expect(screen.getByText("Nothing is published right now")).toBeTruthy();
  });

  it("с переключателем бана → ban=true", async () => {
    const { api, unpublishAdminPlaylist } = makeApi([[row()], []]);
    render(<AdminPublicPlaylistsSection api={api} />);
    await waitFor(() => expect(screen.getByText("Лучший фонк 2026")).toBeTruthy());

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));

    await waitFor(() => expect(unpublishAdminPlaylist).toHaveBeenCalledWith("10", true));
  });

  it("больше страницы: показано 50 из 60 и вторая страница листается", async () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ id: String(i), name: `Плейлист ${i}` }));
    const { api } = makeApi([many]);
    render(<AdminPublicPlaylistsSection api={api} />);

    await waitFor(() => expect(screen.getByText("Плейлист 0")).toBeTruthy());
    expect(screen.getByText("Showing 50 of 60")).toBeTruthy();
    expect(screen.queryByText("Плейлист 55")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(screen.getByText("Плейлист 55")).toBeTruthy());
    expect(screen.getByText("Showing 10 of 60")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });

  it("клик по заголовку колонки сортирует и объявляет aria-sort", async () => {
    const { api } = makeApi([
      [
        row({ id: "1", name: "Бета", trackCount: 3 }),
        row({ id: "2", name: "Альфа", trackCount: 9 }),
      ],
    ]);
    render(<AdminPublicPlaylistsSection api={api} />);
    await waitFor(() => expect(screen.getByText("Альфа")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Tracks/ }));

    const first = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[0].textContent;
    expect(first).toBe("Альфа"); // 9 > 3 — числовая колонка идёт по убыванию
    expect(screen.getByRole("columnheader", { name: /Tracks/ }).getAttribute("aria-sort")).toBe("descending");
  });
});
