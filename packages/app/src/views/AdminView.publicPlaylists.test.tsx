import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AdminPublicPlaylist, MuzaApi } from "@muza/api-client";
import { AdminPublicPlaylistsSection } from "./AdminView";

// Рубильник публичных плейлистов в админке (2026-07-17).
// Без LanguageProvider → DEFAULT_LANG="en".
//
// 05.08: список стал настоящей таблицей со страницами по 50 и счётчиком
// «показаны N из M». Заодно чекбокс «запретить снова» заменён на Switch из ДС
// (role="switch").
//
// 06.08: страницы уехали на СЕРВЕР — метод отдаёт {total, items} вместо голого
// массива. Здесь два мока: `makeApi` изображает нового сервера (честно режет по
// limit/offset), `makeLegacyApi` — прежний контракт с голым массивом. Секция
// обязана работать с обоими: контракт менялся в ту же смену, и клиент не должен
// зависеть от того, какая версия @muza/api-client окажется рядом.

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

/** Новый контракт: сервер режет сам, `total` — по всей выборке. */
function makeApi(snapshots: AdminPublicPlaylist[][]) {
  let call = 0;
  const getAdminPublicPlaylists = vi.fn(async (opts?: { limit?: number; offset?: number }) => {
    const all = snapshots[Math.min(call, snapshots.length - 1)];
    call += 1;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return { total: all.length, limit, offset, items: all.slice(offset, offset + limit) };
  });
  const unpublishAdminPlaylist = vi.fn().mockResolvedValue(undefined);
  return {
    api: { getAdminPublicPlaylists, unpublishAdminPlaylist } as unknown as MuzaApi,
    getAdminPublicPlaylists,
    unpublishAdminPlaylist,
  };
}

/** Прежний контракт: голый массив, все публикации разом. */
function makeLegacyApi(rows: AdminPublicPlaylist[]) {
  const getAdminPublicPlaylists = vi.fn().mockResolvedValue(rows);
  const unpublishAdminPlaylist = vi.fn().mockResolvedValue(undefined);
  return { api: { getAdminPublicPlaylists, unpublishAdminPlaylist } as unknown as MuzaApi, unpublishAdminPlaylist };
}

/** СВЕЖИЙ КЛИЕНТ РЯДОМ С СЕРВЕРОМ ≤0.1.5 — самый вероятный случай на проде и
 *  ровно тот, который первая версия разбора пропускала. Форма ответа новая
 *  (объект от свежего @muza/api-client), но сервер про `limit`/`offset` не знает
 *  и отдаёт ВСЁ разом, а `total`/`limit`/`offset` в его ответе просто нет. */
function makeOldServerApi(rows: AdminPublicPlaylist[]) {
  const getAdminPublicPlaylists = vi.fn(async () => ({ total: null, limit: null, offset: null, items: rows }));
  const unpublishAdminPlaylist = vi.fn().mockResolvedValue(undefined);
  return { api: { getAdminPublicPlaylists, unpublishAdminPlaylist } as unknown as MuzaApi, getAdminPublicPlaylists };
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

  it("больше страницы: «показаны 50 из 60», вторую страницу просим у сервера", async () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ id: String(i), name: `Плейлист ${i}` }));
    const { api, getAdminPublicPlaylists } = makeApi([many]);
    render(<AdminPublicPlaylistsSection api={api} />);

    await waitFor(() => expect(screen.getByText("Плейлист 0")).toBeTruthy());
    expect(screen.getByText("Showing 50 of 60")).toBeTruthy();
    expect(screen.queryByText("Плейлист 55")).toBeNull();
    expect(getAdminPublicPlaylists).toHaveBeenCalledWith({ limit: 50, offset: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(screen.getByText("Плейлист 55")).toBeTruthy());
    expect(getAdminPublicPlaylists).toHaveBeenLastCalledWith({ limit: 50, offset: 50 });
    expect(screen.getByText("Showing 10 of 60")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });

  it("сортировка выключена, пока на клиенте лежит одна страница из многих", async () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ id: String(i), name: `Плейлист ${i}` }));
    const { api } = makeApi([many]);
    render(<AdminPublicPlaylistsSection api={api} />);

    await waitFor(() => expect(screen.getByText("Плейлист 0")).toBeTruthy());
    // отсортировать 50 из 60 и выдать их за верхние — та же ложь, что запрещена
    // в таблице пользователей; вместо стрелок экран объясняет, когда она вернётся
    expect(screen.queryByRole("button", { name: /Listeners/ })).toBeNull();
    expect(screen.getByText(/Sorting turns on/)).toBeTruthy();
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

  it("старый контракт (голый массив): страницы режет таблица, счётчик честен", async () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ id: String(i), name: `Плейлист ${i}` }));
    const { api } = makeLegacyApi(many);
    render(<AdminPublicPlaylistsSection api={api} />);

    await waitFor(() => expect(screen.getByText("Плейлист 0")).toBeTruthy());
    expect(screen.getByText("Showing 50 of 60")).toBeTruthy();
    // весь массив на руках — сортировка честна, и она включена
    expect(screen.getByRole("button", { name: /Listeners/ })).toBeTruthy();
  });

  it("сервер страниц не понял (нет total/limit) → режет таблица, а не мнимая листалка", async () => {
    // ⚠️ СТОРОЖ ПРОТИВ РЕГРЕССА 06.08: различитель «сервер листал» смотрел на
    // тип значения (Array.isArray), а свежий api-client отдаёт объект ВСЕГДА —
    // и ответ старого сервера читался как честная страница. Экран показывал
    // все 60 строк одной лентой, рисовал «стр. 1 из 2», щёлкал номер без смены
    // содержимого и выключал сортировку с подписью, которую сам опровергал.
    const many = Array.from({ length: 60 }, (_, i) => row({ id: String(i), name: `Плейлист ${i}` }));
    const { api } = makeOldServerApi(many);
    render(<AdminPublicPlaylistsSection api={api} />);

    await waitFor(() => expect(screen.getByText("Плейлист 0")).toBeTruthy());
    expect(screen.getByText("Showing 50 of 60")).toBeTruthy();
    expect(screen.queryByText("Плейлист 55")).toBeNull(); // ленты нет — режет таблица
    expect(screen.getByRole("button", { name: /Listeners/ })).toBeTruthy(); // весь список в руках
    expect(screen.queryByText(/Sorting turns on/)).toBeNull();
  });
});
