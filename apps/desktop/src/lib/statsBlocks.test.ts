import { describe, expect, it } from "vitest";
import { STATS_BLOCK_KEYS } from "../types";
import { normalizeStatsBlocks } from "./statsBlocks";

describe("normalizeStatsBlocks", () => {
  it("пусто — все блоки включены в каноническом порядке", () => {
    expect(normalizeStatsBlocks([])).toEqual(STATS_BLOCK_KEYS.map((key) => ({ key, on: true })));
  });
  it("сохранённый порядок и выключенность уважаются, новые блоки дописываются в конец включёнными", () => {
    const saved = [
      { key: "top_tracks" as const, on: true },
      { key: "summary" as const, on: false },
    ];
    const out = normalizeStatsBlocks(saved);
    expect(out[0]).toEqual({ key: "top_tracks", on: true });
    expect(out[1]).toEqual({ key: "summary", on: false });
    expect(out).toHaveLength(STATS_BLOCK_KEYS.length);
    expect(out.slice(2).every((b) => b.on)).toBe(true);
  });
  it("неизвестные ключи из старых сохранений выбрасываются", () => {
    const saved = [{ key: "genres", on: true }, { key: "summary", on: true }] as never;
    expect(normalizeStatsBlocks(saved).map((b) => b.key)).not.toContain("genres");
  });
  it("«wrapped» из сохранений живых пользователей (блок удалён 2026-07-16) молча отфильтровывается", () => {
    // до удаления блок был в дефолте, т.е. лежит в prefs практически у всех
    const saved = [
      { key: "summary", on: true },
      { key: "wrapped", on: true },
      { key: "likes", on: false },
    ] as never;
    const out = normalizeStatsBlocks(saved);
    expect(out.map((b) => b.key)).not.toContain("wrapped");
    // соседи не пострадали: порядок и выключенность сохранены
    expect(out[0]).toEqual({ key: "summary", on: true });
    expect(out[1]).toEqual({ key: "likes", on: false });
    expect(out).toHaveLength(STATS_BLOCK_KEYS.length);
  });
});
