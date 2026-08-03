import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "../prefs/types";
import { buildThemeVars, mixHex, themeAttrs } from "./themeVars";

/** ЗАЧЕМ ЭТИ ТЕСТЫ. Движок темы стал общим для приложения и веба (перенос
 *  формул из apps/desktop/src/App.tsx, 2026-08-02), и главное требование
 *  переноса — у приложения НУЛЕВОЙ дифф. Проверять это глазами по скриншоту
 *  дорого и ненадёжно, поэтому ожидаемые значения ниже выписаны руками из
 *  ПРЕЖНИХ формул rootStyle: если кто-то поправит выражение в движке, красным
 *  станет здесь, а не в глазах пользователя. */

// Тип возвращаемого стиля — CSSProperties; читаем как словарь переменных.
const vars = (...args: Parameters<typeof buildThemeVars>) =>
  buildThemeVars(...args) as unknown as Record<string, string | number | undefined>;

describe("buildThemeVars — дефолтный профиль", () => {
  const v = vars(DEFAULT_PREFS);

  it("стекло и текст считаются из процентов профиля", () => {
    expect(v["--blur-glass"]).toBe("28px");
    expect(v["--glass-panel"]).toBe("rgba(23, 22, 20, 0.62)");
    expect(v["--text-2"]).toBe("rgba(244, 243, 241, 0.62)");
    // 0.48 давало 4.22:1 на выделенной строке (surface-4) при норме 4.5 —
    // подняли до минимума, проходящего на ВСЕХ поверхностях тёмной темы.
    expect(v["--text-3"]).toBe("rgba(244, 243, 241, 0.52)");
  });

  it("размеры зон и списков = токенам ДС (профиль ничего не двигает)", () => {
    expect(v["--h-playerbar"]).toBe("92px");
    expect(v["--size-cover-bar"]).toBe("60px");
    expect(v["--w-tile"]).toBe("176px");
    expect(v["--pad-tile"]).toBe("16px");
    expect(v["--gap-zone"]).toBe("12px");
    expect(v["--w-sidebar"]).toBe("280px");
    expect(v["--w-nowplaying"]).toBe("340px");
    expect(v["--pad-zone"]).toBe("20px");
    expect(v["--h-trackrow"]).toBe("60px");
    expect(v["--lh-ui"]).toBe("1.40");
    expect(v["--fs-karaoke"]).toBe("56px");
    expect(v["--blur-scenery"]).toBe("64px");
    expect(v["--orb-dur"]).toBe("64s");
  });

  it("при дефолтах НЕ ставит того, что должно достаться токенам ДС", () => {
    for (const key of [
      "--r-xs",
      "--r-lg",
      "--r-control",
      "--r-field",
      "--r-tabs",
      "--glass-player",
      "--bf-zone",
      "--bg-0",
      "--font-ui",
      "--font-display",
      "--fs-title",
      "--sp-1",
      "--dur-fast",
      "--ease-out",
      "--accent",
      "--accent-play",
      "zoom",
    ]) {
      expect(v).not.toHaveProperty(key);
    }
  });
});

