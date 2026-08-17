import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { CountUp } from "./CountUp.jsx";

/** Кадры под контролем: без этого тест зависел бы от настоящего таймера
 *  экрана и мигал бы на загруженной машине. */
let frames = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());

/** Прокрутить отсчёт на указанный момент времени. */
function frame(ms) {
  const cb = frames.shift();
  if (cb) act(() => cb(ms));
}

describe("счётчик", () => {
  it("первое значение показывается сразу, без отсчёта от нуля", () => {
    render(<CountUp value={1247} />);
    // Отсчитывать первое появление не от чего: у экрана не было прошлого
    // значения, и «поехали от нуля» — выдумка, а не изменение.
    expect(screen.getByText("1247")).toBeTruthy();
  });

  it("доезжает ровно до цели", () => {
    const { rerender } = render(<CountUp value={0} durationMs={100} />);
    rerender(<CountUp value={50} durationMs={100} />);
    frame(0);
    frame(1000); // время вышло с запасом
    expect(screen.getByText("50")).toBeTruthy();
  });

  it("на середине пути показывает промежуточное целое, а не дробь", () => {
    const { rerender } = render(<CountUp value={0} durationMs={100} />);
    rerender(<CountUp value={100} durationMs={100} />);
    frame(0);
    frame(50);
    const shown = Number(screen.getByText(/^\d+$/).textContent);
    expect(Number.isInteger(shown)).toBe(true);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(100);
  });

  it("prefers-reduced-motion — значение ставится сразу, кадров не заказываем", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { rerender } = render(<CountUp value={0} durationMs={1000} />);
    frames.length = 0;
    rerender(<CountUp value={999} durationMs={1000} />);
    expect(screen.getByText("999")).toBeTruthy();
    expect(frames.length).toBe(0);
  });

  it("формат применяется к округлённому числу", () => {
    render(<CountUp value={4217} format={(n) => `${n} треков`} />);
    expect(screen.getByText("4217 треков")).toBeTruthy();
  });
});
