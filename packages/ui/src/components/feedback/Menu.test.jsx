import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Menu } from "./Menu.jsx";

/** Открываем ПЕРЕКЛЮЧЕНИЕМ ПРОПА, а не первым рендером: провайдер
 *  контекстного меню держит один <Menu open={…}> на всё приложение, поэтому
 *  меню всегда монтируется закрытым (см. шапку Dialog.test.jsx про гонку). */

const items = [
  { label: "Играть", onClick: () => {} },
  { label: "В очередь", onClick: () => {} },
  { label: "Недоступно", disabled: true },
];

function Harness({ open }) {
  return <Menu open={open} x={10} y={10} items={items} onClose={() => {}} />;
}

describe("Menu", () => {
  it("уводит фокус в первый пункт при открытии", () => {
    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Играть" }));
  });

  it("стрелка вниз ходит по пунктам, перепрыгивая выключенные", () => {
    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);

    fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "В очередь" }));

    // третий пункт disabled — цикл возвращается к первому
    fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Играть" }));
  });

  it("End уводит фокус в последний доступный пункт", () => {
    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);

    fireEvent.keyDown(document.activeElement, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "В очередь" }));
  });
});
