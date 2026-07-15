import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD, HOLD_MS, MOVE_SLOP, dist, insertionIndex, moveItem, shouldStart } from "./dragEngine";

/** Строки высотой 40 подряд от y=0: середины 20, 60, 100, 140, 180. */
const rows = (n: number, h = 40) => Array.from({ length: n }, (_, i) => ({ top: i * h, bottom: (i + 1) * h }));

describe("shouldStart: граница с drag-out наружу", () => {
  const base = { button: 0, altKey: false, ctrlKey: false, metaKey: false };
  it("левая кнопка без модификаторов — наш перенос", () => {
    expect(shouldStart(base)).toBe(true);
  });
  it("Alt отдан drag-out файла в ОС (lib/dragOut.ts) — не перехватываем", () => {
    expect(shouldStart({ ...base, altKey: true })).toBe(false);
  });
  it("правая/средняя кнопка — контекст-меню и автоскролл, не перенос", () => {
    expect(shouldStart({ ...base, button: 2 })).toBe(false);
    expect(shouldStart({ ...base, button: 1 })).toBe(false);
  });
  it("Ctrl/Cmd зарезервированы под выделение", () => {
    expect(shouldStart({ ...base, ctrlKey: true })).toBe(false);
    expect(shouldStart({ ...base, metaKey: true })).toBe(false);
  });
});

describe("пороги", () => {
  it("удержание заметно короче системного long-press, но длиннее клика", () => {
    expect(HOLD_MS).toBeGreaterThan(150);
    expect(HOLD_MS).toBeLessThan(400);
  });
  it("порог мгновенного старта строго больше slop — иначе дрожь руки поднимала бы карточку", () => {
    expect(DRAG_THRESHOLD).toBeGreaterThan(MOVE_SLOP);
  });
  it("dist — обычная евклидова", () => {
    expect(dist(0, 0, 3, 4)).toBe(5);
  });
});

describe("insertionIndex: куда встанет строка", () => {
  it("курсор над серединой первой — в начало", () => {
    expect(insertionIndex(rows(5), 2, 5)).toBe(0);
  });
  it("курсор под серединой последней — в конец", () => {
    expect(insertionIndex(rows(5), 0, 195)).toBe(4);
  });
  it("тащим вниз: индекс сдвигается на изъятие элемента", () => {
    // строка 0 тащится, курсор ниже середины строки 2 (mid=100) → to=3, минус изъятие = 2
    expect(insertionIndex(rows(5), 0, 105)).toBe(2);
  });
  it("тащим вверх: изъятие не влияет (to <= from)", () => {
    // строка 4 тащится, курсор ниже середины строки 1 (mid=60) → to=2
    expect(insertionIndex(rows(5), 4, 65)).toBe(2);
  });
  it("на своём месте — индекс не меняется (нет дёрганья)", () => {
    expect(insertionIndex(rows(5), 2, 105)).toBe(2);
  });
  it("считает по СЕРЕДИНАМ, а не по границам: чуть выше середины — остаёмся выше", () => {
    expect(insertionIndex(rows(5), 0, 99)).toBe(1); // to=1 (прошли mid строки 0), минус изъятие = 0? нет: 99>20,99>60 → to=2, -1 = 1
  });
  it("пустой список не роняет", () => {
    expect(insertionIndex([], 0, 50)).toBe(0);
  });
  it("не вылетает за границы", () => {
    expect(insertionIndex(rows(3), 0, 99999)).toBe(2);
    expect(insertionIndex(rows(3), 2, -99999)).toBe(0);
  });
});

describe("moveItem", () => {
  it("вниз", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
  it("вверх", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("на место — список не меняется", () => {
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });
  it("не мутирует исходный", () => {
    const src = ["a", "b", "c"];
    moveItem(src, 0, 2);
    expect(src).toEqual(["a", "b", "c"]);
  });
  it("битый индекс не роняет", () => {
    expect(moveItem(["a", "b"], 9, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });
  it("to за концом клэмпится", () => {
    expect(moveItem(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
  });
});
