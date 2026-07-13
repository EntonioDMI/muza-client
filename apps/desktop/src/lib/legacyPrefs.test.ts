import { describe, expect, it } from "vitest";
import { migrateLegacyValue } from "./legacyPrefs";
import { sanitizeTokens } from "./themes";
import { RADIUS_OVERRIDE_OFF } from "../types";

describe("migrateLegacyValue", () => {
  it("мигрирует строковые пресеты в прежние числа", () => {
    expect(migrateLegacyValue("radiusTiles", "sharper")).toBe(50);
    expect(migrateLegacyValue("radiusTiles", "preset")).toBe(100);
    expect(migrateLegacyValue("radiusPanels", "rounder")).toBe(160);
    expect(migrateLegacyValue("radiusControls", "pill")).toBe(RADIUS_OVERRIDE_OFF);
    expect(migrateLegacyValue("radiusControls", "sharp")).toBe(8);
    expect(migrateLegacyValue("radiusFields", "soft")).toBe(16);
    expect(migrateLegacyValue("density", "compact")).toBe(0);
    expect(migrateLegacyValue("lineSpacing", "relaxed")).toBe(160);
    expect(migrateLegacyValue("animSpeed", "fast")).toBe(60);
  });

  it("неизвестная строка/ключ → undefined (дефолт у звонящего)", () => {
    expect(migrateLegacyValue("radiusTiles", "мусор")).toBeUndefined();
    expect(migrateLegacyValue("не-ключ", "preset")).toBeUndefined();
    expect(migrateLegacyValue("density", NaN)).toBeUndefined();
  });

  it("клампит числа в диапазон", () => {
    expect(migrateLegacyValue("radiusTiles", 500)).toBe(200);
    expect(migrateLegacyValue("radiusTiles", -10)).toBe(0);
    expect(migrateLegacyValue("density", 63.7)).toBe(64);
  });

  it("T7: углы «до упора» — radiusTiles/Panels пропускают 0 и 200 без клампа", () => {
    expect(migrateLegacyValue("radiusTiles", 0)).toBe(0);
    expect(migrateLegacyValue("radiusTiles", 200)).toBe(200);
    expect(migrateLegacyValue("radiusPanels", 0)).toBe(0);
    expect(migrateLegacyValue("radiusPanels", 200)).toBe(200);
  });

  it("для кнопок/полей «выше max» = сентинел выкл (пилюля/пресет)", () => {
    expect(migrateLegacyValue("radiusControls", 999)).toBe(RADIUS_OVERRIDE_OFF);
    expect(migrateLegacyValue("radiusControls", 300)).toBe(RADIUS_OVERRIDE_OFF);
    expect(migrateLegacyValue("radiusFields", 26)).toBe(26);
    expect(migrateLegacyValue("radiusFields", 27)).toBe(RADIUS_OVERRIDE_OFF);
  });

  it("T7: radiusControls/Fields минимум теперь 0px (было 6px)", () => {
    expect(migrateLegacyValue("radiusControls", 0)).toBe(0);
    expect(migrateLegacyValue("radiusFields", 0)).toBe(0);
    expect(migrateLegacyValue("radiusFields", -5)).toBe(0);
  });

  it("T8: radiusTabs — та же схема кламп/сентинел, что у radiusControls/Fields", () => {
    expect(migrateLegacyValue("radiusTabs", 0)).toBe(0);
    expect(migrateLegacyValue("radiusTabs", 26)).toBe(26);
    expect(migrateLegacyValue("radiusTabs", 12.4)).toBe(12);
    expect(migrateLegacyValue("radiusTabs", 999)).toBe(RADIUS_OVERRIDE_OFF);
    expect(migrateLegacyValue("radiusTabs", 27)).toBe(RADIUS_OVERRIDE_OFF);
    expect(migrateLegacyValue("radiusTabs", 300)).toBe(RADIUS_OVERRIDE_OFF);
    expect(migrateLegacyValue("radiusTabs", -5)).toBe(0);
  });
});

describe("sanitizeTokens: легаси-темы со строковыми пресетами", () => {
  it("строки мигрируются в числа, а не отбрасываются typeof-фильтром", () => {
    const tokens = sanitizeTokens({
      radiusTiles: "rounder",
      radiusControls: "pill",
      animSpeed: "slow",
      accent: "red",
    });
    expect(tokens.radiusTiles).toBe(160);
    expect(tokens.radiusControls).toBe(RADIUS_OVERRIDE_OFF);
    expect(tokens.animSpeed).toBe(170);
    expect(tokens.accent).toBe("red");
  });

  it("числовые значения проходят с клампом, мусор отбрасывается", () => {
    const tokens = sanitizeTokens({ radiusPanels: 9000, animSpeed: true, radiusFields: 12 });
    expect(tokens.radiusPanels).toBe(200);
    expect("animSpeed" in tokens).toBe(false);
    expect(tokens.radiusFields).toBe(12);
  });

  it("T7: тема маркетплейса с новыми крайними значениями (0/200) проходит без клампа", () => {
    const tokens = sanitizeTokens({ radiusTiles: 0, radiusPanels: 200, radiusControls: 0, radiusFields: 0 });
    expect(tokens.radiusTiles).toBe(0);
    expect(tokens.radiusPanels).toBe(200);
    expect(tokens.radiusControls).toBe(0);
    expect(tokens.radiusFields).toBe(0);
  });

  it("density/lineSpacing — не тема (в THEME_KEYS не входят)", () => {
    const tokens = sanitizeTokens({ density: 80, lineSpacing: 130 });
    expect("density" in tokens).toBe(false);
    expect("lineSpacing" in tokens).toBe(false);
  });
});
