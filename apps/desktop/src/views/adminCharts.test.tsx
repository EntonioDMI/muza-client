import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SeriesChart } from "./adminCharts";

// SVG-график серий для админки (кусок C): линия или столбики, статичный
// (никакого motion — reduced-motion уважается по построению), тултипы —
// нативные <title>. Цвета и типографика — токены ДС.

afterEach(cleanup);

const series = [
  { bucket: "2026-07-14", count: 2 },
  { bucket: "2026-07-15", count: 0 },
  { bucket: "2026-07-16", count: 5 },
];

describe("SeriesChart", () => {
  it("режим line: рисует path ломаной и точки с нативными тултипами", () => {
    const { container } = render(<SeriesChart points={series} mode="line" ariaLabel="посещения" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("посещения");
    const path = container.querySelector("path[data-line]");
    expect(path?.getAttribute("d")).toMatch(/^M/);
    expect(container.querySelectorAll("title").length).toBeGreaterThanOrEqual(3);
  });

  it("режим bars: столбик на каждую точку", () => {
    const { container } = render(<SeriesChart points={series} mode="bars" ariaLabel="ошибки" />);

    expect(container.querySelectorAll("rect[data-bar]").length).toBe(3);
  });

  it("пустая серия — заглушка без SVG-мусора", () => {
    const { container } = render(<SeriesChart points={[]} mode="line" ariaLabel="пусто" />);

    expect(container.querySelector("path[data-line]")).toBeNull();
  });

  it("подписи дат — короткие ДД.ММ", () => {
    const { container } = render(<SeriesChart points={series} mode="line" ariaLabel="посещения" />);

    expect(container.textContent).toContain("14.07");
    expect(container.textContent).toContain("16.07");
  });
});
