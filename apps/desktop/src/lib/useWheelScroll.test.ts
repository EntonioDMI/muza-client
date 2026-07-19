import { describe, expect, it } from "vitest";
import { scaleDelta, stepToward } from "./useWheelScroll";

describe("scaleDelta", () => {
  it("пиксельный режим: чистое умножение на скорость", () => {
    expect(scaleDelta(100, 0, 100)).toBe(100);
    expect(scaleDelta(100, 0, 200)).toBe(200);
    expect(scaleDelta(100, 0, 50)).toBe(50);
  });

  it("строчный и страничный deltaMode приводятся к пикселям", () => {
    expect(scaleDelta(3, 1, 100)).toBe(120); // 3 строки × 40px
    expect(scaleDelta(1, 2, 100)).toBe(400); // 1 страница × 400px
  });

  it("знак сохраняется (прокрутка вверх)", () => {
    expect(scaleDelta(-100, 0, 150)).toBe(-150);
  });
});

describe("stepToward", () => {
  it("движется к цели, не перелетая", () => {
    const next = stepToward(0, 100, 16);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(100);
  });

  it("ближе полупикселя — прилипает к цели точно", () => {
    expect(stepToward(99.7, 100, 16)).toBe(100);
  });

  it("за один полураспад проходит половину пути", () => {
    expect(stepToward(0, 100, 90)).toBeCloseTo(50, 5);
  });

  it("работает в обе стороны", () => {
    expect(stepToward(100, 0, 90)).toBeCloseTo(50, 5);
  });
});
