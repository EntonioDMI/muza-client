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

describe("плагинные ключи композиции (T44)", () => {
  const K = "plugin:sync-translator:tab1";
  const KB = "plugin:sync-translator:btn1";

  it("bar: валидный плагинный ключ сохраняется, невалидный выбрасывается", () => {
    // ключ есть в pluginKeys → живёт; чужой plugin-ключ (плагин снят) → вон
    const saved = [
      { key: "queue", on: true },
      { key: KB, on: false },
      { key: "plugin:removed:x", on: true },
    ] as BarButtonPref[];
    const out = normalizeBarButtons(saved, [KB]);
    expect(out.find((b) => b.key === KB)).toEqual({ key: KB, on: false });
    expect(out.some((b) => b.key === "plugin:removed:x")).toBe(false);
  });

  it("bar: отсутствующий валидный плагинный ключ дописывается в конец включённым", () => {
    const out = normalizeBarButtons([{ key: "queue", on: true }] as BarButtonPref[], [KB]);
    expect(out[out.length - 1]).toEqual({ key: KB, on: true });
  });

  it("bar: без pluginKeys любой плагинный ключ выбрасывается", () => {
    const out = normalizeBarButtons([{ key: KB, on: true }] as BarButtonPref[]);
    expect(out.some((b) => b.key === KB)).toBe(false);
  });

  it("nav: валидный плагинный ключ живёт и сохраняет label", () => {
    const out = normalizeNavItems([{ key: K, on: false, label: "Перевод" }] as NavItemPref[], [K]);
    const item = out.find((n) => n.key === K);
    expect(item).toEqual({ key: K, on: false, label: "Перевод" });
  });

  it("nav: плагинный ключ вне множества выбрасывается (плагин удалён/выключен)", () => {
    const out = normalizeNavItems([{ key: K, on: true }] as NavItemPref[], []);
    expect(out.some((n) => n.key === K)).toBe(false);
  });
});
