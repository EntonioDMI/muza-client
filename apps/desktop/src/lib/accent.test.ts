import { describe, expect, it } from "vitest";
import { accentRoleVars, customAccentVars, textOnAccent } from "./accent";

/* Контраст-гард A1: светлый акцент не должен получать белый foreground
   («белое на белом» — жалоба владельца на кнопку Play). */

describe("textOnAccent", () => {
  it("тёмные цвета (пресеты ДС) → белый", () => {
    expect(textOnAccent("#3b82f6")).toBe("#ffffff"); // blue (дефолт)
    expect(textOnAccent("#327ad9")).toBe("#ffffff"); // bolt
    expect(textOnAccent("#121110")).toBe("#ffffff"); // почти чёрный
  });

  it("светлые цвета → тёмный (не белый)", () => {
    expect(textOnAccent("#ffffff")).toBe("#121110");
    expect(textOnAccent("#f3f1ed")).toBe("#121110"); // светлый off-white
    expect(textOnAccent("#ffe08a")).toBe("#121110"); // светло-жёлтый
  });
});

describe("вывод --text-on-accent в токены", () => {
  it("customAccentVars выводит text-on-accent по яркости", () => {
    expect(customAccentVars("#ffe08a")["--text-on-accent"]).toBe("#121110");
    expect(customAccentVars("#3b82f6")["--text-on-accent"]).toBe("#ffffff");
  });

  it("accentRoleVars выводит text-on-accent-play от цвета play-роли", () => {
    const light = accentRoleVars({ play: "#fff3b0", slider: "#3b82f6", active: "#3b82f6" });
    expect(light["--text-on-accent-play"]).toBe("#121110");
    const dark = accentRoleVars({ play: "#1d5fd4", slider: "#3b82f6", active: "#3b82f6" });
    expect(dark["--text-on-accent-play"]).toBe("#ffffff");
  });
});
