import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs.jsx";
import { ChipGroup } from "./ChipGroup.jsx";

/** ЗАЧЕМ. У таб-бара и ряда чипов подсветка стоила дороже, чем у списка: hoverKey
 *  жил на ВСЮ группу, и наведение на один сегмент перерисовывало все остальные —
 *  вместе с эффектами замера пилюли, которые висят на том же компоненте. Здесь
 *  проверяется, что группа больше не реагирует на курсор ничем. */

const items = [
  { key: "a", label: "Первая" },
  { key: "b", label: "Вторая" },
  { key: "c", label: "Третья" },
];

describe("Tabs: наведение не трогает группу", () => {
  it("сегмент подключён к каналу; выбранный держит фон прозрачным под пилюлю", () => {
    const { container } = render(<Tabs items={items} value="a" onChange={() => {}} />);
    const [first, second] = [...container.querySelectorAll('[role="tab"]')];
    expect(first.className).toContain("muza-tab");
    expect(first.style.background).toBe("transparent"); // выбран — красит пилюля
    expect(second.style.background).toBe("var(--tab-bg)");
  });

  it("проход курсора по сегментам не меняет разметку группы", () => {
    const { container } = render(<Tabs items={items} value="a" onChange={() => {}} />);
    const html = container.innerHTML;
    for (const el of container.querySelectorAll('[role="tab"]')) {
      fireEvent.mouseEnter(el);
      fireEvent.mouseLeave(el);
    }
    expect(container.innerHTML).toBe(html);
  });

  it("клик по сегменту по-прежнему переключает", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByText("Вторая"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("ChipGroup: наведение не трогает ряд", () => {
  it("чип подключён к каналам фона и подписи", () => {
    const { container } = render(<ChipGroup items={items} value="a" onChange={() => {}} />);
    const [first, second] = [...container.querySelectorAll('[role="tab"]')];
    expect(first.className).toContain("muza-chip");
    expect(first.style.background).toBe("transparent");
    expect(first.style.color).toBe("var(--text-1)");
    expect(second.style.background).toBe("var(--chip-bg)");
    expect(second.style.color).toBe("var(--chip-fg)");
  });

  it("расширение зоны попадания осталось на месте", () => {
    // .muza-hit — невидимое расширение до --hit-min; канал подсветки его не
    // вытеснил, оба класса живут на одной кнопке.
    const { container } = render(<ChipGroup items={items} value="a" onChange={() => {}} />);
    expect(container.querySelector('[role="tab"]').className.split(" ")).toEqual(
      expect.arrayContaining(["muza-hit", "muza-chip"]),
    );
  });

  it("проход курсора по чипам не меняет разметку ряда", () => {
    const { container } = render(<ChipGroup items={items} value="a" onChange={() => {}} />);
    const html = container.innerHTML;
    for (const el of container.querySelectorAll('[role="tab"]')) {
      fireEvent.mouseEnter(el);
      fireEvent.mouseLeave(el);
    }
    expect(container.innerHTML).toBe(html);
  });
});
