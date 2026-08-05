/** Панель массовых действий — плавающий слой (.muza-layer) с уходом.
 *
 *  Защищаются три вещи, каждая — по следам живой беды:
 *  1) центровка НЕ через transform: одно свойство на двоих, и кадр входа
 *     перебивал inline-центровку целиком — панель въезжала справа;
 *  2) уход вообще существует: узел переживает open=false и снимается по концу
 *     прозрачности, а не кадром;
 *  3) уходит последний ОТКРЫТЫЙ кадр: вызыватель к этому моменту уже обнулил
 *     выделение, и «Выбрано: 0» моргнуло бы на затухающей панели. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SelectionBar } from "./SelectionBar";

afterEach(cleanup);

/** transitionend руками: конструктора TransitionEvent в jsdom нет, а без
 *  propertyName слой не отличит конец ухода от любого другого перехода. */
const endTransition = (node: Element, propertyName: string) =>
  fireEvent(node, Object.assign(new Event("transitionend", { bubbles: true }), { propertyName }));

const bar = () => screen.queryByTestId("selection-bar");

function renderBar(open: boolean, label = "Выбрано: 3", actions = [{ icon: "plus", label: "В плейлист", onClick: vi.fn() }]) {
  const view = (o: boolean, l: string, a: typeof actions) => (
    <SelectionBar open={o} label={l} actions={a} onClear={() => undefined} clearLabel="Снять" />
  );
  const utils = render(view(open, label, actions));
  return {
    ...utils,
    set: (o: boolean, l = label, a = actions) => utils.rerender(view(o, l, a)),
  };
}

describe("панель выделения", () => {
  it("центрируется раскладкой — transform остаётся слою, а не центровке", () => {
    renderBar(true);
    const node = bar() as HTMLElement;
    // Инлайновый translateX(-50%) здесь был причиной въезда справа: анимация
    // входа писала в то же самое свойство и стирала центровку.
    expect(node.style.transform).toBe("");
    expect(node.style.left).toBe("0px");
    expect(node.style.right).toBe("0px");
    expect(node.style.margin).toContain("auto");
  });

  it("закрытие оставляет узел в дереве: закрытая поза, inert, клики насквозь", () => {
    const { set } = renderBar(true);
    const node = bar() as HTMLElement;
    set(false, "Выбрано: 0", []);

    expect(bar()).toBe(node); // тот же узел, а не новый
    expect(node.dataset.layerState).toBe("closed");
    expect(node.hasAttribute("inert")).toBe(true);
    expect(node.style.pointerEvents).toBe("none");
  });

  it("снимается по концу прозрачности, а не кадром", () => {
    const { set } = renderBar(true);
    const node = bar() as HTMLElement;
    set(false, "Выбрано: 0", []);

    endTransition(node, "transform");
    expect(bar()).toBe(node); // поза доехала, панель ещё гаснет
    endTransition(node, "opacity");
    expect(bar()).toBeNull();
  });

  it("на уходе показывает последний открытый кадр, а не обнулённое выделение", () => {
    const { set } = renderBar(true);
    set(false, "Выбрано: 0", []);

    expect(screen.getByText("Выбрано: 3")).toBeTruthy();
    expect(screen.queryByText("Выбрано: 0")).toBeNull();
    expect(screen.getByLabelText("В плейлист")).toBeTruthy();
  });

  it("без пропа open — старый контракт: панель видна сразу, вызыватель снимает её сам", () => {
    render(<SelectionBar label="Выбрано: 1" actions={[]} onClear={() => undefined} clearLabel="Снять" />);
    expect((bar() as HTMLElement).dataset.layerState).toBe("open");
  });
});
