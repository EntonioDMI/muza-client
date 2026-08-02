import { describe, expect, it } from "vitest";
import { wrappedSeason } from "./wrappedSeason";

/** Переехал вместе с самим модулем из apps/desktop/src/lib (волна экранов
 *  веб-паритета, 2026-08-02) — тест живёт рядом с кодом, а не там, откуда код
 *  ушёл. */
describe("wrappedSeason", () => {
  it("декабрь — сезон, итоги текущего года", () => {
    expect(wrappedSeason(new Date(2026, 11, 5))).toEqual({ inSeason: true, year: 2026 });
  });
  it("январь — сезон, итоги прошлого года", () => {
    expect(wrappedSeason(new Date(2027, 0, 15))).toEqual({ inSeason: true, year: 2026 });
  });
  it("июль — не сезон, год текущий (для превью и входа из статистики)", () => {
    expect(wrappedSeason(new Date(2026, 6, 11))).toEqual({ inSeason: false, year: 2026 });
  });
});
