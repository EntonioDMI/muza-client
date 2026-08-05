import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Panel } from "./Panel.jsx";

/** Panel сводит воедино то, что Статистика и Админка рисовали инлайном:
 *  заголовок раздела, место под действие справа и содержимое на карточке. */

describe("Panel", () => {
  it("заголовок — h2, содержимое внутри секции", () => {
    render(
      <Panel title="Слушатели">
        <span>содержимое</span>
      </Panel>,
    );

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Слушатели");
    expect(screen.getByText("содержимое")).toBeTruthy();
  });

  it("action живёт в шапке, а не над содержимым", () => {
    render(
      <Panel title="Темы" action={<button type="button">Показать все</button>}>
        <span>строки</span>
      </Panel>,
    );

    const head = screen.getByRole("heading", { level: 2 }).parentElement;
    expect(head.contains(screen.getByRole("button", { name: "Показать все" }))).toBe(true);
  });

  it("без заголовка и действия шапки нет вовсе", () => {
    render(
      <Panel>
        <span>голое содержимое</span>
      </Panel>,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("голое содержимое")).toBeTruthy();
  });
});
