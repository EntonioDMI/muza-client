import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Select } from "./Select.jsx";

/** Панель списка появляется только ВТОРЫМ коммитом (после того, как
 *  useLayoutEffect посчитает panelPos) — та же гонка, что у Dialog/Menu. */

const items = [
  { key: "a", label: "Первый" },
  { key: "b", label: "Второй" },
  { key: "c", label: "Третий" },
];

describe("Select", () => {
  it("уводит фокус в выбранную опцию при открытии", () => {
    render(<Select items={items} value="b" ariaLabel="Список" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));

    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Второй" }));
  });

  it("стрелки ходят по опциям", () => {
    render(<Select items={items} value="b" ariaLabel="Список" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));

    fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Третий" }));

    fireEvent.keyDown(document.activeElement, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Первый" }));
  });

  it("Escape закрывает список и возвращает фокус на поле", () => {
    render(<Select items={items} value="b" ariaLabel="Список" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Список" });
    fireEvent.click(trigger);

    fireEvent.keyDown(document.activeElement, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Enter на опции выбирает её", () => {
    const onChange = vi.fn();
    render(<Select items={items} value="b" ariaLabel="Список" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));

    fireEvent.keyDown(document.activeElement, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("b");
  });
});
