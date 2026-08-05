import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Select } from "./Select.jsx";

/** Панель списка появляется только ВТОРЫМ коммитом (после того, как
 *  useLayoutEffect посчитает panelPos) — та же гонка, что у Dialog/Menu.
 *  А ИСЧЕЗАЕТ она не сразу: с 2026-08-05 у выпадашки есть уход
 *  (lib/useLayerState.js), и узел живёт до конца перехода. */

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
    vi.useFakeTimers();
    try {
      render(<Select items={items} value="b" ariaLabel="Список" onChange={() => {}} />);
      const trigger = screen.getByRole("button", { name: "Список" });
      fireEvent.click(trigger);

      fireEvent.keyDown(document.activeElement, { key: "Escape" });

      // Фокус возвращается СРАЗУ — ждать конца анимации ему нечего; панель в это
      // время гаснет и уже никого не ловит (inert).
      expect(document.activeElement).toBe(trigger);
      const panel = screen.getByRole("listbox");
      expect(panel.dataset.layerState).toBe("closed");
      expect(panel.hasAttribute("inert")).toBe(true);

      // transitionend в jsdom не приходит — узел снимает страховка хука.
      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByRole("listbox")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Enter на опции выбирает её", () => {
    const onChange = vi.fn();
    render(<Select items={items} value="b" ariaLabel="Список" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));

    fireEvent.keyDown(document.activeElement, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("b");
  });
});
