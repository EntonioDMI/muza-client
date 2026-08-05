/** РАСКЛАДКИ ОКНА: узнавание текущей и геометрия каждой.
 *
 *  Обе проверки пришли из живого профиля владельца (05.08), а не из головы.
 *  Первая: currentWindowLayout смотрел на два буля и игнорировал зазор, поэтому
 *  профиль, проехавший отменённую ступень v3 (зоны скруглены, но встык),
 *  показывался как «Воздушная» — человек видел уверенно выбранную вкладку и
 *  потому не нажимал её, хотя починка была в один клик.
 *  Вторая: «Классика» ставила поле зоны 20px при скруглении 28px — ровно ту
 *  геометрию, которую редизайн 04.08 назвал причиной жалобы «интерфейс
 *  разрозненный» (см. шапку tokens/radius.css). */
import { describe, expect, it } from "vitest";
import { buildThemeVars } from "../../theme/themeVars";
import { DEFAULT_PREFS, type Prefs } from "../../prefs/types";
import { currentWindowLayout, WINDOW_LAYOUTS, type WindowLayout } from "./appearancePresets";

const LAYOUTS = Object.keys(WINDOW_LAYOUTS) as WindowLayout[];

const withLayout = (k: WindowLayout, extra: Partial<Prefs> = {}): Prefs => ({
  ...DEFAULT_PREFS,
  ...WINDOW_LAYOUTS[k],
  ...extra,
});

describe("currentWindowLayout", () => {
  it("каждая раскладка узнаёт саму себя", () => {
    for (const k of LAYOUTS) expect(currentWindowLayout(withLayout(k)), k).toBe(k);
  });

  it("покрученные ползунками размеры раскладку не теряют", () => {
    // Ширину сайдбара, высоту полосы и плотность человек штатно крутит — это не
    // повод объявлять его раскладку «никакой».
    expect(currentWindowLayout(withLayout("air", { wSidebar: 320, hPlayerBar: 110, density: 20 }))).toBe("air");
    expect(currentWindowLayout(withLayout("classic", { coverBarSize: 80 }))).toBe("classic");
  });

  it("силуэт, не совпавший ни с одной раскладкой, — «Своя», а не ближайшая", () => {
    // Зазор ползунком выведен за пределы всех трёх наборов.
    expect(currentWindowLayout(withLayout("air", { gapZone: 20 }))).toBeNull();
    // Плавающий плеер при прижатых зонах — кентавр, которого ни одна раскладка
    // не задаёт (и ради которого раскладки вообще завели).
    expect(currentWindowLayout(withLayout("flat", { playerDocked: false }))).toBeNull();
  });

  it("профиль, застрявший после отменённой ступени v3, больше не выдаёт себя за воздушный", () => {
    // zonesDocked false + gapZone 0: зоны скруглены и встык. Именно это окно
    // владелец видел с подписью «Воздушная». Профили чинит ступень v4
    // (prefs/load.ts), но ряд обязан говорить правду и до её проезда.
    expect(currentWindowLayout({ ...DEFAULT_PREFS, zonesDocked: false, playerDocked: true, gapZone: 0 })).toBeNull();
  });
});

/** --r-lg пресетов скругления (tokens/radius.css в @muza/ui). Зеркало на три
 *  числа: сам токен живёт в CSS, в тест не приезжает, а таблица RADIUS_BASE в
 *  theme/themeVars.ts наружу не отдана. Разъедется с CSS — покраснеет здесь. */
const PRESET_LG: Record<Prefs["radius"], number> = { mild: 8, soft: 16, round: 28 };

/** Поле зоны и её скругление — так, как их увидит окно: через настоящий движок
 *  темы, а не через переписанную в тест формулу. */
function zoneGeometry(prefs: Prefs): { pad: number; radius: number } {
  const vars = buildThemeVars(prefs) as unknown as Record<string, string | undefined>;
  // --r-lg ставится инлайном ТОЛЬКО при radiusPanels !== 100; при 100 действует
  // токен пресета из CSS.
  const rLg = vars["--r-lg"];
  return {
    pad: parseFloat(vars["--pad-zone"] ?? ""),
    radius: rLg === undefined ? PRESET_LG[prefs.radius] : parseFloat(rLg),
  };
}

/** Ожидание записано ЧИСЛАМИ, а не вычислено из тех же источников: тест обязан
 *  краснеть и когда поедет формула плотности (densityPad в themeVars.ts), и
 *  когда поедет пресет скруглений (tokens/radius.css). Вычисленное ожидание не
 *  поймало бы ни того, ни другого. */
const EXPECTED: Record<WindowLayout, { pad: number; radius: number }> = {
  air: { pad: 16, radius: 16 },
  flat: { pad: 16, radius: 16 },
  classic: { pad: 20, radius: 20 },
};

describe("геометрия раскладок: поле зоны равно её скруглению", () => {
  it("все три раскладки концентричны", () => {
    for (const k of LAYOUTS) {
      const g = zoneGeometry(withLayout(k));
      expect(g, k).toEqual(EXPECTED[k]);
      expect(g.pad, k).toBe(g.radius);
    }
  });

  it("переход между раскладками не оставляет половину предыдущей", () => {
    // Классика ставит свою плотность и свой процент скругления панелей; если
    // воздушная не вернёт оба ключа, окно останется с полем 20 при скруглении
    // 16 — та же поломка, только с другой стороны.
    const fromClassic: Prefs = { ...withLayout("classic"), ...WINDOW_LAYOUTS.air };
    const g = zoneGeometry(fromClassic);
    expect(g).toEqual(EXPECTED.air);
  });

  it("классика осталась классикой: плавающий плеер и крупные метрики", () => {
    // Чинилась ГЕОМЕТРИЯ, а не характер: узнаваемое обязано остаться на месте.
    const classic = WINDOW_LAYOUTS.classic;
    expect(classic.playerDocked).toBe(false);
    expect(classic.zonesDocked).toBe(false);
    expect(classic.wSidebar).toBe(280);
    expect(classic.hPlayerBar).toBe(92);
    expect(classic.coverBarSize).toBe(60);
    expect(classic.radius).toBe("round");
    // Плитки и строки остаются круглыми: чинили только скругление ЗОН.
    expect(withLayout("classic").radiusTiles).toBe(DEFAULT_PREFS.radiusTiles);
  });

  it("все раскладки задают один и тот же набор ключей — ось целиком", () => {
    const shape = Object.keys(WINDOW_LAYOUTS.air).sort();
    for (const k of LAYOUTS) expect(Object.keys(WINDOW_LAYOUTS[k]).sort(), k).toEqual(shape);
  });
});
