import { describe, expect, it } from "vitest";
import { EMPTY, click, enterMode, isSelected, prune, selectAll } from "./selection";

// Математика множественного выделения (2026-07-20): ctrl/shift/якорь/режим/
// prune. Порядок id приходит от списка-хозяина.

const order = ["a", "b", "c", "d", "e"];

describe("selection.click", () => {
  it("обычный клик без режима — не наш жест (null): список играет трек", () => {
    expect(click(EMPTY, order, "b", { ctrl: false, shift: false })).toBeNull();
  });

  it("Ctrl+клик выделяет и ставит якорь; повторный — снимает", () => {
    const s1 = click(EMPTY, order, "b", { ctrl: true, shift: false });
    expect(s1?.ids).toEqual(["b"]);
    expect(s1?.anchor).toBe("b");
    const s2 = click(s1!, order, "b", { ctrl: true, shift: false });
    expect(s2?.ids).toEqual([]);
  });

  it("Shift+клик — диапазон от якоря в обе стороны, границы включительно", () => {
    const s1 = click(EMPTY, order, "d", { ctrl: true, shift: false })!;
    expect(click(s1, order, "b", { ctrl: false, shift: true })?.ids).toEqual(["b", "c", "d"]);
    expect(click(s1, order, "e", { ctrl: false, shift: true })?.ids).toEqual(["d", "e"]);
  });

  it("Shift без якоря — диапазон от начала списка", () => {
    expect(click(EMPTY, order, "c", { ctrl: false, shift: true })?.ids).toEqual(["a", "b", "c"]);
  });

  it("последовательные Shift-клики переигрывают диапазон от ТОГО ЖЕ якоря", () => {
    const s1 = click(EMPTY, order, "c", { ctrl: true, shift: false })!;
    const s2 = click(s1, order, "e", { ctrl: false, shift: true })!;
    expect(s2.ids).toEqual(["c", "d", "e"]);
    const s3 = click(s2, order, "a", { ctrl: false, shift: true })!;
    expect(s3.ids).toEqual(["a", "b", "c"]);
  });

  it("в режиме обычный клик выделяет (как Ctrl)", () => {
    const s = enterMode(EMPTY);
    const s1 = click(s, order, "a", { ctrl: false, shift: false });
    expect(s1?.ids).toEqual(["a"]);
    expect(s1?.mode).toBe(true);
  });
});

describe("selection: selectAll / prune / isSelected", () => {
  it("selectAll берёт весь порядок и сохраняет режим", () => {
    const s = selectAll(enterMode(EMPTY), order);
    expect(s.ids).toEqual(order);
    expect(s.mode).toBe(true);
  });

  it("prune выкидывает исчезнувшие id и мёртвый якорь", () => {
    const s = { ids: ["a", "b", "x"], anchor: "x", mode: false };
    const p = prune(s, order);
    expect(p.ids).toEqual(["a", "b"]);
    expect(p.anchor).toBeNull();
  });

  it("prune без потерь возвращает ТОТ ЖЕ объект — лишний setState не будит рендер", () => {
    const s = { ids: ["a", "b"], anchor: "a", mode: false };
    expect(prune(s, order)).toBe(s);
  });

  it("isSelected", () => {
    expect(isSelected({ ids: ["a"], anchor: null, mode: false }, "a")).toBe(true);
    expect(isSelected(EMPTY, "a")).toBe(false);
  });
});
