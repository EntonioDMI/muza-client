import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, Track } from "@muza/api-client";
import { AdminView } from "./AdminView";

// Прогон всех шести вкладок админки после ревизии 05.08. Вкладки «Контент»,
// «Здоровье», «Рост» и «Ошибки» переписаны целиком на Panel/Table, а ошибка
// разметки в любой из них видна только в живом окне — этот тест открывает
// каждую и проверяет, что она дорисовалась.
// Без LanguageProvider → DEFAULT_LANG="en".
//
// 06.08: моки приведены к новому контракту — сервер присылает знаменатели
// (AdminContent.totals, AdminErrors.topTotal) и страницу публичных плейлистов
// вместо голого массива. Именно по ним экран пишет «показаны N из M».

afterEach(() => cleanup());

const track = (over: Partial<Track> = {}): Track => ({
  id: "t1",
  artist: "Anna",
  title: "Song",
  durationSec: 180,
  coverUrl: null,
  isCached: false,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
  ...over,
});

const series = [
  { bucket: "2026-08-01", count: 2 },
  { bucket: "2026-08-02", count: 5 },
];

function makeApi() {
  return {
    getAdminOverview: vi.fn().mockResolvedValue({
      users: { total: 10, withEmail: 4, admins: 1, new7d: 2 },
      listeners: { dau: 3, wau: 6, mau: 9 },
      plays: { today: 5, week: 20, total: 100, completedWeek: 15 },
      catalog: { tracks: 50, sources: 60, deadSources: 1, cached: 12 },
    }),
    getAdminContent: vi.fn().mockResolvedValue({
      days: 14,
      limit: 20,
      totals: { topTracks: 9, topArtists: 4, recentTracks: 50 },
      topTracks: [{ track: track(), plays: 7 }],
      topArtists: [{ artist: "Anna", plays: 7 }],
      recentTracks: [track({ id: "t2", title: "Fresh" })],
      sourcesByProvider: [{ provider: "youtube", kind: "audio", count: 40, dead: 1 }],
      coverage: { tracks: 50, withLyrics: 30, withSynced: 10, withAnnotations: 5 },
    }),
    getAdminPublicPlaylists: vi.fn().mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] }),
    getMarketThemes: vi.fn().mockResolvedValue([]),
    getAdminHealth: vi.fn().mockResolvedValue({
      windowHours: 24,
      totals: {
        reports: 10,
        resolveOk: 8,
        resolveFail: 2,
        attempts: 12,
        cacheHits: 4,
        fail403: 1,
        failBot: 0,
        failFormat: 1,
        failOther: 0,
        plays: 30,
        playsCompleted: 20,
        successRate: 0.8,
        cacheHitRate: 0.33,
      },
      byRecipe: [{ recipeVersion: 3, reports: 10, ok: 8, fail: 2, successRate: 0.8 }],
      byApp: [{ appVersion: "0.1.5", reports: 10, ok: 8, fail: 2 }],
      recipeVersion: 3,
    }),
    getAdminGrowth: vi.fn().mockResolvedValue({
      days: 30,
      registrations: series,
      visits: series,
      downloads: { total: 500, byAsset: [{ tag: "v0.1.5", asset: "Muza.msi", count: 300 }], series },
    }),
    getAdminErrors: vi.fn().mockResolvedValue({
      days: 7,
      limit: 20,
      totals: { count: 4, distinct: 2 },
      topTotal: 2,
      series,
      top: [
        {
          stackHash: "abc",
          kind: "error",
          message: "Boom",
          count: 3,
          lastSeen: "2026-08-02T10:00:00.000Z",
          appVersions: ["0.1.5"],
        },
      ],
      byKind: [{ kind: "error", count: 4 }],
      byApp: [{ appVersion: "0.1.5", count: 4 }],
    }),
    getAdminUsers: vi.fn().mockResolvedValue({
      total: 1,
      users: [
        {
          id: "u1",
          username: "anna",
          hasEmail: true,
          isAdmin: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          plays30d: 5,
          lastPlayAt: null,
        },
      ],
    }),
  } as unknown as MuzaApi;
}

const openTab = async (name: string, marker: string | RegExp) => {
  fireEvent.click(screen.getByRole("tab", { name }));
  await waitFor(() => expect(screen.getByText(marker)).toBeTruthy());
};

describe("AdminView — все вкладки рисуются", () => {
  it("обзор открыт сразу", async () => {
    render(<AdminView api={makeApi()} />);

    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Admin");
  });

  it("рост: числа, графики и таблица файлов релиза", async () => {
    render(<AdminView api={makeApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    await openTab("Growth", "Visits");
    expect(screen.getByText("Muza.msi")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "Visits" }).length).toBe(1);
  });

  it("контент: таблицы источников, топов и нового в каталоге", async () => {
    render(<AdminView api={makeApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    await openTab("Content", "Catalog coverage");
    expect(screen.getByText("youtube · audio")).toBeTruthy();
    expect(screen.getByText("Anna — Fresh")).toBeTruthy();
    // топы обрезаны сервером — подпись называет и показанное, и общее
    expect(screen.getByText("Showing 1 of 9")).toBeTruthy(); // треки
    expect(screen.getByText("Showing 1 of 4")).toBeTruthy(); // артисты
    expect(screen.getByText("Showing 1 of 50")).toBeTruthy(); // новое в каталоге
  });

  it("здоровье добычи: сводка и разбивки", async () => {
    render(<AdminView api={makeApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    await openTab("Extraction health", "Success-rate");
    expect(screen.getAllByText("80%").length).toBe(2); // плитка сводки и строка рецепта
    expect(screen.getByText("v3 (current)")).toBeTruthy();
  });

  it("ошибки: группа раскрывается в детали", async () => {
    render(<AdminView api={makeApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    await openTab("Errors", "Top errors");
    expect(screen.getByText("Showing 1 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Boom/ }));

    expect(screen.getByText("abc")).toBeTruthy(); // хэш группы виден только в деталях
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("пользователи: таблица и счётчик", async () => {
    render(<AdminView api={makeApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    await openTab("Users", "Showing 1");
    expect(screen.getByText("anna · ✉")).toBeTruthy();
  });
});
