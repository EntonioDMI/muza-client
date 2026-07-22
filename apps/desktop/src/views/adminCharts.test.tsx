import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SeriesChart } from "./adminCharts";

// SVG-график серий для админки: линия или столбики. 2026-07-21 нативные
// <title> заменены живым JS-ховером (направляющая + стеклянный тултип со
// значением/датой) — жалоба владельца «навожусь и не получаю информации».
// Цвета и типографика — токены ДС.

afterEach(cleanup);

const series = [
  { bucket: "2026-07-14", count: 2 },
  { bucket: "2026-07-15", count: 0 },
  { bucket: "2026-07-16", count: 5 },
];

describe("SeriesChart", () => {
  it("режим line: рисует path ломаной и точку на каждый день", () => {
    const { container } = render(<SeriesChart points={series} mode="line" ariaLabel="посещения" />);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("посещения");
    const path = container.querySelector("path[data-line]");
    expect(path?.getAttribute("d")).toMatch(/^M/);
    expect(container.querySelectorAll("circle").length).toBe(3);
  });

  it("ховер: тултип со значением и датой + вертикальная направляющая", () => {
    const { container } = render(<SeriesChart points={series} mode="line" ariaLabel="посещения" />);
    const wrap = container.firstElementChild as HTMLElement;
    // jsdom не меряет layout — даём контейнеру «ширину», как у живого экрана
    vi.spyOn(wrap, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 640, bottom: 150, width: 640, height: 150, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerMove(wrap, { clientX: 638 }); // правый край → последняя точка
    expect(container.textContent).toContain("5");
    expect(container.textContent).toContain("16.07");

    fireEvent.pointerLeave(wrap);
    expect(container.textContent).not.toContain("5 ");
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
