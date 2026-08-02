import { describe, expect, it } from "vitest";
import { barGeometry, linePath, niceMax, xTickIndexes } from "./adminChartMath";

// Математика графиков админки (кусок C): свой рендер на токенах ДС, без
// чарт-библиотек — конвенция проекта (прецедент statsBars у StatsView).
// Чистые функции: компонент только раскладывает результат в SVG.

describe("niceMax — «красивый» потолок оси (лестница 1-2-5)", () => {
  it("нули и единицы не дают деления на ноль", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
  });

  it("округляет вверх по лестнице 1-2-5×10^k", () => {
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(99)).toBe(100);
    expect(niceMax(150)).toBe(200);
    expect(niceMax(500)).toBe(500);
    expect(niceMax(1501)).toBe(2000);
  });
});

describe("linePath — ломаная серии в SVG-координатах (y вниз)", () => {
  it("равномерно раскладывает точки по ширине", () => {
    expect(linePath([0, 5, 10], { w: 100, h: 40, maxY: 10 })).toBe("M0,40L50,20L100,0");
  });

  it("одна точка — горизонтальная линия во всю ширину", () => {
    expect(linePath([5], { w: 100, h: 40, maxY: 10 })).toBe("M0,20L100,20");
  });

  it("пустая серия — пустой путь", () => {
    expect(linePath([], { w: 100, h: 40, maxY: 10 })).toBe("");
  });
});

describe("barGeometry — столбики с зазором", () => {
  it("делит ширину на слоты, высота пропорциональна значению", () => {
    const bars = barGeometry([2, 0, 4], { w: 90, h: 40, maxY: 4 }, 1 / 3);
    expect(bars).toEqual([
      { x: 5, y: 20, w: 20, h: 20 },
      { x: 35, y: 40, w: 20, h: 0 },
      { x: 65, y: 0, w: 20, h: 40 },
    ]);
  });

  it("пустая серия — пусто", () => {
    expect(barGeometry([], { w: 90, h: 40, maxY: 1 }, 1 / 3)).toEqual([]);
  });
});

describe("xTickIndexes — подписи оси X без каши", () => {
  it("короткая серия подписывается целиком", () => {
    expect(xTickIndexes(7, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("длинная — равномерно, первый и последний обязательны", () => {
    const ticks = xTickIndexes(30, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(29);
    expect(ticks.length).toBeLessThanOrEqual(5 + 1);
  });

  it("вырожденные длины не ломаются", () => {
    expect(xTickIndexes(1, 5)).toEqual([0]);
    expect(xTickIndexes(0, 5)).toEqual([]);
  });
});
