/** Слияние профиля с дефолтами и миграции старых сохранений.
 *
 *  Логика приехала из apps/desktop/src/App.tsx (2026-08-02) и теперь общая для
 *  обоих клиентов — а значит, ошибка здесь стоит вдвое дороже: она либо ломает
 *  запуск программы, либо тихо обнуляет настройки человека в браузере. */
import { afterEach, describe, expect, it } from "vitest";
import { loadPrefs, mergePrefs, PREFS_KEY, savePrefs } from "./load";
import { DEFAULT_PREFS, RADIUS_OVERRIDE_OFF } from "./types";

afterEach(() => localStorage.clear());

describe("mergePrefs", () => {
  it("сохранённое накладывается на дефолты — новые поля не ломают старый профиль", () => {
    const prefs = mergePrefs({ blur: 10 });
    expect(prefs.blur).toBe(10);
    expect(prefs.tileSize).toBe(DEFAULT_PREFS.tileSize);
  });

  it("вложенные объекты мерджатся глубже: новое под-поле не теряет соседей", () => {
    const prefs = mergePrefs({ rowShow: { cover: false } as never });
    expect(prefs.rowShow).toEqual({ ...DEFAULT_PREFS.rowShow, cover: false });
    const src = mergePrefs({ sourcesEnabled: { youtube: false } as never });
    expect(src.sourcesEnabled).toEqual({ ...DEFAULT_PREFS.sourcesEnabled, youtube: false });
  });

  it("миграция Stage 6: старый bgCover=true → bgType «из обложки»", () => {
    expect(mergePrefs({ bgCover: true }).bgType).toBe("cover");
    // явный bgType главнее предка
    expect(mergePrefs({ bgCover: true, bgType: "none" }).bgType).toBe("none");
  });

  // ── Направление вращения фона: тумблер → четыре положения (03.08) ──
  // Человек с настроенным invert=true обязан увидеть РОВНО то же, что видел.
  it("миграция 03.08: старый bgAnimatedInvert=true → «в разные стороны»", () => {
    const prefs = mergePrefs({ bgAnimatedInvert: true });
    expect(prefs.bgAnimSpin).toBe("outward");
    // Старое поле осталось зеркалом: пока фон приложения рисует App.tsx по нему,
    // картинка у человека не должна дрогнуть.
    expect(prefs.bgAnimatedInvert).toBe(true);
  });

  it("профиль без тумблера вообще (все, кто его не трогал) → прежний вид", () => {
    const prefs = mergePrefs({ blur: 10 });
    expect(prefs.bgAnimSpin).toBe("inward");
    expect(prefs.bgAnimatedInvert).toBe(false);
    expect(prefs.bgAnimDiscs).toBe("two");
  });

  it("выбранное направление главнее старого тумблера, зеркало пересчитывается", () => {
    const prefs = mergePrefs({ bgAnimatedInvert: false, bgAnimSpin: "ccw" });
    expect(prefs.bgAnimSpin).toBe("ccw");
    expect(prefs.bgAnimatedInvert).toBe(true);
  });

  it("бессмыслица в направлении не проезжает в профиль", () => {
    const prefs = mergePrefs({ bgAnimSpin: "; drop" } as never);
    expect(prefs.bgAnimSpin).toBe("inward");
    expect(prefs.bgAnimatedInvert).toBe(false);
  });

  it("фон караоке у старого профиля — обложка трека, вид караоке не меняется", () => {
    const prefs = mergePrefs({ blur: 10 });
    expect(prefs.karaokeBgType).toBe("cover");
    expect(prefs.karaokeBgImageUrl).toBe("");
  });

  it("миграция «пресеты → ползунки»: строки старых сохранений становятся числами", () => {
    const prefs = mergePrefs({ radiusTiles: "rounder", density: "compact", animSpeed: "fast" } as never);
    expect(prefs.radiusTiles).toBe(160);
    expect(prefs.density).toBe(0);
    expect(prefs.animSpeed).toBe(60);
  });

  it("мусор в мигрируемом поле откатывается к дефолту", () => {
    expect(mergePrefs({ radiusControls: "чепуха" } as never).radiusControls).toBe(RADIUS_OVERRIDE_OFF);
  });

  it("хоткеи добираются дефолтами — новое действие не остаётся без бинда", () => {
    const prefs = mergePrefs({ hotkeys: { playPause: "Space" } as never });
    expect(prefs.hotkeys.playPause).toBe("Space");
    expect(prefs.hotkeys.next).toBe(DEFAULT_PREFS.hotkeys.next);
  });

  it("T28: у профиля, сохранённого до языковой настройки, язык остаётся русским", () => {
    expect(mergePrefs({ blur: 10 }).language).toBe("ru");
    expect(mergePrefs({ language: "en" }).language).toBe("en");
  });

  // ── Битый/чужой профиль (аудит 2026-08-03) ──────────────────────────
  // Профиль переносимый (шапка load.ts), то есть вход извне штатный. Раньше
  // слияние было спредом, и в Prefs попадало что угодно: `statsBlocks: null`
  // роняло страницу статистики, `rowShow: null` — «Кастомизацию».
  it("null вместо объекта/массива не проезжает: поле берёт дефолт", () => {
    const prefs = mergePrefs({ rowShow: null, statsBlocks: null, sourcesEnabled: null, eqBands: null } as never);
    expect(prefs.rowShow).toEqual(DEFAULT_PREFS.rowShow);
    expect(prefs.statsBlocks).toEqual(DEFAULT_PREFS.statsBlocks);
    expect(prefs.sourcesEnabled).toEqual(DEFAULT_PREFS.sourcesEnabled);
    expect(prefs.eqBands).toEqual(DEFAULT_PREFS.eqBands);
  });

  it("подмена вида значения не проезжает (число ↔ строка, массив ↔ объект)", () => {
    const prefs = mergePrefs({ uiScale: "большой", anims: "да", statsBlocks: {}, rowShow: [] } as never);
    expect(prefs.uiScale).toBe(DEFAULT_PREFS.uiScale);
    expect(prefs.anims).toBe(DEFAULT_PREFS.anims);
    expect(prefs.statsBlocks).toEqual(DEFAULT_PREFS.statsBlocks);
    expect(prefs.rowShow).toEqual(DEFAULT_PREFS.rowShow);
  });

  it("битые хоткеи не оставляют плашку клавиши без строки", () => {
    const prefs = mergePrefs({ hotkeys: { playPause: 5, next: null, prev: "KeyZ" } } as never);
    expect(prefs.hotkeys.playPause).toBe(DEFAULT_PREFS.hotkeys.playPause);
    expect(prefs.hotkeys.next).toBe(DEFAULT_PREFS.hotkeys.next);
    expect(prefs.hotkeys.prev).toBe("KeyZ");
    expect(Object.values(prefs.hotkeys).every((v) => typeof v === "string")).toBe(true);
  });

  it("язык не из словаря → язык площадки (иначе интерфейс без словаря)", () => {
    expect(mergePrefs({ language: "de" } as never).language).toBe(DEFAULT_PREFS.language);
    expect(mergePrefs({ language: 7 } as never).language).toBe(DEFAULT_PREFS.language);
    // а вот отсутствие поля — по-прежнему старый профиль, ему «ru»
    expect(mergePrefs({ blur: 1 }).language).toBe("ru");
  });

  it("base главнее DEFAULT_PREFS, но сохранённое главнее base (профиль площадки)", () => {
    const webBase = { ...DEFAULT_PREFS, bgType: "cover" as const };
    expect(mergePrefs({ blur: 10 }, webBase).bgType).toBe("cover");
    expect(mergePrefs({ bgType: "none" }, webBase).bgType).toBe("none");
  });
});

describe("loadPrefs", () => {
  it("пустое хранилище → дефолты площадки (язык не мигрируется)", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(loadPrefs().language).toBe(DEFAULT_PREFS.language);
  });

  it("битый JSON не роняет запуск", () => {
    localStorage.setItem(PREFS_KEY, "{не json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("savePrefs → loadPrefs возвращает профиль ЦЕЛИКОМ, включая неприменимые поля", () => {
    savePrefs({ ...DEFAULT_PREFS, miniPlayer: true, tray: false, blur: 7 });
    const back = loadPrefs();
    expect(back.miniPlayer).toBe(true);
    expect(back.tray).toBe(false);
    expect(back.blur).toBe(7);
  });
});
