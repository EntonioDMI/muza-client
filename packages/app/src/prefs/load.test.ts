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
