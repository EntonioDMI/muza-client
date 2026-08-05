import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { AdminView } from "./AdminView";

/** ТРИ СОСТОЯНИЯ КАЖДОЙ ВКЛАДКИ (06.08).
 *
 *  До этой ревизии из трёх был честно сделан один. Пока грузилось — голая
 *  строка «Loading…»; сервер отказал — та же строка, только красная и с сырым
 *  «Failed to fetch», выйти из неё можно было только сменой вкладки; данных
 *  ноль — половина таблиц рисовала пустую строку под шапкой, и отличить «никто
 *  ничего не слушал» от «экран сломался» было нечем.
 *
 *  Здесь проверяется, что ни одно из трёх состояний не выглядит поломкой:
 *  загрузка говорит, что грузит; отказ объясняет и даёт кнопку, которая
 *  повторяет запрос; пустота каждой таблицы объясняет СВОЮ пустоту.
 *
 *  Без LanguageProvider → DEFAULT_LANG="en". */

afterEach(() => cleanup());

const emptySeries: { bucket: string; count: number }[] = [];

/** Сервер, который на всё отвечает «данных нет». */
function emptyApi() {
  return {
    getAdminOverview: vi.fn().mockResolvedValue({
      users: { total: 0, withEmail: 0, admins: 0, new7d: 0 },
      listeners: { dau: 0, wau: 0, mau: 0 },
      plays: { today: 0, week: 0, total: 0, completedWeek: 0 },
      catalog: { tracks: 0, sources: 0, deadSources: 0, cached: 0 },
    }),
    getAdminContent: vi.fn().mockResolvedValue({
      days: 14,
      limit: 20,
      totals: { topTracks: 0, topArtists: 0, recentTracks: 0 },
      topTracks: [],
      topArtists: [],
      recentTracks: [],
      sourcesByProvider: [],
      coverage: { tracks: 0, withLyrics: 0, withSynced: 0, withAnnotations: 0 },
    }),
    getAdminPublicPlaylists: vi.fn().mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] }),
    getMarketThemes: vi.fn().mockResolvedValue([]),
    getAdminHealth: vi.fn().mockResolvedValue({
      windowHours: 24,
      totals: {
        reports: 0,
        resolveOk: 0,
        resolveFail: 0,
        attempts: 0,
        cacheHits: 0,
        fail403: 0,
        failBot: 0,
        failFormat: 0,
        failOther: 0,
        plays: 0,
        playsCompleted: 0,
        successRate: null,
        cacheHitRate: null,
      },
      byRecipe: [],
      byApp: [],
      recipeVersion: 3,
    }),
    getAdminGrowth: vi.fn().mockResolvedValue({
      days: 30,
      registrations: emptySeries,
      visits: emptySeries,
      downloads: { total: 0, byAsset: [], series: emptySeries },
    }),
    getAdminErrors: vi.fn().mockResolvedValue({
      days: 7,
      limit: 20,
      totals: { count: 0, distinct: 0 },
      topTotal: 0,
      series: emptySeries,
      top: [],
      byKind: [],
      byApp: [],
    }),
    getAdminUsers: vi.fn().mockResolvedValue({ total: 0, users: [] }),
  } as unknown as MuzaApi;
}

const openTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("пустые данные объясняются словами", () => {
  it("«Контент»: у каждой таблицы свой текст пустоты, а не пустая строка", async () => {
    render(<AdminView api={emptyApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    openTab("Content");

    await waitFor(() => expect(screen.getByText(/No sources yet/)).toBeTruthy());
    // топ треков и топ артистов пусты по-разному — тексты разные
    expect(screen.getByText("Nothing was played in the last two weeks.")).toBeTruthy();
    expect(screen.getByText(/no one to rank/)).toBeTruthy();
    expect(screen.getByText(/The catalog is empty/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Nothing is published right now")).toBeTruthy());
    expect(screen.getByText("No themes on the market yet.")).toBeTruthy();
    // ...и шапки таблиц на месте: экран не «исчез», а показывает пустой список
    expect(screen.getAllByRole("table").length).toBe(6);
  });

  it("пустой список НЕ выдаёт себя за обрезанный: счётчиков и приписок нет", async () => {
    render(<AdminView api={emptyApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    openTab("Content");

    await waitFor(() => expect(screen.getByText(/No sources yet/)).toBeTruthy());
    expect(screen.queryByText(/whole top the server sends/)).toBeNull();
    expect(screen.queryByText("Showing 0")).toBeNull();
  });

  it("«Рост»: пустые графики говорят словами, таблица файлов не исчезает", async () => {
    render(<AdminView api={emptyApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    openTab("Growth");

    // текст пустоты НЕ упоминает окно: таблица файлов копит за всё время
    await waitFor(() => expect(screen.getByText(/No release files have been downloaded/)).toBeTruthy());
    // три графика: посещения, регистрации, скачивания
    expect(screen.getAllByText("No data in this window.").length).toBe(3);
    // таблица файлов релиза на месте, просто пустая
    expect(screen.getAllByRole("table").length).toBe(1);
  });

  it("«Здоровье» и «Пользователи»: пустые разбивки и пустой список людей", async () => {
    render(<AdminView api={emptyApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    openTab("Extraction health");
    await waitFor(() => expect(screen.getAllByText(/No app sent a report/).length).toBe(2));

    openTab("Users");
    await waitFor(() => expect(screen.getByText("No accounts yet.")).toBeTruthy());
  });

  it("«Ошибки»: пустое окно — это хорошая новость, а не поломка", async () => {
    render(<AdminView api={emptyApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    openTab("Errors");

    await waitFor(() => expect(screen.getByText("Not a single error in this window")).toBeTruthy());
    // нечего чистить — кнопки очистки нет
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});

describe("отказ сервера объясним и обратим", () => {
  const failingApi = (fail: { current: boolean }) =>
    ({
      getAdminOverview: vi.fn(async () => {
        if (fail.current) throw new Error("Failed to fetch");
        return {
          users: { total: 1, withEmail: 0, admins: 1, new7d: 0 },
          listeners: { dau: 1, wau: 1, mau: 1 },
          plays: { today: 0, week: 0, total: 0, completedWeek: 0 },
          catalog: { tracks: 0, sources: 0, deadSources: 0, cached: 0 },
        };
      }),
    }) as unknown as MuzaApi;

  it("отказ: объяснение обычными словами + сырой ответ + кнопка повтора", async () => {
    const fail = { current: true };
    render(<AdminView api={failingApi(fail)} />);

    await waitFor(() => expect(screen.getByText("The data didn't arrive")).toBeTruthy());
    expect(screen.getByText(/asks the server again/)).toBeTruthy();
    expect(screen.getByText("Failed to fetch")).toBeTruthy(); // сырой ответ админу полезен
    expect(screen.getByRole("button", { name: "Ask again" })).toBeTruthy();
  });

  it("кнопка повтора спрашивает сервер заново и рисует данные", async () => {
    const fail = { current: true };
    const api = failingApi(fail);
    render(<AdminView api={api} />);
    await waitFor(() => expect(screen.getByText("The data didn't arrive")).toBeTruthy());

    fail.current = false;
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));

    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    expect(screen.queryByText("The data didn't arrive")).toBeNull();
    expect(api.getAdminOverview).toHaveBeenCalledTimes(2);
  });

  it("пока грузится — сказано, что грузится", async () => {
    const never = new Promise(() => {});
    const api = { getAdminOverview: vi.fn().mockReturnValue(never) } as unknown as MuzaApi;
    render(<AdminView api={api} />);

    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("The data didn't arrive")).toBeNull();
  });
});
