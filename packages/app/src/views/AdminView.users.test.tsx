import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AdminUsers, MuzaApi } from "@muza/api-client";
import { UsersTab } from "./AdminView";

// Вкладка «Пользователи» после ревизии 05.08: настоящая таблица, счётчик
// «показаны N из M», страницы и сортировка — но сортировка ТОЛЬКО когда все
// поместились на одну страницу (иначе она отсортировала бы полсотни случайных
// человек и выдала бы их за верхних).
// Без LanguageProvider → DEFAULT_LANG="en".

afterEach(() => cleanup());

const user = (over: Partial<AdminUsers["users"][number]> = {}): AdminUsers["users"][number] => ({
  id: "1",
  username: "anna",
  hasEmail: false,
  isAdmin: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  plays30d: 10,
  lastPlayAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

function makeApi(page: AdminUsers) {
  const getAdminUsers = vi.fn().mockResolvedValue(page);
  const setAdminUser = vi.fn().mockResolvedValue(undefined);
  return { api: { getAdminUsers, setAdminUser } as unknown as MuzaApi, getAdminUsers, setAdminUser };
}

const firstCells = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("UsersTab", () => {
  it("строки — ячейки таблицы, счётчик говорит сколько показано", async () => {
    const { api } = makeApi({
      total: 2,
      users: [user({ id: "1", username: "anna", plays30d: 3 }), user({ id: "2", username: "boris", plays30d: 9 })],
    });
    render(<UsersTab api={api} />);

    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(firstCells()).toEqual(["anna", "boris"]);
    expect(screen.getByText("Showing 2")).toBeTruthy();
  });

  it("сортировка по прослушиваниям: первый клик — где больше", async () => {
    const { api } = makeApi({
      total: 2,
      users: [user({ id: "1", username: "anna", plays30d: 3 }), user({ id: "2", username: "boris", plays30d: 9 })],
    });
    render(<UsersTab api={api} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Plays \(30d\)/ }));

    expect(firstCells()).toEqual(["boris", "anna"]);
    expect(screen.getByRole("columnheader", { name: /Plays \(30d\)/ }).getAttribute("aria-sort")).toBe("descending");
  });

  it("людей больше страницы: «показаны 50 из 137», листалка и объяснение, почему сортировки нет", async () => {
    const users = Array.from({ length: 50 }, (_, i) => user({ id: String(i), username: `user${i}` }));
    const { api } = makeApi({ total: 137, users });
    render(<UsersTab api={api} />);

    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.getByText("Showing 50 of 137")).toBeTruthy();
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(screen.getByText(/Sorting turns on/)).toBeTruthy();
    // заголовки не кликаются, пока сортировка врала бы
    expect(screen.queryByRole("button", { name: /Plays \(30d\)/ })).toBeNull();
  });

  it("листалка просит у сервера следующий кусок", async () => {
    const users = Array.from({ length: 50 }, (_, i) => user({ id: String(i), username: `user${i}` }));
    const { api, getAdminUsers } = makeApi({ total: 137, users });
    render(<UsersTab api={api} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(getAdminUsers).toHaveBeenLastCalledWith({ limit: 50, offset: 50, q: undefined }),
    );
  });

  it("кнопка прав дёргает сервер", async () => {
    const { api, setAdminUser } = makeApi({ total: 1, users: [user({ id: "7", username: "anna" })] });
    render(<UsersTab api={api} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Make admin" }));

    await waitFor(() => expect(setAdminUser).toHaveBeenCalledWith("7", true));
  });
});