describe("buildThemeVars — ручки настроек", () => {
  it("масштаб интерфейса = zoom (100% — свойства нет вовсе)", () => {
    expect(vars({ ...DEFAULT_PREFS, uiScale: 125 }).zoom).toBe(1.25);
    expect(vars({ ...DEFAULT_PREFS, uiScale: 100 })).not.toHaveProperty("zoom");
  });

  it("простор множит ВСЮ шкалу отступов ДС", () => {
    const v = vars({ ...DEFAULT_PREFS, spaceScale: 125 });
    expect(v["--sp-1"]).toBe("5px"); // 4 × 1.25
    expect(v["--sp-4"]).toBe("20px"); // 16 × 1.25
    expect(v["--sp-10"]).toBe("100px"); // 80 × 1.25
  });

  it("скругление по типам: проценты от пресета radius, px — у кнопок и полей", () => {
    const v = vars({ ...DEFAULT_PREFS, radius: "round", radiusTiles: 50, radiusPanels: 200, radiusControls: 8 });
    expect(v["--r-xs"]).toBe("7px"); // round.xs 14 × 0.5
    expect(v["--r-md"]).toBe("13px"); // round.md 26 × 0.5
    expect(v["--r-lg"]).toBe("72px"); // round.lg 36 × 2
    expect(v["--r-control"]).toBe("8px");
    // «как в ДС» (сентинел 999) — токен не ставим вовсе
    expect(v).not.toHaveProperty("--r-field");
  });

  it("стекло по зонам: панели — тон стекла, зоны — тон поверхности, плюс blur", () => {
    const v = vars({ ...DEFAULT_PREFS, glassZonesOn: true, glassPlayer: 40, glassSidebar: 10 });
    expect(v["--glass-player"]).toBe("rgba(23, 22, 20, 0.4)");
    expect(v["--glass-sidebar"]).toBe("rgba(255, 255, 255, 0.1)");
    expect(v["--bf-zone"]).toBe("blur(var(--blur-glass))");
  });

  it("скорость движения: общий процент × групповой множитель", () => {
    const v = vars({ ...DEFAULT_PREFS, animSpeed: 50, durMenuMult: 200 });
    expect(v["--dur-fast"]).toBe("150ms"); // 150 × 0.5 × 2
    expect(v["--dur-base"]).toBe("110ms"); // 220 × 0.5
    expect(v["--dur-slow"]).toBe("200ms"); // 400 × 0.5
  });

  it("анимации выключены — длительности схлопываются в 1ms", () => {
    const v = vars({ ...DEFAULT_PREFS, anims: false, animSpeed: 50 });
    expect(v["--dur-fast"]).toBe("1ms");
    expect(v["--dur-slow"]).toBe("1ms");
  });

  it("характер движения меняет кривую (soft — родная ДС, не ставим)", () => {
    expect(vars({ ...DEFAULT_PREFS, easeStyle: "linear" })["--ease-out"]).toBe("linear");
    expect(vars({ ...DEFAULT_PREFS, easeStyle: "soft" })).not.toHaveProperty("--ease-out");
  });

  it("базовый фон-пресет переопределяет --bg-0/1 и только в тёмной теме", () => {
    expect(vars({ ...DEFAULT_PREFS, baseBg: "amoled" })["--bg-0"]).toBe("#000000");
    expect(vars({ ...DEFAULT_PREFS, baseBg: "amoled", theme: "light" })).not.toHaveProperty("--bg-0");
  });

  it("реакция фона на обложку смешивает пару bg-слоёв с цветом обложки", () => {
    const v = vars({ ...DEFAULT_PREFS, bgTint: true }, { coverTint: "#ff0000" });
    expect(v["--bg-0"]).toBe(mixHex("#121110", "#ff0000", 0.22));
    // Выключенная ручка — тонировки нет, даже когда цвет обложки известен
    expect(vars(DEFAULT_PREFS, { coverTint: "#ff0000" })).not.toHaveProperty("--bg-0");
  });

  it("узкое окно пережимает сайдбар независимо от настройки", () => {
    expect(vars({ ...DEFAULT_PREFS, wSidebar: 320 }, { wideSidebar: false })["--w-sidebar"]).toBe("220px");
    expect(vars({ ...DEFAULT_PREFS, wSidebar: 320 })["--w-sidebar"]).toBe("320px");
  });

  it("светлая тема переворачивает базы текста и стекла", () => {
    const v = vars({ ...DEFAULT_PREFS, theme: "light" });
    // Прозрачность на светлой теме ПЛОТНЕЕ, чем на тёмной, при той же ручке:
    // тёмные чернила по светлому теряют контраст быстрее. Раньше здесь стояло
    // 0.62 — то же число, что у тёмной, — и это давало 4.66:1 у второго тона и
    // 3.06:1 у третьего при норме 4.5. Замер 03.08, разбор — в шапке themeVars.
    expect(v["--text-2"]).toBe("rgba(28, 26, 23, 0.78)");
    expect(v["--text-3"]).toBe("rgba(28, 26, 23, 0.66)");
    expect(v["--glass-panel"]).toBe("rgba(250, 249, 246, 0.62)");
  });

  // Сторож на СУТЬ, а не на числа: что бы ни сделали с формулой, обычный текст
  // обеих ступеней обязан добирать норму WCAG на своём фоне. Худший фон —
  // surface-4 поверх bg-0 (выделенная строка трека).
  it("обе текстовые ступени добирают 4.5:1 на своём фоне в обеих темах", () => {
    const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
    const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const over = (fg: number[], a: number, bg: number[]) => fg.map((c, i) => c * a + bg[i] * (1 - a));
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // surface-4 = базовая поверхность с прозрачностью 0.10 поверх фона темы
    const cases = [
      { theme: "dark" as const, ink: [244, 243, 241], bg0: [18, 17, 16], surf: [255, 255, 255] },
      { theme: "light" as const, ink: [28, 26, 23], bg0: [243, 241, 237], surf: [20, 18, 15] },
    ];
    for (const c of cases) {
      const v = vars({ ...DEFAULT_PREFS, theme: c.theme });
      const bg = over(c.surf, 0.1, c.bg0);
      for (const key of ["--text-2", "--text-3"] as const) {
        const alpha = Number(/, ([\d.]+)\)$/.exec(String(v[key]))![1]);
        const got = ratio(over(c.ink, alpha, bg), bg);
        expect(got, `${c.theme} ${key} = ${got.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

/** Шаг между вторым и третьим тоном = разница токенов ДС: на тёмной теме 0.62 и
 *  0.52 (шаг 0.10), на светлой 0.78 и 0.66 (шаг 0.12). Копий формулы было две
 *  (App.tsx и веб), теперь одна — этот тест сторожит и шаг, и нижний клэмп. */
describe("третий тон текста", () => {
  it("держит шаг своей темы на всём ходу ручки", () => {
    for (const [theme, step] of [["dark", 0.1] as const, ["light", 0.12] as const]) {
      for (const textDim of [40, 55, 62, 80]) {
        const v = vars({ ...DEFAULT_PREFS, theme, textDim });
        const second = Number(/, ([\d.]+)\)$/.exec(String(v["--text-2"]))![1]);
        const third = Number(/, ([\d.]+)\)$/.exec(String(v["--text-3"]))![1]);
        expect(Number((second - third).toFixed(2)), `${theme} textDim=${textDim}`).toBe(step);
      }
    }
  });

  it("ниже 0.2 не опускается — текст не растворяется совсем", () => {
    expect(vars({ ...DEFAULT_PREFS, textDim: 30 })["--text-3"]).toBe("rgba(244, 243, 241, 0.20)");
  });
});

/** Веб-совместимость: клиент вправе прислать неполный срез профиля —
 *  недостающее берётся из DEFAULT_PREFS, а не ломает сборку стиля. */
describe("неполный вход", () => {
  it("считает по дефолтам всё, чего не прислали", () => {
    const v = vars({ blur: 10 });
    expect(v["--blur-glass"]).toBe("10px");
    expect(v["--glass-panel"]).toBe("rgba(23, 22, 20, 0.62)");
    expect(v["--pad-zone"]).toBe("20px");
  });

  it("пустой вход = дефолтный профиль", () => {
    expect(vars({})).toEqual(vars(DEFAULT_PREFS));
  });
});

describe("themeAttrs", () => {
  it("дефолты (тёмная/blue/soft) не оставляют атрибутов", () => {
    expect(themeAttrs(DEFAULT_PREFS)).toEqual({});
  });

  it("свой цвет акцента не превращается в data-accent (его считает движок)", () => {
    expect(themeAttrs({ ...DEFAULT_PREFS, accent: "custom" })).toEqual({});
  });

  it("непресетные значения уезжают в data-атрибуты для CSS ДС", () => {
    expect(themeAttrs({ theme: "light", accent: "red", radius: "round" })).toEqual({
      "data-theme": "light",
      "data-accent": "red",
      "data-radius": "round",
    });
  });
});
