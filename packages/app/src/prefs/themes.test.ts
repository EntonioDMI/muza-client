/** ЧУЖАЯ ТЕМА — ВРАЖДЕБНЫЙ ВВОД (аудит 2026-08-03).
 *
 *  Тема приезжает из буфера обмена и с витрины: JSON пишет кто угодно, а
 *  применяется он одной кнопкой. До этих правок фильтр проверял только тип
 *  значения, и две дыры делали тему оружием:
 *
 *   1. `typeof null === "object"` — тема с `"rowShow": null` клала null прямо в
 *      профиль, и экран «Кастомизация» падал на `prefs.rowShow.cover`. Коварство
 *      в том, что тема снимается ровно на том экране, который она роняет.
 *   2. Числа не ограничивались диапазоном — `uiScale: 100000` уезжал в zoom
 *      1000, кнопка «Сбросить оформление» становилась физически недостижимой, и
 *      восстановление оставалось одно: чистка хранилища.
 *
 *  Поэтому здесь проверяется не «функция что-то фильтрует», а инвариант: что бы
 *  ни лежало в чужом JSON, applyTheme не может положить в Prefs ни null вместо
 *  объекта, ни число вне диапазона ползунка. */

import { describe, expect, it } from "vitest";
import { applyTheme, sanitizeTokens, THEME_KEYS, THEME_NUMBER_RANGES } from "./themes";
import { DEFAULT_PREFS, RADIUS_OVERRIDE_OFF, type Prefs } from "./types";

describe("sanitizeTokens: объектные ключи темы", () => {
  it("rowShow: null отбрасывается — тема берёт дефолт, а не null", () => {
    const tokens = sanitizeTokens({ rowShow: null });
    expect("rowShow" in tokens).toBe(false);
    expect(applyTheme(tokens, DEFAULT_PREFS).rowShow).toEqual(DEFAULT_PREFS.rowShow);
  });

  it("массив/строка/число вместо объекта — тоже мимо", () => {
    for (const junk of [[], ["cover"], "cover", 1, true]) {
      expect("rowShow" in sanitizeTokens({ rowShow: junk })).toBe(false);
    }
  });

  it("частичный объект добирается дефолтами: под-поле не остаётся undefined", () => {
    const tokens = sanitizeTokens({ rowShow: { cover: false, duration: "да", лишнее: 1 } });
    expect(tokens.rowShow).toEqual({ ...DEFAULT_PREFS.rowShow, cover: false });
  });

  it("после самой злой темы «Кастомизация» читает булево, а не падает", () => {
    for (const junk of [null, [], "нет", 0]) {
      const prefs = applyTheme(sanitizeTokens({ rowShow: junk }), DEFAULT_PREFS);
      // ровно то обращение, на котором падал CustomizeSub
      expect(typeof prefs.rowShow.cover).toBe("boolean");
      expect(typeof prefs.rowShow.duration).toBe("boolean");
    }
  });
});

describe("sanitizeTokens: числа в границах своего ряда настроек", () => {
  it("uiScale вне диапазона не «кирпичит» окно", () => {
    expect(sanitizeTokens({ uiScale: 100000 }).uiScale).toBe(125);
    expect(sanitizeTokens({ uiScale: -1e9 }).uiScale).toBe(85);
  });

  it("ширины зон и стекло зажимаются, а не уезжают на весь экран", () => {
    expect(sanitizeTokens({ wSidebar: 999999 }).wSidebar).toBe(340);
    expect(sanitizeTokens({ wNowPlaying: -50 }).wNowPlaying).toBe(300);
    expect(sanitizeTokens({ glassOpacity: 1 }).glassOpacity).toBe(30);
    expect(sanitizeTokens({ glassPlayer: 500 }).glassPlayer).toBe(100);
  });

  it("NaN и Infinity отбрасываются — ключ берёт дефолт", () => {
    const tokens = sanitizeTokens({ uiScale: NaN, blur: Infinity, tileSize: -Infinity });
    expect("uiScale" in tokens).toBe(false);
    expect("blur" in tokens).toBe(false);
    expect("tileSize" in tokens).toBe(false);
    const prefs = applyTheme(tokens, DEFAULT_PREFS);
    expect(prefs.uiScale).toBe(DEFAULT_PREFS.uiScale);
    expect(prefs.blur).toBe(DEFAULT_PREFS.blur);
  });

  it("вменяемая тема проезжает без изменений", () => {
    const tokens = sanitizeTokens({ uiScale: 110, wSidebar: 300, glassPlayer: 0, tileSize: 200 });
    expect(tokens).toEqual({ uiScale: 110, wSidebar: 300, glassPlayer: 0, tileSize: 200 });
  });

  it("radiusTabs клампится наравне с остальными углами (его диапазон был недостижим)", () => {
    expect(sanitizeTokens({ radiusTabs: 12.4 }).radiusTabs).toBe(12);
    expect(sanitizeTokens({ radiusTabs: -5 }).radiusTabs).toBe(0);
    // выше max — не «зажать до 26», а сентинел «как в ДС» (пилюля)
    expect(sanitizeTokens({ radiusTabs: 27 }).radiusTabs).toBe(RADIUS_OVERRIDE_OFF);
    expect(sanitizeTokens({ radiusTabs: 9000 }).radiusTabs).toBe(RADIUS_OVERRIDE_OFF);
  });

  it("СТОРОЖ: у каждого числового ключа темы есть диапазон", () => {
    const missing = THEME_KEYS.filter((k) => typeof DEFAULT_PREFS[k] === "number" && !THEME_NUMBER_RANGES[k]);
    expect(missing).toEqual([]);
  });

  it("СТОРОЖ: дефолт каждого числового ключа лежит внутри своего диапазона", () => {
    const bad: string[] = [];
    for (const k of THEME_KEYS) {
      const def = DEFAULT_PREFS[k];
      const range = THEME_NUMBER_RANGES[k];
      if (typeof def !== "number" || !range) continue;
      // сентинел «переопределение выключено» законно живёт выше max
      if (range.offAbove && def === RADIUS_OVERRIDE_OFF) continue;
      if (def < range.min || def > range.max) bad.push(k);
    }
    expect(bad).toEqual([]);
  });

  it("собственный вид программы после «применить тему с себя» не меняется", () => {
    // Снимок дефолтов через фильтр обязан вернуться в дефолты байт-в-байт:
    // иначе кламп подрезал бы вид у людей, ничего не менявших.
    const tokens: Record<string, unknown> = {};
    for (const k of THEME_KEYS) tokens[k] = DEFAULT_PREFS[k];
    expect(applyTheme(sanitizeTokens(tokens), DEFAULT_PREFS)).toEqual(DEFAULT_PREFS as Prefs);
  });
});
