import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "./types";
import { THEME_KEYS } from "./lib/themes";

describe("bassShake pref (T14)", () => {
  it("выключен по умолчанию", () => {
    expect(DEFAULT_PREFS.bassShake).toBe(false);
  });

  it("входит в THEME_KEYS — решение спеки 19.07 §6: отклик на бас едет с темой", () => {
    // Было наоборот (T14 считал его поведением); закрытие «дыры THEME_KEYS»
    // 19.07 отнесло визуализатор и качание к оформлению — сторож
    // lib/themes.coverage.test.ts требует того же.
    expect((THEME_KEYS as readonly string[]).includes("bassShake")).toBe(true);
  });

  it("мигрирует через обычный DEFAULT_PREFS-мердж без спец-миграции", () => {
    // Симулируем старый localStorage без ключа bassShake (пользователь с прежней версии).
    const stored = { ...DEFAULT_PREFS } as Partial<typeof DEFAULT_PREFS>;
    delete stored.bassShake;
    const merged = { ...DEFAULT_PREFS, ...stored };
    expect(merged.bassShake).toBe(false);
  });
});

describe("gapless pref (T19)", () => {
  it("выключен по умолчанию", () => {
    expect(DEFAULT_PREFS.gapless).toBe(false);
  });

  it("не входит в THEME_KEYS — поведенческий преф, не оформление", () => {
    expect((THEME_KEYS as readonly string[]).includes("gapless")).toBe(false);
  });

  it("мигрирует через обычный DEFAULT_PREFS-мердж без спец-миграции", () => {
    const stored = { ...DEFAULT_PREFS } as Partial<typeof DEFAULT_PREFS>;
    delete stored.gapless;
    const merged = { ...DEFAULT_PREFS, ...stored };
    expect(merged.gapless).toBe(false);
  });
});

describe("searchGrouping pref (T37)", () => {
  it("включён по умолчанию", () => {
    expect(DEFAULT_PREFS.searchGrouping).toBe(true);
  });

  it("не входит в THEME_KEYS — поведенческий преф, не оформление", () => {
    expect((THEME_KEYS as readonly string[]).includes("searchGrouping")).toBe(false);
  });

  it("мигрирует через обычный DEFAULT_PREFS-мердж без спец-миграции", () => {
    const stored = { ...DEFAULT_PREFS } as Partial<typeof DEFAULT_PREFS>;
    delete stored.searchGrouping;
    const merged = { ...DEFAULT_PREFS, ...stored };
    expect(merged.searchGrouping).toBe(true);
  });
});

describe("listeningLyricsShown pref (скрытие текста в режиме прослушивания)", () => {
  it("текст показан по умолчанию", () => {
    expect(DEFAULT_PREFS.listeningLyricsShown).toBe(true);
  });

  it("не входит в THEME_KEYS — поведенческий преф, не оформление", () => {
    expect((THEME_KEYS as readonly string[]).includes("listeningLyricsShown")).toBe(false);
  });

  it("мигрирует через обычный DEFAULT_PREFS-мердж без спец-миграции", () => {
    // Старое сохранение без ключа (пользователь с прежней версии) → дефолт true.
    const stored = { ...DEFAULT_PREFS } as Partial<typeof DEFAULT_PREFS>;
    delete stored.listeningLyricsShown;
    const merged = { ...DEFAULT_PREFS, ...stored };
    expect(merged.listeningLyricsShown).toBe(true);
  });
});

describe("bgType=animated + bgAnimatedInvert (T15)", () => {
  it("bgType допускает 'animated', bgAnimatedInvert выключен по умолчанию", () => {
    expect(DEFAULT_PREFS.bgType).toBe("none");
    expect(DEFAULT_PREFS.bgAnimatedInvert).toBe(false);
  });

  it("bgAnimatedInvert входит в THEME_KEYS — это оформление (направление вращения фона), а не поведение", () => {
    expect((THEME_KEYS as readonly string[]).includes("bgAnimatedInvert")).toBe(true);
  });
});
