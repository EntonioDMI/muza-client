/** Сторож полной классификации Prefs для тем (спека 19.07 §6).
 *
 *  Найденная дыра: fontScale, lineSpacing, density, visualizer-поля и rowShow
 *  не были в THEME_KEYS — темы молча теряли типографику, плотность, визуализатор и
 *  состав строки трека. Этот тест делает потерю НЕВОЗМОЖНОЙ: каждый ключ
 *  Prefs обязан быть либо в THEME_KEYS (едет с темой), либо в THEME_EXCLUDED
 *  (осознанно не едет — поведение, приватное, привязанное к машине).
 *  Добавил поле в Prefs и не классифицировал — тест красный. */
import { describe, expect, it } from "vitest";
import { THEME_KEYS, THEME_EXCLUDED } from "./themes";
import { DEFAULT_PREFS } from "../types";

describe("классификация ключей Prefs для тем", () => {
  it("каждый ключ либо в THEME_KEYS, либо в THEME_EXCLUDED", () => {
    const all = Object.keys(DEFAULT_PREFS).sort();
    const classified = [...THEME_KEYS, ...THEME_EXCLUDED].sort();
    expect(classified).toEqual(all);
  });

  it("списки не пересекаются", () => {
    const both = THEME_KEYS.filter((k) => (THEME_EXCLUDED as readonly string[]).includes(k));
    expect(both).toEqual([]);
  });

  it("дыра 19.07 закрыта: типографика, плотность, визуализатор и строка трека едут с темой", () => {
    for (const k of ["fontScale", "lineSpacing", "density", "rowShow", "visualizer", "visualizerOpacity", "bassShake"]) {
      expect(THEME_KEYS as readonly string[], k).toContain(k);
    }
  });
});
