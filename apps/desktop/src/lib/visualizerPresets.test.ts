import { describe, expect, it } from "vitest";
import { activeVisPreset, BAR_PRESETS, WAVE_PRESETS } from "./visualizerPresets";
import { VIS_LIMITS } from "../shell/visualizerMath";
import { DEFAULT_PREFS } from "../types";

/** Пресеты по конвенции «пресеты → ползунки» (decisions 2026-07-13): чип НЕ
 *  хранится в Prefs — он просто записывает числа, а подсветка вычисляется
 *  обратным сравнением. Тесты держат два инварианта: значения пресетов не
 *  вылезают из диапазонов ползунков, и первый пресет каждого вида — это
 *  в точности дефолты (кнопка «вернуть как было» без отдельного reset). */

const PREF_TO_LIMIT: Record<string, keyof typeof VIS_LIMITS> = {
  visualizerBars: "bars",
  visualizerBarFill: "barFill",
  visualizerBarRound: "barRound",
  visualizerBarCalm: "barCalm",
  visualizerWaveSmooth: "waveSmooth",
  visualizerWaveCalm: "waveCalm",
  visualizerWaveThick: "waveThick",
  visualizerWaveFill: "waveFill",
  visualizerWaveAmp: "waveAmp",
  visualizerOpacity: "opacity",
};

describe("визуальные пресеты — данные", () => {
  it("каждое числовое значение пресета лежит в диапазоне своего ползунка", () => {
    for (const p of [...WAVE_PRESETS, ...BAR_PRESETS]) {
      for (const [key, value] of Object.entries(p.set)) {
        if (typeof value !== "number") continue;
        const limit = VIS_LIMITS[PREF_TO_LIMIT[key]];
        expect(limit, `${p.key}: неизвестный преф ${key}`).toBeDefined();
        expect(value, `${p.key}.${key} ниже минимума`).toBeGreaterThanOrEqual(limit.min);
        expect(value, `${p.key}.${key} выше максимума`).toBeLessThanOrEqual(limit.max);
      }
    }
  });

  it("пресеты пишут только визуализаторные ключи (не трогают чужие prefs)", () => {
    for (const p of [...WAVE_PRESETS, ...BAR_PRESETS]) {
      for (const key of Object.keys(p.set)) {
        expect(key.startsWith("visualizer"), `${p.key} пишет посторонний ключ ${key}`).toBe(true);
      }
    }
  });

  it("первый пресет волны и баров — в точности дефолты (возврат «как было»)", () => {
    for (const p of [WAVE_PRESETS[0], BAR_PRESETS[0]]) {
      for (const [key, value] of Object.entries(p.set)) {
        expect(value, `${p.key}.${key} разошёлся с DEFAULT_PREFS`).toBe(
          DEFAULT_PREFS[key as keyof typeof DEFAULT_PREFS],
        );
      }
    }
  });

  it("ключи пресетов уникальны внутри вида", () => {
    for (const list of [WAVE_PRESETS, BAR_PRESETS]) {
      expect(new Set(list.map((p) => p.key)).size).toBe(list.length);
    }
  });
});

describe("activeVisPreset — подсветка чипа по текущим числам", () => {
  it("дефолтные prefs подсвечивают первый пресет", () => {
    expect(activeVisPreset(WAVE_PRESETS, DEFAULT_PREFS)).toBe(WAVE_PRESETS[0].key);
    expect(activeVisPreset(BAR_PRESETS, DEFAULT_PREFS)).toBe(BAR_PRESETS[0].key);
  });

  it("любое отклонение ползунка гасит подсветку (null = «Свой»)", () => {
    const touched = { ...DEFAULT_PREFS, visualizerWaveThick: DEFAULT_PREFS.visualizerWaveThick + 1 };
    expect(activeVisPreset(WAVE_PRESETS, touched)).toBeNull();
  });

  it("совпадение с недефолтным пресетом находится", () => {
    const p = WAVE_PRESETS[1];
    const prefs = { ...DEFAULT_PREFS, ...p.set };
    expect(activeVisPreset(WAVE_PRESETS, prefs)).toBe(p.key);
  });
});
