import { describe, expect, it } from "vitest";
import { accentRoleVars, customAccentVars, textOnAccent } from "./accent";

/* Контраст-гард: светлый акцент не должен получать белый foreground
   («белое на белом» — жалоба владельца на кнопку Play).

   ⚠️ Порог поднят с 3 до 4.5 (аудит 03.08). Причина: на акценте лежит не только
   глиф кнопки, но и ПОДПИСЬ основной кнопки — 15px полужирный, а для обычного
   текста норма 4.5:1; 3:1 — норма для крупного текста и графики. Со старым
   порогом дефолтный синий #3b82f6 получал белую подпись при 3.68:1: гард
   формально проходил, читаемость — нет. Поэтому ожидания ниже перевёрнуты для
   средних синих: это не регрессия, а исправление. */

describe("textOnAccent", () => {
  it("достаточно тёмные цвета → белый", () => {
    expect(textOnAccent("#121110")).toBe("#ffffff"); // почти чёрный, 18.86:1
    expect(textOnAccent("#1d5fd4")).toBe("#ffffff"); // насыщенный синий, 5.77:1
    expect(textOnAccent("#2563eb")).toBe("#ffffff"); // синий на ступень темнее дефолта, 5.17:1
  });

  it("средние синие → тёмный: белый на них ниже нормы для подписи", () => {
    expect(textOnAccent("#3b82f6")).toBe("#121110"); // дефолтный синий, белый дал бы 3.68:1
    expect(textOnAccent("#347cdc")).toBe("#121110"); // bolt после правки токенов, белый дал бы 4.15:1
    expect(textOnAccent("#f76967")).toBe("#121110"); // логотипное пламя, белый дал бы 2.93:1
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
    expect(customAccentVars("#1d5fd4")["--text-on-accent"]).toBe("#ffffff");
  });

  it("accentRoleVars выводит text-on-accent-play от цвета play-роли", () => {
    const light = accentRoleVars({ play: "#fff3b0", slider: "#3b82f6", active: "#3b82f6" });
    expect(light["--text-on-accent-play"]).toBe("#121110");
    const dark = accentRoleVars({ play: "#1d5fd4", slider: "#3b82f6", active: "#3b82f6" });
    expect(dark["--text-on-accent-play"]).toBe("#ffffff");
  });
});
