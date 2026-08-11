import { describe, expect, it } from "vitest";
import { FONT_CHOICES, fontFamily, probeFont, availableFonts } from "./fonts";

describe("FONT_CHOICES", () => {
  it("ключи уникальны", () => {
    const keys = FONT_CHOICES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("дефолты Prefs существуют в реестре: golos и unbounded", () => {
    expect(FONT_CHOICES.map((f) => f.key)).toEqual(expect.arrayContaining(["golos", "unbounded"]));
  });

  it("у каждого family есть запасной хвост — сломанный шрифт не падает в Times", () => {
    for (const f of FONT_CHOICES) expect(f.family, f.key).toContain("sans-serif");
  });
});

describe("fontFamily", () => {
  it("отдаёт family по ключу", () => {
    expect(fontFamily("inter")).toContain('"Inter"');
  });

  /** Дефолт — ПЕРВЫЙ элемент реестра, а не конкретное имя: с 11.08.2026 это
   *  Onest (был Golos Text). Проверяем именно «первый», чтобы следующая смена
   *  шрифта по умолчанию не роняла тест на ровном месте. */
  it("неизвестный ключ (тема из будущей версии) — шрифт по умолчанию, не крэш", () => {
    expect(fontFamily("из-будущего")).toBe(FONT_CHOICES[0].family);
    expect(fontFamily("из-будущего")).toContain("Onest");
  });
});

describe("probeFont", () => {
  it("ширины различаются → шрифт есть", () => {
    const measure = (font: string) => (font.includes("Arial") ? 120 : 100);
    expect(probeFont("Arial", measure)).toBe(true);
  });

  it("ширины совпали → шрифта нет (браузер взял запасной)", () => {
    expect(probeFont("НетТакого", () => 100)).toBe(false);
  });
});

describe("availableFonts", () => {
  it("в jsdom (канвас без measureText) — бандловые без системных, и это не крэш", () => {
    const fonts = availableFonts();
    const keys = fonts.map((f) => f.key);
    expect(keys).toContain("golos");
    expect(keys).toContain("system");
  });
});
