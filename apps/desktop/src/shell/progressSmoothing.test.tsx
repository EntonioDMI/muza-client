import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Slider } from "@muza/ui";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Положение заливки в процентах: слайдер → дорожка → заливка.
 *  Заливка всегда во всю ширину и ездит transform'ом (см. Slider.jsx —
 *  процентная width защёлкивается по целым пикселям), поэтому позиция
 *  читается из translateX: -100% это 0 %, -10% это 90 %. */
function fillPct(): number {
  const fill = screen.getByRole("slider").firstElementChild?.firstElementChild as HTMLElement;
  const shift = /translateX\((-?[\d.]+)%\)/.exec(fill.style.transform);
  if (!shift) throw new Error(`заливка позиционируется не transform'ом: "${fill.style.transform}"`);
  return 100 + Number.parseFloat(shift[1]);
}

describe("Плавность прогресс-бара", () => {
  it("между обновлениями value дорисовывает позицию по стенным часам (rate > 0)", () => {
    vi.useFakeTimers();
    render(<Slider value={10} max={100} rate={1} ariaLabel="Прогресс" />);

    expect(fillPct()).toBeCloseTo(10, 1);
    vi.advanceTimersByTime(500);
    // полсекунды при скорости 1 ед/с — заливка ушла на 0.5 %, а не стояла
    expect(fillPct()).toBeCloseTo(10.5, 1);
  });

  it("свежий value сбрасывает якорь — накопленная ошибка не копится", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Slider value={10} max={100} rate={1} ariaLabel="Прогресс" />);
    vi.advanceTimersByTime(1000);
    expect(fillPct()).toBeCloseTo(11, 1);

    rerender(<Slider value={11} max={100} rate={1} ariaLabel="Прогресс" />);
    vi.advanceTimersByTime(500);
    expect(fillPct()).toBeCloseTo(11.5, 1);
  });

  it("на паузе и у обычных слайдеров (rate = 0) заливка стоит", () => {
    vi.useFakeTimers();
    render(<Slider value={40} max={100} ariaLabel="Громкость" />);

    expect(fillPct()).toBeCloseTo(40, 1);
    vi.advanceTimersByTime(2000);
    expect(fillPct()).toBeCloseTo(40, 1);
  });

  // Оба условия ниже проверены замером по реальным пикселям (19.07): процентная
  // width красится ступеньками по целому пикселю, а will-change выносит заливку
  // в слой композитора, который Chromium тоже защёлкивает по пикселям — 18
  // замеров из 25 без движения против 0 без него. В jsdom краски нет, поэтому
  // сторожим саму вёрстку.
  it("заливка ездит transform'ом и БЕЗ will-change — иначе краска идёт ступеньками", () => {
    render(<Slider value={30} max={100} rate={1} ariaLabel="Прогресс" />);
    const fill = screen.getByRole("slider").firstElementChild?.firstElementChild as HTMLElement;

    expect(fill.style.transform).toMatch(/^translateX\(-?[\d.]+%\)$/);
    expect(fillPct()).toBeCloseTo(30, 1);
    // заливка всегда во всю ширину — двигает её только transform
    expect(fill.style.width).toBe("100%");
    expect(fill.style.willChange).toBe("");
  });

  it("застрявший звук не уводит полоску в отрыв: экстраполяция ограничена", () => {
    vi.useFakeTimers();
    render(<Slider value={10} max={100} rate={1} ariaLabel="Прогресс" />);

    vi.advanceTimersByTime(10_000);
    // без предохранителя было бы 20 %, а потом рывок назад на приходе value
    expect(fillPct()).toBeLessThan(12);
  });
});
