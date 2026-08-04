import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Tooltip } from "./Tooltip.jsx";

/** IconButton заворачивает в Tooltip каждую кнопку с label, поэтому подсказка —
 *  единственная видимая подпись у кнопок плеера. Пока она всплывала только по
 *  наведению мыши, для табуляции весь транспорт был безымянными кружками
 *  (аудит 02.08).
 *
 *  С 04.08 узел подсказки существует ТОЛЬКО пока она видна (и живёт порталом
 *  в theme-div, чтобы его не резали overflow по дороге) — поэтому тест
 *  проверяет появление/исчезновение узла, а не переключение aria-hidden. */

describe("Tooltip", () => {
  it("всплывает по фокусу, а не только по наведению мыши", () => {
    render(
      <Tooltip label="Дальше">
        <button type="button">▶</button>
      </Tooltip>,
    );

    // покой: узла подсказки нет вовсе — скрытая подсказка не стоит ничего
    expect(screen.queryByText("Дальше")).toBeNull();

    const btn = screen.getByRole("button");
    act(() => btn.focus());
    const tip = screen.getByText("Дальше");
    // пузырёк декоративен: у кнопки есть свой aria-label, дублировать нечего
    expect(tip.getAttribute("aria-hidden")).toBe("true");

    act(() => btn.blur());
    expect(screen.queryByText("Дальше")).toBeNull();
  });
});
