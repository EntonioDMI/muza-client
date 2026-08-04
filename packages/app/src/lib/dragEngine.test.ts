import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD,
  HOLD_MS,
  clampShift,
  cursorInsertionIndex,
  dist,
  gridInsertionIndex,
  insertionIndex,
  moveItem,
  pickByOrder,
  reorderShift,
  shouldStart,
  unionBox,
} from "./dragEngine";

/** Строки высотой 40 подряд от y=0: середины 20, 60, 100, 140, 180. */
const rows = (n: number, h = 40) => Array.from({ length: n }, (_, i) => ({ top: i * h, bottom: (i + 1) * h }));

describe("shouldStart: граница с drag-out наружу", () => {
  const base = { button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
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
  it("Shift — диапазон выделения, не перенос (2026-07-20: раньше Shift жил только в комментарии)", () => {
    expect(shouldStart({ ...base, shiftKey: true })).toBe(false);
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

describe("cursorInsertionIndex: прицел курсором (механика DragLayer)", () => {
  // Точка отсчёта — КУРСОР с плавающей карточкой, снимок статичен весь жест.
  it("курсор ниже середины строки — встаём после неё (с поправкой на изъятие)", () => {
    expect(cursorInsertionIndex(rows(5), 0, 105)).toBe(2);
  });
  it("курсор над серединой первой — в начало; под серединой последней — в конец", () => {
    expect(cursorInsertionIndex(rows(5), 2, 5)).toBe(0);
    expect(cursorInsertionIndex(rows(5), 0, 195)).toBe(4);
  });
  it("в своей полосе — на месте (бросок в свой слот не ходит на сервер)", () => {
    expect(cursorInsertionIndex(rows(3), 1, 25)).toBe(1);
  });
  it("пустой список и вылет за границы не роняют", () => {
    expect(cursorInsertionIndex([], 0, 50)).toBe(0);
    expect(cursorInsertionIndex(rows(3), 0, 99999)).toBe(2);
  });
});

describe("insertionIndex: куда встанет строка (ТОЧКА ЗАХВАТА + гистерезис)", () => {
  // y — точка захвата (курсор): «только когда захваченное место пересекает
  // границу, объект должен туда переходить» (владелец 04.08). Порог — середина
  // СОСЕДА ± гистерезис 8. Ряды по 40: середины 20/60/100/140/180.
  it("утащили точку захвата в самый верх — в начало", () => {
    expect(insertionIndex(rows(5), 2, 5)).toBe(0);
  });
  it("в самый низ — в конец", () => {
    expect(insertionIndex(rows(5), 0, 195)).toBe(4);
  });
  it("вниз: точка прошла середину соседа с запасом — встали за ним", () => {
    // строка 0, точка 105 > mid(1)+8=68, но < mid(2)+8=108 → 1
    expect(insertionIndex(rows(5), 0, 105)).toBe(1);
  });
  it("вверх: то же правило серединами верхних соседей", () => {
    // строка 4, точка 65 < mid(3)−8=132 и < mid(2)−8=92, но НЕ < mid(1)−8=52 → 2
    expect(insertionIndex(rows(5), 4, 65)).toBe(2);
  });
  it("на своём месте — индекс не меняется (нет дёрганья)", () => {
    expect(insertionIndex(rows(5), 2, 105)).toBe(2);
  });
  it("ГИСТЕРЕЗИС: коснулись середины соседа, но не прошли на запас — стоим", () => {
    // строка 1, сосед снизу mid(2)=100: порог 108. 107 — стоим, 109 — обмен.
    expect(insertionIndex(rows(5), 1, 107)).toBe(1);
    expect(insertionIndex(rows(5), 1, 109)).toBe(2);
  });
  it("СТАБИЛЬНОСТЬ: после обмена та же точка захвата не требует обратного хода", () => {
    // Высокая секция (200) над короткой строкой (40) — случай «Для тебя».
    // Захватили секцию у низа: точка 229 > mid(соседа)+8=228 → обмен.
    const mixed = [
      { top: 0, bottom: 200 },
      { top: 200, bottom: 240 },
    ];
    expect(insertionIndex(mixed, 0, 229)).toBe(1);
    // После обмена сосед сверху: [0..40], секция [40..240]. Та же точка 229
    // НЕ выше mid(соседа)−8=12 → стоим. Осцилляции нет.
    const after = [
      { top: 0, bottom: 40 },
      { top: 40, bottom: 240 },
    ];
    expect(insertionIndex(after, 1, 229)).toBe(1);
  });
  it("решает РУКА, а не габарит: большая секция уводится через середины соседей", () => {
    const tallFirst = [
      { top: 0, bottom: 200 },
      { top: 200, bottom: 240 },
      { top: 240, bottom: 280 },
      { top: 280, bottom: 320 },
    ];
    // точка захвата 310 > 228, > 268, > 308 → в самый конец, без проноса
    // центра секции за весь список
    expect(insertionIndex(tallFirst, 0, 310)).toBe(3);
  });
  it("пустой список и битый from не роняют", () => {
    expect(insertionIndex([], 0, 50)).toBe(0);
    expect(insertionIndex(rows(3), 9, 50)).toBe(2);
    expect(insertionIndex(rows(3), -1, 50)).toBe(0);
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

describe("gridInsertionIndex: вход в чужую ячейку, а не ближайший центр (04.08)", () => {
  it("центр плашки вошёл в чужую ячейку — её индекс (splice без поправок на from)", () => {
    expect(gridInsertionIndex(grid22, 3, 50, 50)).toBe(0);
    expect(gridInsertionIndex(grid22, 0, 160, 50)).toBe(1);
    expect(gridInsertionIndex(grid22, 0, 60, 170)).toBe(2);
    expect(gridInsertionIndex(grid22, 0, 200, 200)).toBe(3);
  });

  it("СВОЯ ячейка и зазор между ячейками — стоим на месте (раньше тут дёргалось)", () => {
    // ближайший центр «на месте не стоял»: он есть всегда, и на разных
    // размерах ячеек прыгал туда-обратно после каждой перестановки
    expect(gridInsertionIndex(grid22, 0, 50, 50)).toBe(0); // своя
    expect(gridInsertionIndex(grid22, 0, 105, 50)).toBe(0); // зазор колонок
    expect(gridInsertionIndex(grid22, 0, 50, 105)).toBe(0); // зазор рядов
  });

  it("ГИСТЕРЕЗИС: кромка чужой ячейки входом не считается", () => {
    // ячейка 1 начинается на x=110; вход засчитывается с 110+8
    expect(gridInsertionIndex(grid22, 0, 115, 50)).toBe(0);
    expect(gridInsertionIndex(grid22, 0, 119, 50)).toBe(1);
  });

  it("за пределами сетки — стоим: «ничего не делать» безопаснее догадки", () => {
    expect(gridInsertionIndex(grid22, 1, -50, -50)).toBe(1);
    expect(gridInsertionIndex(grid22, 1, 500, 500)).toBe(1);
  });

  it("moveItem с этим индексом ставит плитку в конец без спец-случая «после последней»", () => {
    // тащим 0, центр вошёл в ячейку 3 → splice(3) → [B,C,D,A]
    const to = gridInsertionIndex(grid22, 0, 160, 160);
    expect(moveItem(["A", "B", "C", "D"], 0, to)).toEqual(["B", "C", "D", "A"]);
  });
});

describe("clampShift/unionBox: край области упругий, а не глухой", () => {
  /** Плитка 0 занимает 0..100, область — 0..210, значит вниз ей есть куда
   *  ехать ровно 110px. Дальше начинается сопротивление. */
  const LIMIT_Y = 110;
  const BUDGET = 24;

  it("дельта внутри области идёт один в один за курсором", () => {
    const bounds = unionBox(grid22);
    expect(bounds).toEqual({ top: 0, left: 0, right: 210, bottom: 210 });
    expect(clampShift(grid22[0], bounds, 30, 50)).toEqual({ x: 30, y: 50 });
  });

  it("за краем плашка ещё идёт, но заметно отстаёт от курсора", () => {
    const bounds = unionBox(grid22);
    const near = clampShift(grid22[0], bounds, 30, 200).y;
    const far = clampShift(grid22[0], bounds, 30, 500).y;

    // жёсткого стопа нет — рука едет, плашка отвечает
    expect(near).toBeGreaterThan(LIMIT_Y);
    // дальше тянешь — дальше уходит, порядок сохраняется
    expect(far).toBeGreaterThan(near);
    // но отклик затухает: 390px курсора дают заметно меньше 390px плашки
    expect(far - LIMIT_Y).toBeLessThan(500 - 200);
  });

  it("сколько ни тяни, за бюджет упругости не выходит", () => {
    const bounds = unionBox(grid22);
    const absurd = clampShift(grid22[0], bounds, 30, 100_000).y;
    expect(absurd - LIMIT_Y).toBeLessThanOrEqual(BUDGET);
  });

  it("сопротивление одинаково по обеим осям и в обе стороны", () => {
    const bounds = unionBox(grid22);
    const { x, y } = clampShift(grid22[0], bounds, -50, -50);
    expect(x).toBeLessThan(0); // ушла за верхний/левый край, но недалеко
    expect(x).toBeGreaterThan(-BUDGET);
    expect(y).toBeCloseTo(x, 5);
  });
});

describe("pickByOrder: живой порядок жеста накладывается на объекты", () => {
  const items = [{ k: "a" }, { k: "b" }, { k: "c" }];
  const key = (i: { k: string }) => i.k;

  it("раскладывает по названному порядку", () => {
    expect(pickByOrder(items, key, ["c", "a", "b"]).map(key)).toEqual(["c", "a", "b"]);
  });

  it("ключ без пары пропускается — список мог смениться под жестом", () => {
    expect(pickByOrder(items, key, ["c", "ghost", "a", "b"]).map(key)).toEqual(["c", "a", "b"]);
  });

  it("НЕ ТЕРЯЕТ элемент, которого не назвали: молча пропасть он не может", () => {
    expect(pickByOrder(items, key, ["c"]).map(key)).toEqual(["c", "a", "b"]);
    expect(pickByOrder(items, key, []).map(key)).toEqual(["a", "b", "c"]);
  });

  it("повтор ключа не дублирует элемент", () => {
    expect(pickByOrder(items, key, ["a", "a", "b", "c"]).map(key)).toEqual(["a", "b", "c"]);
  });
});
