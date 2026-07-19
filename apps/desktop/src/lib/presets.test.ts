import { describe, expect, it } from "vitest";
import { matchPreset, PRESETS_BG } from "./presets";
import { DEFAULT_PREFS } from "../types";

/** Тестируем на СУЩЕСТВУЮЩИХ ключах Prefs — matchPreset универсален,
 *  конкретные наборы пресетов добавляют волны 3а-3д рядом со своей зоной. */
const PRESETS = {
  calm: { bgDim: 60, blurScenery: 80 },
  lively: { bgDim: 40, blurScenery: 64 },
};

describe("matchPreset", () => {
  it("находит пресет, когда ВСЕ его ключи совпали", () => {
    const prefs = { ...DEFAULT_PREFS, bgDim: 60, blurScenery: 80 };
    expect(matchPreset(PRESETS, prefs)).toBe("calm");
  });

  it("дефолты совпадают с пресетом lively (bgDim 40, blurScenery 64)", () => {
    expect(matchPreset(PRESETS, DEFAULT_PREFS)).toBe("lively");
  });

  it("любое отклонение хотя бы одного ключа — custom", () => {
    const prefs = { ...DEFAULT_PREFS, bgDim: 60, blurScenery: 81 };
    expect(matchPreset(PRESETS, prefs)).toBe("custom");
  });

  it("первый совпавший из нескольких выигрывает (порядок объекта)", () => {
    const overlapping = {
      a: { bgDim: 40 },
      b: { bgDim: 40, blurScenery: 64 },
    };
    expect(matchPreset(overlapping, DEFAULT_PREFS)).toBe("a");
  });

  it("сравнение объектных значений — по содержимому, не по ссылке", () => {
    const withObj = { visible: { rowShow: { cover: true, duration: true } } };
    expect(matchPreset(withObj, DEFAULT_PREFS)).toBe("visible");
  });
});

describe("PRESETS_BG", () => {
  it("«Живо» равен дефолтам: после обновления пользователь видит прежний фон", () => {
    expect(matchPreset(PRESETS_BG, DEFAULT_PREFS)).toBe("lively");
  });

  it("наборы различимы: спокойный и яркий не совпадают с дефолтами", () => {
    expect(matchPreset({ calm: PRESETS_BG.calm }, DEFAULT_PREFS)).toBe("custom");
    expect(matchPreset({ bright: PRESETS_BG.bright }, DEFAULT_PREFS)).toBe("custom");
  });
});
