/** Нормализация списка блоков «Статистики» — на ВРАЖДЕБНОМ входе.
 *
 *  Профиль настроек переносимый (prefs/load.ts): его правят руками, приносят с
 *  чужой машины, пишут скриптом. До правки 2026-08-03 функция итерировала
 *  сохранённое без единой защиты, и `"statsBlocks": null` в профиле роняло и
 *  под-экран «Статистика», и всю страницу статистики. У соседей по модели
 *  (barButtons, navItems) такая защита стояла с самого начала. */

import { describe, expect, it } from "vitest";
import { normalizeStatsBlocks } from "./statsBlocks";
import { STATS_BLOCK_KEYS } from "../prefs/types";

describe("normalizeStatsBlocks", () => {
  it("пустой список → все блоки по канону, включёнными", () => {
    expect(normalizeStatsBlocks([])).toEqual(STATS_BLOCK_KEYS.map((key) => ({ key, on: true })));
  });

  it("не массив (null/объект/строка) не роняет страницу", () => {
    for (const junk of [null, undefined, {}, "summary", 7]) {
      expect(normalizeStatsBlocks(junk as never)).toEqual(STATS_BLOCK_KEYS.map((key) => ({ key, on: true })));
    }
  });

  it("мусорные элементы выбрасываются, годные сохраняют порядок и состояние", () => {
    const out = normalizeStatsBlocks([
      null,
      { key: "likes", on: false },
      "streaks",
      { key: "wrapped", on: true }, // блок удалён 2026-07-16
      { key: "likes", on: true }, // повтор
    ] as never);
    expect(out[0]).toEqual({ key: "likes", on: false });
    expect(out.map((b) => b.key).sort()).toEqual([...STATS_BLOCK_KEYS].sort());
    expect(out.some((b) => (b.key as string) === "wrapped")).toBe(false);
  });

  it("`on` всегда булево — Switch не получает undefined из битого профиля", () => {
    const out = normalizeStatsBlocks([{ key: "summary" }] as never);
    expect(out[0]).toEqual({ key: "summary", on: false });
    expect(out.every((b) => typeof b.on === "boolean")).toBe(true);
  });
});
