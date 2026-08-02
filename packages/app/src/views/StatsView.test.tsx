import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, StatsOverview } from "@muza/api-client";
import { BAR_MAX_WIDTH } from "../lib/statsBars";
import { Bars, StatsView } from "./StatsView";

afterEach(cleanup);

const noop = () => undefined;

/** Дети контейнера role="img" — Tooltip-обёртки колонок (несут геометрию:
 *  flex/min/maxWidth/height:100%), сам бар — их первый ребёнок (высота
 *  значения). Обёртки появились с заменой нативного title на Tooltip ДС. */
function renderBars(values: number[]) {
  const { container } = render(
    <Bars values={values} titles={values.map((v) => String(v))} height={120} ariaLabel="bars" />,
  );
  const row = container.querySelector('[role="img"]') as HTMLElement;
  const cols = Array.from(row.children) as HTMLElement[];
  return { row, cols, bars: cols.map((c) => c.firstElementChild as HTMLElement) };
}

/** Фикс «сплошной плашки» (2026-07-16): ширина бара обязана быть ограничена,
 *  иначе flex:1 растягивает единственное ведро периода «Всё» (молодая история
 *  → один месяц) в сплошную плиту на всю панель, а неделю — в семь плит. */
describe("Bars — геометрия бар-графика", () => {
  it("одно ведро (реальный кейс владельца, «Всё» = [35]): бар с кэпом ширины, ряд центрирован", () => {
    const { row, cols, bars } = renderBars([35]);
    expect(bars).toHaveLength(1);
    expect(cols[0].style.maxWidth).toBe(`${BAR_MAX_WIDTH}px`); // не плита во всю панель
    expect(bars[0].style.height).toBe("100%");
    expect(row.style.justifyContent).toBe("center");
  });

  it("неделя владельца [1,8,0,3,21,2,0]: высоты пропорциональны, нули — 2px-штрихи, раскладка space-between", () => {
    const { row, cols, bars } = renderBars([1, 8, 0, 3, 21, 2, 0]);
    expect(row.style.justifyContent).toBe("space-between");
    expect(bars[4].style.height).toBe("100%"); // максимум
    expect(parseFloat(bars[1].style.height)).toBeCloseTo((8 / 21) * 100);
    expect(bars[2].style.height).toBe("2px"); // ноль — штрих подложки, не бар
    for (const c of cols) expect(c.style.maxWidth).toBe(`${BAR_MAX_WIDTH}px`);
  });
});

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

function renderView(extra: Partial<React.ComponentProps<typeof StatsView>> = {}) {
  const api = { getStatsOverview: vi.fn().mockResolvedValue(overview) } as unknown as MuzaApi;
  render(
    <StatsView
      api={api}
      canSearch
      currentId={null}
      playing={false}
      likes={[]}
      onPlayCatalog={noop}
      onLike={noop}
      onCatalogMenu={noop}
      {...extra}
    />,
  );
  return api;
}

// Рендер без LanguageProvider → useT() фолбэкает на EN (прецедент —
// PlaylistView.test.tsx); ассерты на английские строки словаря.
describe("StatsView — общий экран обоих клиентов", () => {
  it("без своего способа загрузки берёт агрегаты прямо у сервера и рисует все блоки", async () => {
    const api = renderView();
    await waitFor(() => expect(screen.getByText("minutes of music")).toBeTruthy());
    expect(api.getStatsOverview).toHaveBeenCalledWith("month");
    // редизайн «Серий» и «Лайков»: герой-числа и строки-производные на месте
    expect(screen.getByText("current streak")).toBeTruthy();
    expect(screen.getByText(/toward the record · 2\/5/)).toBeTruthy(); // 2 < 5 → полоса «до рекорда»
    expect(screen.getByText("+7")).toBeTruthy();
    expect(screen.getByText("1 in 5")).toBeTruthy(); // 35 прослушиваний / 7 лайков
    expect(screen.getByText("1 a day")).toBeTruthy(); // 7 лайков на 7 дневных вёдер
  });

  it("площадка без под-экрана настроек: кнопки «Настроить» нет вовсе, не серая", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("minutes of music")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /customi[sz]e/i })).toBeNull();

    cleanup();
    renderView({ onCustomize: noop });
    await waitFor(() => expect(screen.getByText("minutes of music")).toBeTruthy());
    expect(screen.getByRole("button", { name: /customi[sz]e/i })).toBeTruthy();
  });

  it("свой способ загрузки используется вместо прямого запроса и приносит признак «без сети»", async () => {
    const api = renderView({
      loadOverview: vi.fn().mockResolvedValue({ data: overview, offline: true }),
    });
    await waitFor(() => expect(screen.getByText("minutes of music")).toBeTruthy());
    expect(api.getStatsOverview).not.toHaveBeenCalled();
    expect(screen.getByText(/Offline copy: the server is unavailable/i)).toBeTruthy();
  });

  it("список блоков задаёт вызывающий: выключенных блоков на странице нет", async () => {
    renderView({ blocks: ["summary"] });
    await waitFor(() => expect(screen.getByText("minutes of music")).toBeTruthy());
    expect(screen.queryByText("current streak")).toBeNull();
  });
});
