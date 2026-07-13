import { describe, expect, it } from "vitest";
import { normalizeBarButtons, type BarButtonPref } from "./barButtons";
import { normalizeNavItems, type NavItemPref } from "./navItems";

describe("normalizeBarButtons", () => {
  it("сохраняет порядок и состояние, чужое выбрасывает, новое дописывает", () => {
    const saved = [
      { key: "queue", on: true },
      { key: "shuffle", on: false },
      { key: "чужое", on: true },
    ] as unknown as BarButtonPref[];
    const out = normalizeBarButtons(saved);
    expect(out[0]).toEqual({ key: "queue", on: true });
    expect(out[1]).toEqual({ key: "shuffle", on: false });
    expect(out.some((b) => (b.key as string) === "чужое")).toBe(false);
    // остальные ключи дописаны включёнными
    expect(out).toHaveLength(10);
    expect(out.slice(2).every((b) => b.on)).toBe(true);
  });

  it("пустое/битое → полный дефолт", () => {
    expect(normalizeBarButtons([])).toHaveLength(10);
    expect(normalizeBarButtons(undefined as unknown as BarButtonPref[])).toHaveLength(10);
  });
});

describe("normalizeNavItems", () => {
  it("главную выключить нельзя, label обрезается", () => {
    const saved: NavItemPref[] = [
      { key: "home", on: false },
      { key: "stats", on: false, label: "  Цифры  " },
    ];
    const out = normalizeNavItems(saved);
    expect(out[0]).toEqual({ key: "home", on: true });
    expect(out[1]).toEqual({ key: "stats", on: false, label: "Цифры" });
    expect(out).toHaveLength(5);
  });

  it("пустой label не сохраняется (дефолтное имя)", () => {
    const out = normalizeNavItems([{ key: "search", on: true, label: "   " }]);
    expect(out[0].label).toBeUndefined();
  });
});
