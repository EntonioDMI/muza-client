import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Tooltip } from "./Tooltip.jsx";

/** IconButton заворачивает в Tooltip каждую кнопку с label, поэтому подсказка —
 *  единственная видимая подпись у кнопок плеера. Пока она всплывала только по
 *  наведению мыши, для табуляции весь транспорт был безымянными кружками
 *  (аудит 02.08). */

describe("Tooltip", () => {
  it("всплывает по фокусу, а не только по наведению мыши", () => {
    render(
      <Tooltip label="Дальше">
        <button type="button">▶</button>
      </Tooltip>,
    );

    const tip = screen.getByText("Дальше");
    expect(tip.getAttribute("aria-hidden")).toBe("true");

    const btn = screen.getByRole("button");
    act(() => btn.focus());
    expect(tip.getAttribute("aria-hidden")).toBe("false");

    act(() => btn.blur());
    expect(tip.getAttribute("aria-hidden")).toBe("true");
  });
});
