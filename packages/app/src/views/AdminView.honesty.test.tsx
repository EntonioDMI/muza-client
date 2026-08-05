import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MarketTheme, MuzaApi, Track } from "@muza/api-client";
import { AdminMarketThemesSection, AdminView } from "./AdminView";

/** ЧЕСТНОСТЬ ПОДПИСЕЙ ПОД ОБРЕЗАННЫМИ СПИСКАМИ (06.08).
 *
 *  Три подписи админки утверждали за сервер то, чего он не говорил:
 *
 *  1. «Это весь топ, который присылает сервер — он не считает, сколько их
 *     всего» вылезало и тогда, когда сервер посчитал и ответил ровно столько же,
 *     сколько показано. Виновата была эвристика: «длина в потолок и знаменатель
 *     ей равен → знаменателя нет». Она не могла отличить «не прислал» от
 *     «прислал, и вышло ровно 20», потому что @muza/api-client затирал молчание
 *     сервера длиной списка ещё до экрана.
 *  2. Предупреждение «если тем больше, сюда они не попадут» показывалось на
 *     любой витрине от полусотни тем — включая полную из шестидесяти.
 *  3. Провалившаяся ПЕРЕЧИТКА оставляла прежние цифры на экране молча.
 *
 *  Без LanguageProvider → DEFAULT_LANG="en". */

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

const theme = (i: number): MarketTheme => ({
  id: String(i),
  name: `Тема ${i}`,
  author: "author",
  installs: i,
  createdAt: "2026-08-01T00:00:00.000Z",
  payload: {},
  isMine: false,
  hidden: false,
});

const emptySeries: { bucket: string; count: number }[] = [];

/** Сервер, который знаменатели ПРИСЫЛАЕТ, и они равны длине списка. */
function countingApi(over: Partial<Record<string, unknown>> = {}) {
  return {
    getAdminOverview: vi.fn().mockResolvedValue({
      users: { total: 1, withEmail: 1, admins: 1, new7d: 0 },
      listeners: { dau: 1, wau: 1, mau: 1 },
      plays: { today: 1, week: 1, total: 1, completedWeek: 1 },
      catalog: { tracks: 1, sources: 1, deadSources: 0, cached: 0 },
    }),
    getAdminContent: vi.fn().mockResolvedValue({
      days: 14,
      limit: 1,
      // сервер ПОСЧИТАЛ: всего одна строка, столько же и показано
      totals: { topTracks: 1, topArtists: 1, recentTracks: 1 },
      topTracks: [{ track: track(), plays: 7 }],
      topArtists: [{ artist: "Anna", plays: 7 }],
      recentTracks: [track({ id: "t2" })],
      sourcesByProvider: [],
      coverage: { tracks: 1, withLyrics: 0, withSynced: 0, withAnnotations: 0 },
    }),
    getAdminPublicPlaylists: vi.fn().mockResolvedValue({ total: 0, limit: 50, offset: 0, items: [] }),
    getMarketThemes: vi.fn().mockResolvedValue([]),
    getAdminErrors: vi.fn().mockResolvedValue({
      days: 7,
      limit: 1,
      totals: { count: 1, distinct: 1 },
      topTotal: 1,
      series: emptySeries,
      top: [{ stackHash: "abc", kind: "js", message: "Boom", count: 1, lastSeen: "2026-08-01T00:00:00.000Z", appVersions: ["0.2.0"] }],
      byKind: [],
      byApp: [],
    }),
    ...over,
  } as unknown as MuzaApi;
}

const openTab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("знаменатель: молчание сервера и его ответ — разные вещи", () => {
  it("сервер посчитал и вышло ровно столько же → счётчик, а не «он не считает»", async () => {
    render(<AdminView api={countingApi()} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    openTab("Content");

    await waitFor(() => expect(screen.getByText("Catalog coverage")).toBeTruthy());
    expect(screen.queryByText(/whole top the server sends/)).toBeNull();
    // счётчик есть: показанное совпало со всем, и Counter говорит просто «Showing 1»
    expect(screen.getAllByText("Showing 1").length).toBeGreaterThan(0);
  });

  it("сервер знаменателя не прислал (null) → говорим об этом вслух", async () => {
    const api = countingApi({
      getAdminContent: vi.fn().mockResolvedValue({
        days: 14,
        limit: null,
        totals: { topTracks: null, topArtists: null, recentTracks: null },
        topTracks: [{ track: track(), plays: 7 }],
        topArtists: [{ artist: "Anna", plays: 7 }],
        recentTracks: [track({ id: "t2" })],
        sourcesByProvider: [],
        coverage: { tracks: 1, withLyrics: 0, withSynced: 0, withAnnotations: 0 },
      }),
    });
    render(<AdminView api={api} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    openTab("Content");

    await waitFor(() => expect(screen.getByText("Catalog coverage")).toBeTruthy());
    expect(screen.getAllByText(/whole top the server sends/).length).toBe(2); // треки и артисты
  });
});

describe("витрина тем: предупреждение о потолке", () => {
  it("60 тем при уваженном limit=100 → полный список, предупреждения нет", async () => {
    const api = {
      getMarketThemes: vi.fn().mockResolvedValue(Array.from({ length: 60 }, (_, i) => theme(i))),
    } as unknown as MuzaApi;
    render(<AdminMarketThemesSection api={api} />);

    await waitFor(() => expect(screen.getByText("Тема 0")).toBeTruthy());
    expect(screen.queryByText(/won't show up here/)).toBeNull();
  });

  it("ровно 50 тем → сервер мог не понять limit, предупреждаем", async () => {
    const api = {
      getMarketThemes: vi.fn().mockResolvedValue(Array.from({ length: 50 }, (_, i) => theme(i))),
    } as unknown as MuzaApi;
    render(<AdminMarketThemesSection api={api} />);

    await waitFor(() => expect(screen.getByText("Тема 0")).toBeTruthy());
    expect(screen.getByText(/won't show up here/)).toBeTruthy();
  });
});

describe("провалившаяся перечитка не притворяется свежими данными", () => {
  it("«Ошибки»: смена окна отказала → прежние строки помечены, кнопка на месте", async () => {
    let call = 0;
    const getAdminErrors = vi.fn(async () => {
      call += 1;
      if (call > 1) throw new Error("Failed to fetch");
      return {
        days: 7,
        limit: 1,
        totals: { count: 1, distinct: 1 },
        topTotal: 1,
        series: emptySeries,
        top: [
          { stackHash: "abc", kind: "js", message: "Boom", count: 1, lastSeen: "2026-08-01T00:00:00.000Z", appVersions: ["0.2.0"] },
        ],
        byKind: [],
        byApp: [],
      };
    });
    render(<AdminView api={countingApi({ getAdminErrors })} />);
    await waitFor(() => expect(screen.getByText("Listeners")).toBeTruthy());
    openTab("Errors");
    await waitFor(() => expect(screen.getByText(/Boom/)).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "30 days" }));

    await waitFor(() => expect(screen.getByText(/refresh failed/)).toBeTruthy());
    // строки НЕ исчезли — но и не выдаются за свежие
    expect(screen.getByText(/Boom/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ask again/ })).toBeTruthy();
  });
});
