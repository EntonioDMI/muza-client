import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, StatsOverview } from "@muza/api-client";
import { DEFAULT_PREFS, type Prefs } from "../types";
import { StatsView } from "./StatsView";

/** Сам экран переехал в @muza/app (его форма — packages/app/src/views/
 *  StatsView.test.tsx). Здесь остаётся то, что умеет ТОЛЬКО приложение:
 *  превращение сохранённых prefs.statsBlocks в список блоков экрана. */

afterEach(() => {
  cleanup();
  localStorage.clear();
});
beforeEach(() => localStorage.clear());

const noop = () => undefined;

const overview: StatsOverview = {
  period: "month",
  totalPlays: 35,
  totalMs: 4_558_893,
  uniqueTracks: 20,
  uniqueArtists: 12,
  series: [
    { bucket: "2026-07-10", plays: 1, ms: 541_622 },
    { bucket: "2026-07-11", plays: 8, ms: 1_310_057 },
    { bucket: "2026-07-12", plays: 0, ms: 6_758 },
    { bucket: "2026-07-13", plays: 3, ms: 553_544 },
    { bucket: "2026-07-14", plays: 21, ms: 1_993_535 },
    { bucket: "2026-07-15", plays: 2, ms: 145_755 },
    { bucket: "2026-07-16", plays: 0, ms: 7_622 },
  ],
  hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? 9 : 0)),
  topHour: 21,
  topTracks: [],
  topArtists: [],
  activeDays: 5,
  currentStreakDays: 2,
  longestStreakDays: 5,
  favoritesAdded: 7,
};

function renderView(prefs: Prefs) {
  const api = { getStatsOverview: vi.fn().mockResolvedValue(overview) } as unknown as MuzaApi;
  return render(
    <StatsView
      api={api}
      canSearch
      prefs={prefs}
      currentId={null}
      playing={false}
      likes={[]}
      onPlayCatalog={noop}
      onLike={noop}
      onCatalogMenu={noop}
      onCustomize={noop}
    />,
  );
}

// Рендер без LanguageProvider → useT() фолбэкает на EN (прецедент —
// PlaylistView.test.tsx); ассерты на английские строки словаря.
describe("StatsView — блок «Итоги года» удалён (2026-07-16)", () => {
  it("сохранённый prefs с «wrapped» не рисует входа во Wrapped, остальные блоки живы", async () => {
    // живой пользователь: старое сохранение ещё содержит ключ wrapped
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      statsBlocks: [
        { key: "summary", on: true },
        { key: "wrapped", on: true },
        { key: "streaks", on: true },
        { key: "likes", on: true },
      ] as never,
    };
    renderView(prefs);
    await waitFor(() => expect(screen.getByText("minutes of music")).toBeTruthy());
    expect(screen.queryByText(/wrapped/i)).toBeNull();
    // редизайн «Серий» и «Лайков»: герой-числа и строки-производные на месте
    expect(screen.getByText("current streak")).toBeTruthy();
    expect(screen.getByText(/toward the record · 2\/5/)).toBeTruthy(); // 2 < 5 → полоса «до рекорда»
    expect(screen.getByText("+7")).toBeTruthy();
    expect(screen.getByText("1 in 5")).toBeTruthy(); // 35 прослушиваний / 7 лайков
    expect(screen.getByText("1 a day")).toBeTruthy(); // 7 лайков на 7 дневных вёдер
  });

  it("выключенный в prefs блок на страницу не попадает", async () => {
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      statsBlocks: DEFAULT_PREFS.statsBlocks.map((b) => (b.key === "streaks" ? { ...b, on: false } : b)),
    };
    renderView(prefs);
    await waitFor(() => expect(screen.getByText("minutes of music")).toBeTruthy());
    expect(screen.queryByText("current streak")).toBeNull();
  });
});
