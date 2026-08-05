import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MarketTheme, MuzaApi } from "@muza/api-client";
import { AdminMarketThemesSection } from "./AdminView";

// Модерация витрины тем. Главное здесь, кроме скрыть/вернуть, — ЧЕСТНОСТЬ
// ОБРЕЗАНИЯ (05.08): витрина отдаёт максимум 50 тем за раз, и раньше об этом
// нигде не говорилось — тем сверх полусотни админ не видел вовсе.
// Без LanguageProvider → DEFAULT_LANG="en".

afterEach(() => cleanup());

const theme = (over: Partial<MarketTheme> = {}): MarketTheme => ({
  id: "1",
  name: "Полночь",
  author: "anna",
  installs: 3,
  createdAt: "2026-07-01T00:00:00.000Z",
  payload: {},
  isMine: false,
  hidden: false,
  ...over,
});

function makeApi(rows: MarketTheme[]) {
  const getMarketThemes = vi.fn().mockResolvedValue(rows);
  const setMarketThemeHidden = vi.fn().mockResolvedValue(undefined);
  return { api: { getMarketThemes, setMarketThemeHidden } as unknown as MuzaApi, setMarketThemeHidden };
}

const firstCells = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("AdminMarketThemesSection", () => {
  it("сразу сортирует по установкам — сверху самые ставленые", async () => {
    const { api } = makeApi([
      theme({ id: "1", name: "Полночь", installs: 3 }),
      theme({ id: "2", name: "Рассвет", installs: 40 }),
    ]);
    render(<AdminMarketThemesSection api={api} />);

    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(firstCells()).toEqual(["Рассвет", "Полночь"]);
  });

  it("счётчик показывает, сколько тем на глазах", async () => {
    const { api } = makeApi([theme({ id: "1" }), theme({ id: "2" }), theme({ id: "3" })]);
    render(<AdminMarketThemesSection api={api} />);

    await waitFor(() => expect(screen.getByText("Showing 3")).toBeTruthy());
    expect(screen.queryByText(/everything the list holds/)).toBeNull();
  });

  it("упёрлись в потолок витрины — говорим об этом словами", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => theme({ id: String(i), name: `Тема ${i}` }));
    const { api } = makeApi(rows);
    render(<AdminMarketThemesSection api={api} />);

    await waitFor(() => expect(screen.getByText(/everything the list holds/)).toBeTruthy());
  });

  it("скрытая тема помечена и возвращается одной кнопкой", async () => {
    const { api, setMarketThemeHidden } = makeApi([theme({ id: "9", hidden: true })]);
    render(<AdminMarketThemesSection api={api} />);
    await waitFor(() => expect(screen.getByText("hidden")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Return to the market" }));

    await waitFor(() => expect(setMarketThemeHidden).toHaveBeenCalledWith("9", false));
  });

  it("пустая витрина: шапка таблицы на месте, вместо строк — объяснение", async () => {
    const { api } = makeApi([]);
    render(<AdminMarketThemesSection api={api} />);

    await waitFor(() => expect(screen.getByText("No themes on the market yet.")).toBeTruthy());
    expect(screen.getAllByRole("columnheader").length).toBe(4);
  });
});
