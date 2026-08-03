import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Shelf } from "./Shelf.jsx";

/** jsdom не считает раскладку: scrollWidth/clientWidth подставляем руками —
 *  иначе полка всегда «на упоре в обе стороны» и листать нечего. */
function scrollable(row, { scrollWidth = 1000, clientWidth = 300, scrollLeft = 0 } = {}) {
  Object.defineProperty(row, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(row, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(row, "scrollLeft", { value: scrollLeft, configurable: true, writable: true });
  fireEvent.scroll(row);
}

describe("Shelf", () => {
  it("на упоре стрелка выключена — невидимая кнопка не ловит Tab", () => {
    render(
      <Shelf title="Новое" prevLabel="Назад" nextLabel="Вперёд">
        <div data-testid="tile" />
      </Shelf>,
    );

    expect(screen.getByRole("button", { name: "Назад" }).disabled).toBe(true);
  });

  it("стрелка видна не только под мышью: фокус внутри полки её проявляет", () => {
    render(
      <Shelf title="Новое" prevLabel="Назад" nextLabel="Вперёд">
        <div data-testid="tile" />
      </Shelf>,
    );
    scrollable(screen.getByTestId("tile").parentElement);

    const next = screen.getByRole("button", { name: "Вперёд" });
    expect(next.disabled).toBe(false);
    const box = next.closest("div"); // ближайший div — слой стрелки, он и гаснет
    expect(box.style.opacity).toBe("0");

    act(() => next.focus());
    expect(box.style.opacity).toBe("1");
  });
});
