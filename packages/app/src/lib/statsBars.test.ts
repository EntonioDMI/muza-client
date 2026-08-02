import { describe, expect, it } from "vitest";
import { BAR_MAX_WIDTH, barSpecs } from "./statsBars";

/** Числа первого кейса — реальная неделя владельца из dev-БД (16.07.2026):
 *  доказательство, что высоты и раньше были честными, а «сплошную плашку»
 *  давала ШИРИНА (flex:1 без кэпа — см. BAR_MAX_WIDTH и рендер Bars). */
describe("barSpecs — форма бар-графика статистики", () => {
  it("высоты пропорциональны максимуму (реальные данные владельца)", () => {
    const specs = barSpecs([1, 8, 0, 3, 21, 2, 0]);
    expect(specs[4]).toBeCloseTo(100); // 21 прослушивание — максимум
    expect(specs[1]).toBeCloseTo((8 / 21) * 100);
    expect(specs[3]).toBeCloseTo((3 / 21) * 100);
    expect(specs[2]).toBeNull(); // ноль — не бар, а 2px-штрих подложки
    expect(specs[6]).toBeNull();
  });

  it("пол 4%: единичное значение видно, но не завышается сверх пола", () => {
    expect(barSpecs([1, 100])[0]).toBe(4);
    expect(barSpecs([1, 100])[1]).toBeCloseTo(100);
  });

  it("все нули → только штрихи, деления на ноль нет", () => {
    expect(barSpecs([0, 0, 0])).toEqual([null, null, null]);
  });

  it("одно ведро («Всё время» у молодой истории) — один бар 100%", () => {
    expect(barSpecs([35])).toEqual([100]);
  });

  it("кэп ширины существует и разумен (стройная колонка, не плита)", () => {
    expect(BAR_MAX_WIDTH).toBeGreaterThanOrEqual(8);
    expect(BAR_MAX_WIDTH).toBeLessThanOrEqual(40);
  });
});
