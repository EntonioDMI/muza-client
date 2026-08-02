import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StatsBlocksDialog, enabledStatsBlocks, normalizeStatsBlocks } from "./StatsBlocksDialog";

afterEach(cleanup);

// Регресс, который закрывает диалог (2026-08-02): в вебе кнопки «Настроить»
// не было вовсе, состав блоков страницы статистики не менялся никак.
// Рендер без LanguageProvider → useT() фолбэкает на EN (прецедент —
// StatsView.test.tsx); ассерты на английские строки словаря.

describe("normalizeStatsBlocks — сохранённый список в полный", () => {
  it("пустое сохранение (состав ни разу не трогали) — все блоки в каноническом порядке", () => {
    const out = normalizeStatsBlocks([]);
    expect(out.map((b) => b.key)).toEqual([
      "summary",
      "activity",
      "rhythm",
      "top_tracks",
      "top_artists",
      "streaks",
      "likes",
    ]);
    expect(out.every((b) => b.on)).toBe(true);
  });

  it("свой порядок сохраняется, чужие ключи выбрасываются, новые блоки дописываются включёнными", () => {
    const out = normalizeStatsBlocks([
      { key: "likes", on: false },
      { key: "wrapped", on: true }, // блок удалён в 0.1.3 — его в списке быть не должно
      { key: "summary", on: true },
      { key: "summary", on: false }, // дубль игнорируется
    ]);
    expect(out.slice(0, 2)).toEqual([
      { key: "likes", on: false },
      { key: "summary", on: true },
    ]);
    expect(out.map((b) => b.key)).not.toContain("wrapped");
    expect(out).toHaveLength(7);
    expect(out.slice(2).every((b) => b.on)).toBe(true);
  });

  it("выключенные блоки не попадают в список показа, порядок — как в профиле", () => {
    expect(
      enabledStatsBlocks([
        { key: "streaks", on: true },
        { key: "summary", on: false },
      ]),
    ).toEqual(["streaks", "activity", "rhythm", "top_tracks", "top_artists", "likes"]);
  });
});

describe("StatsBlocksDialog — состав и порядок блоков в вебе", () => {
  it("показывает все блоки с пояснениями и отдаёт новый список целиком при выключении", () => {
    const onChange = vi.fn();
    render(<StatsBlocksDialog open blocks={[]} onChange={onChange} onClose={vi.fn()} />);

    expect(screen.getByText("Summary")).toBeTruthy();
    expect(screen.getByText("Daily rhythm")).toBeTruthy();

    // переключатель блока «Сводка» — первый в списке
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next[0]).toEqual({ key: "summary", on: false });
    expect(next).toHaveLength(7);
  });

  it("стрелка «ниже» меняет местами соседей, у краёв список не рвётся", () => {
    const onChange = vi.fn();
    render(<StatsBlocksDialog open blocks={[]} onChange={onChange} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Move down: Summary/i }));
    expect(onChange.mock.calls[0][0].map((b: { key: string }) => b.key).slice(0, 2)).toEqual(["activity", "summary"]);

    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Move up: Summary/i })); // первый блок — выше некуда
    expect(onChange).not.toHaveBeenCalled();
  });

  it("закрытый диалог ничего не рисует", () => {
    render(<StatsBlocksDialog open={false} blocks={[]} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("Summary")).toBeNull();
  });
});
