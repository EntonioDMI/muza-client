import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "./types";
import { THEME_KEYS } from "./lib/themes";

describe("bassShake pref (T14)", () => {
  it("выключен по умолчанию", () => {
    expect(DEFAULT_PREFS.bassShake).toBe(false);
  });

  it("не входит в THEME_KEYS — поведенческий преф, не оформление", () => {
    expect((THEME_KEYS as readonly string[]).includes("bassShake")).toBe(false);
  });

  it("мигрирует через обычный DEFAULT_PREFS-мердж без спец-миграции", () => {
    // Симулируем старый localStorage без ключа bassShake (пользователь с прежней версии).
    const stored = { ...DEFAULT_PREFS } as Partial<typeof DEFAULT_PREFS>;
    delete stored.bassShake;
    const merged = { ...DEFAULT_PREFS, ...stored };
    expect(merged.bassShake).toBe(false);
  });
});
