import { afterEach, describe, expect, it } from "vitest";
import { installNativeMenuSuppressor, isTextField } from "./nativeContextMenu";

// Граница «где остаётся нативное меню»: текстовые поля — да (копировать/
// вставить/орфография), всё остальное — нет. Матрица по селектору.

afterEach(() => {
  document.body.innerHTML = "";
});

function el(html: string): Element {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  if (!node) throw new Error("пустая разметка");
  return node;
}

describe("isTextField — матрица селектора", () => {
  it("текстовые поля: остаются с нативным меню", () => {
    expect(isTextField(el("<input />"))).toBe(true);
    expect(isTextField(el('<input type="text" />'))).toBe(true);
    expect(isTextField(el('<input type="search" />'))).toBe(true);
    expect(isTextField(el('<input type="password" />'))).toBe(true);
    expect(isTextField(el("<textarea></textarea>"))).toBe(true);
    expect(isTextField(el('<div contenteditable="true"></div>'))).toBe(true);
  });

  it("вложенность: клик по ребёнку contenteditable — тоже текст", () => {
    const root = el('<div contenteditable="true"><b>жирное</b></div>');
    expect(isTextField(root.querySelector("b"))).toBe(true);
  });

  it("кнопочно-переключательные input и обычные элементы: меню давится", () => {
    expect(isTextField(el('<input type="button" />'))).toBe(false);
    expect(isTextField(el('<input type="checkbox" />'))).toBe(false);
    expect(isTextField(el('<input type="range" />'))).toBe(false);
    expect(isTextField(el('<input type="color" />'))).toBe(false);
    expect(isTextField(el("<div></div>"))).toBe(false);
    expect(isTextField(el("<button>x</button>"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe("installNativeMenuSuppressor", () => {
  it("гасит contextmenu вне текста, пропускает в тексте, снимается деинсталлятором", () => {
    const uninstall = installNativeMenuSuppressor(document);
    try {
      const div = el("<div></div>");
      const evDiv = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      div.dispatchEvent(evDiv);
      expect(evDiv.defaultPrevented).toBe(true);

      const input = el('<input type="text" />');
      const evInput = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      input.dispatchEvent(evInput);
      expect(evInput.defaultPrevented).toBe(false);
    } finally {
      uninstall();
    }
    const div2 = el("<div></div>");
    const evAfter = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    div2.dispatchEvent(evAfter);
    expect(evAfter.defaultPrevented).toBe(false);
  });
});
