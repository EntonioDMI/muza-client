/** Уменьшенное движение сильнее настройки — то же правило, что у
 *  полноэкранного режима и визуализатора. Проверяем именно приоритет:
 *  человек мог не знать про настройку в Музе, но системную просьбу он
 *  выставлял осознанно. */
import { afterEach, describe, expect, it } from "vitest";
import { shouldAnimateStage } from "./authWindowStage";

const realMatchMedia = window.matchMedia;

function stubReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("shouldAnimateStage", () => {
  it("анимации включены и система не против — разворачиваем плавно", () => {
    stubReducedMotion(false);
    expect(shouldAnimateStage(true)).toBe(true);
  });

  it("система просит меньше движения — настройка не спасает", () => {
    stubReducedMotion(true);
    expect(shouldAnimateStage(true)).toBe(false);
  });

  it("анимации выключены в Музе — систему даже не спрашиваем", () => {
    stubReducedMotion(false);
    expect(shouldAnimateStage(false)).toBe(false);
  });

  it("matchMedia недоступен — не отказываемся от анимации молча", () => {
    // jsdom без заглушки и старые вебвью: отсутствие способа спросить не
    // означает «человек просил без движения». Ошибаться лучше в сторону
    // задуманного поведения, тем более что настройка в Музе уже сказала «да».
    window.matchMedia = undefined as never;
    expect(shouldAnimateStage(true)).toBe(true);
  });
});
