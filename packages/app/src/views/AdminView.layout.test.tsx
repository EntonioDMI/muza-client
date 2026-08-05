import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, Track } from "@muza/api-client";
import { AdminView } from "./AdminView";

/** СТОРОЖ ШИРИНЫ КОЛОНОК (06.08).
 *
 *  Приложение не открывается уже 1024px (tauri.conf, minWidth), и на этом окне
 *  таблице внутри карточки админки достаётся около 660px — замер записан в
 *  шапке Table (@muza/ui). Table считает себе нижнюю границу ширины: сумма
 *  пиксельных ширин колонок плюс 160px на каждую колонку БЕЗ ширины (иначе
 *  фиксированная раскладка отдаёт такой колонке ноль). Не влезло — таблица
 *  уезжает в собственную горизонтальную прокрутку.
 *
 *  Прокрутка — спасательный круг, а не раскладка: до этой ревизии две таблицы
 *  на неё опирались постоянно (публичные плейлисты — 910px в поле 660,
 *  пользователи — 700). Тест читает minWidth ЖИВЫХ таблиц всех вкладок и не даёт
 *  сумме перевалить за поле. Одной проверкой закрыты обе половины требования:
 *  сумма пикселей влезает И колонке без ширины остаётся её читаемый минимум —
 *  160px входят в ту же сумму.
 *
 *  Без LanguageProvider → DEFAULT_LANG="en" (английские подписи длиннее русских
 *  редко, но проверяем именно тот словарь, что видит тест). */

afterEach(() => cleanup());

/** Поле таблицы на минимальном окне приложения. */
const FIELD_1024 = 660;

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

const series = [{ bucket: "2026-08-01", count: 2 }];

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
      totals: { topTracks: 1, topArtists: 1, recentTracks: 50 },
      topTracks: [{ track: track(), plays: 7 }],
      topArtists: [{ artist: "Anna", plays: 7 }],
      recentTracks: [track({ id: "t2", title: "Fresh" })],
      sourcesByProvider: [{ provider: "youtube", kind: "audio", count: 40, dead: 1 }],
      coverage: { tracks: 50, withLyrics: 30, withSynced: 10, withAnnotations: 5 },
    }),
    getAdminPublicPlaylists: vi.fn().mockResolvedValue({
      total: 1,
      limit: 50,
      offset: 0,
      items: [
        {
          id: "p1",
          name: "Лучший фонк 2026",
          ownerUsername: "creator",
          trackCount: 42,
          followersCount: 5,
          handle: null,
          publishedAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    }),
    getMarketThemes: vi.fn().mockResolvedValue([
      { id: "1", name: "Полночь", author: "anna", installs: 3, createdAt: "2026-07-01T00:00:00.000Z", payload: {}, isMine: false, hidden: false },
    ]),
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
      top: [],
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

/** Нижние границы ширины всех таблиц, что сейчас на экране. */
const tableMinWidths = () =>
  screen.getAllByRole("table").map((el) => ({
    name: el.getAttribute("aria-label") ?? "?",
    minWidth: parseFloat((el as HTMLTableElement).style.minWidth || "0"),
  }));

const openTab = async (name: string, marker: string | RegExp) => {
  fireEvent.click(screen.getByRole("tab", { name }));
  await waitFor(() => expect(screen.getByText(marker)).toBeTruthy());
};

describe("ширина колонок админки", () => {
  it("«Контент»: ни одна таблица не шире поля на минимальном окне", async () => {
    render(<AdminView api={makeApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    await openTab("Content", "Catalog coverage");
    // публикации и темы грузятся своими запросами — ждём, пока приедут все шесть:
    // источники, топ треков, топ артистов, новое в каталоге, публикации, темы
    await waitFor(() => expect(screen.getAllByRole("table").length).toBe(6));
    const widths = tableMinWidths();
    const tooWide = widths.filter((w) => w.minWidth > FIELD_1024);
    expect(tooWide.map((w) => `${w.name}: ${w.minWidth}px > ${FIELD_1024}px`)).toEqual([]);
  });

  it("«Рост», «Здоровье», «Пользователи»: то же самое", async () => {
    render(<AdminView api={makeApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    for (const [tab, marker] of [
      ["Growth", "Visits"],
      ["Extraction health", "Success-rate"],
      ["Users", /Total 1/],
    ] as const) {
      await openTab(tab, marker);
      const widths = tableMinWidths();
      expect(widths.length).toBeGreaterThan(0);
      const tooWide = widths.filter((w) => w.minWidth > FIELD_1024);
      expect(tooWide.map((w) => `${tab} / ${w.name}: ${w.minWidth}px > ${FIELD_1024}px`)).toEqual([]);
    }
  });

  /** Снимок замера 06.08 — по живой разметке, не по арифметике из головы.
   *  Числа стоят здесь ради двух вещей: видно, во что обошлась каждая таблица,
   *  и видно, сколько осталось до потолка. Меняешь ширины — обнови и запись. */
  it("две бывшие нарушительницы влезли: 910→636 и 700→568", async () => {
    render(<AdminView api={makeApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());

    await openTab("Content", "Catalog coverage");
    await waitFor(() => expect(screen.getAllByRole("table").length).toBe(6));
    expect(tableMinWidths()).toEqual([
      { name: "Sources", minWidth: 344 },
      { name: "Top tracks (14 days)", minWidth: 276 },
      { name: "Top artists (14 days)", minWidth: 276 },
      { name: "New in catalog", minWidth: 320 },
      // шесть колонок — самая тесная таблица экрана; было 910px в поле 660
      { name: "Public playlists", minWidth: 636 },
      { name: "Themes on the market", minWidth: 440 },
    ]);

    await openTab("Users", /Total 1/);
    expect(tableMinWidths()).toEqual([{ name: "Users", minWidth: 568 }]); // было 700px
  });
});
