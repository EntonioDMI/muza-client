import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD,
  HOLD_MS,
  clampShift,
  dist,
  gridInsertionIndex,
  insertionIndex,
  moveItem,
  reorderOffset,
  reorderShift,
  shouldStart,
  unionBox,
} from "./dragEngine";

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
  /** Порог ОДИН, и это не вкусовщина. Пока их было два (slop отменял жест,
   *  порог поднимал), полоса между ними съедала любой перенос живой мышью:
   *  pointermove идёт каждые ~8-16мс, и дистанция от точки нажатия проходит все
   *  промежуточные значения. Прежний инвариант «DRAG_THRESHOLD > MOVE_SLOP»
   *  требовал эту полосу — то есть закреплял дефект. Второй порог не возвращать. */
  it("порог подъёма в пределах системного slop: тянут сразу, а дрожь не поднимает", () => {
    expect(DRAG_THRESHOLD).toBeGreaterThanOrEqual(4); // Windows SM_CXDRAG
    expect(DRAG_THRESHOLD).toBeLessThanOrEqual(10);
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

describe("reorderShift: соседи разъезжаются, тащимая едет в слот", () => {
  // 4 строки по 40: [0-40] [40-80] [80-120] [120-160]
  const r = rows(4);

  it("тащим 0 вниз в 2: строки 1 и 2 поднимаются на её высоту", () => {
    expect(reorderShift(r, 0, 2, 1)).toBe(-40);
    expect(reorderShift(r, 0, 2, 2)).toBe(-40);
  });

  it("тащим 0 вниз в 2: сама встаёт туда, где кончалась строка 2, минус своя высота", () => {
    // порядок станет [1,2,0]: слоты 0/40/80, у строки 0 новый top = 80, старый = 0
    expect(reorderShift(r, 0, 2, 0)).toBe(80);
  });

  it("тащим 3 вверх в 1: строки 1 и 2 опускаются", () => {
    expect(reorderShift(r, 3, 1, 1)).toBe(40);
    expect(reorderShift(r, 3, 1, 2)).toBe(40);
  });

  it("тащим 3 вверх в 1: сама встаёт на top строки 1", () => {
    // порядок станет [0,3,1,2]: у 3 новый top = 40, старый = 120
    expect(reorderShift(r, 3, 1, 3)).toBe(-80);
  });

  it("строки вне отрезка from..to не двигаются", () => {
    expect(reorderShift(r, 1, 2, 0)).toBe(0);
    expect(reorderShift(r, 1, 2, 3)).toBe(0);
  });

  it("to === from — нулевой сдвиг у всех (иначе список дрожал бы на месте)", () => {
    for (let i = 0; i < 4; i++) expect(reorderShift(r, 2, 2, i)).toBe(0);
  });

  it("нет переноса (from/to = -1) — нули", () => {
    expect(reorderShift(r, -1, 2, 0)).toBe(0);
    expect(reorderShift(r, 0, -1, 1)).toBe(0);
  });

  it("едет только высота ТАЩИМОЙ строки, даже если соседи разной высоты", () => {
    // 0:[0-40] 1:[40-140] (высокая) 2:[140-180]
    const mixed = [
      { top: 0, bottom: 40 },
      { top: 40, bottom: 140 },
      { top: 140, bottom: 180 },
    ];
    // тащим 0 (h=40) вниз в 1 — высокий сосед едет на 40, а не на себя
    expect(reorderShift(mixed, 0, 1, 1)).toBe(-40);
    // сама: новый top = 140 - 40 = 100
    expect(reorderShift(mixed, 0, 1, 0)).toBe(100);
  });

  it("битые индексы не роняют", () => {
    expect(reorderShift(r, 9, 0, 0)).toBe(0);
    expect(reorderShift(r, 0, 9, 0)).toBe(0);
    expect(reorderShift([], 0, 1, 0)).toBe(0);
  });
});

/** Сетка 2×2 плиток 100×100 с гэпом 10: центры (50,50) (160,50) (50,160) (160,160). */
const grid22 = [
  { top: 0, left: 0, right: 100, bottom: 100 },
  { top: 0, left: 110, right: 210, bottom: 100 },
  { top: 110, left: 0, right: 100, bottom: 210 },
  { top: 110, left: 110, right: 210, bottom: 210 },
];

describe("gridInsertionIndex: слот сетки по ближайшему центру", () => {
  it("курсор в ячейке — её индекс (splice-семантика: без поправок на from)", () => {
    expect(gridInsertionIndex(grid22, 50, 50)).toBe(0);
    expect(gridInsertionIndex(grid22, 160, 50)).toBe(1);
    expect(gridInsertionIndex(grid22, 60, 170)).toBe(2);
    expect(gridInsertionIndex(grid22, 200, 200)).toBe(3);
  });

  it("курсор за пределами сетки — ближайшая крайняя ячейка (кламп смыслом)", () => {
    expect(gridInsertionIndex(grid22, -50, -50)).toBe(0);
    expect(gridInsertionIndex(grid22, 500, 500)).toBe(3);
  });

  it("moveItem с этим индексом ставит плитку в конец без спец-случая «после последней»", () => {
    // тащим 0 на место 3: ближайший центр 3 → splice(3) → [B,C,D,A]
    const to = gridInsertionIndex(grid22, 160, 160);
    expect(moveItem(["A", "B", "C", "D"], 0, to)).toEqual(["B", "C", "D", "A"]);
  });
});

describe("reorderOffset: соседи съезжают на прямоугольник будущей позиции (2D)", () => {
  it("тащим 0 → 3: все прочие сдвигаются на одну позицию назад", () => {
    // 1 едет на место 0 (влево), 2 — на место 1 (вправо-вверх), 3 — на место 2 (влево-вниз)
    expect(reorderOffset(grid22, 0, 3, 1)).toEqual({ x: -110, y: 0 });
    expect(reorderOffset(grid22, 0, 3, 2)).toEqual({ x: 110, y: -110 });
    expect(reorderOffset(grid22, 0, 3, 3)).toEqual({ x: -110, y: 0 });
  });

  it("тащим 3 → 0: все прочие сдвигаются вперёд", () => {
    expect(reorderOffset(grid22, 3, 0, 0)).toEqual({ x: 110, y: 0 });
    expect(reorderOffset(grid22, 3, 0, 1)).toEqual({ x: -110, y: 110 });
    expect(reorderOffset(grid22, 3, 0, 2)).toEqual({ x: 110, y: 0 });
  });

  it("вне диапазона from..to — нули; сам тащимый — нуль (им правит курсор)", () => {
    expect(reorderOffset(grid22, 1, 2, 0)).toEqual({ x: 0, y: 0 });
    expect(reorderOffset(grid22, 1, 2, 3)).toEqual({ x: 0, y: 0 });
    expect(reorderOffset(grid22, 1, 2, 1)).toEqual({ x: 0, y: 0 });
    expect(reorderOffset(grid22, 2, 2, 3)).toEqual({ x: 0, y: 0 });
  });

  it("в столбце (сайдбар) вырождается в вертикальный сдвиг", () => {
    const col = rows(3).map((r) => ({ ...r, left: 0, right: 200 }));
    expect(reorderOffset(col, 0, 2, 1)).toEqual({ x: 0, y: -40 });
    expect(reorderOffset(col, 2, 0, 1)).toEqual({ x: 0, y: 40 });
  });
});

describe("clampShift/unionBox: плашка не выходит за габарит области", () => {
  it("дельта внутри области проходит как есть, наружу — обрезается", () => {
    const bounds = unionBox(grid22);
    expect(bounds).toEqual({ top: 0, left: 0, right: 210, bottom: 210 });
    // плитка 0 (0..100): вниз на 500 — упрётся в 110 (210-100); влево — в 0
    expect(clampShift(grid22[0], bounds, 30, 500)).toEqual({ x: 30, y: 110 });
    expect(clampShift(grid22[0], bounds, -50, -50)).toEqual({ x: 0, y: 0 });
  });
});
