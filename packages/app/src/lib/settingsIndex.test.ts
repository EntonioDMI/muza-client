import { describe, expect, it } from "vitest";
import { SETTINGS_INDEX, searchSettings, type SettingsCapability } from "./settingsIndex";
import { translate, type TranslationKey } from "../i18n";

describe("SETTINGS_INDEX", () => {
  it("каждый titleKey существует в русском словаре", () => {
    // titleKey в индексе — string (ключи могут опережать словарь), поэтому
    // каст: translate на неизвестный ключ просто возвращает сам ключ.
    const dead = SETTINGS_INDEX.filter((e) => translate("ru", e.titleKey as TranslationKey) === e.titleKey).map((e) => e.titleKey);
    expect(dead).toEqual([]);
  });
});

/** Поиск тестируется на ЗАГЛУШКЕ словаря, не на живых текстах: тексты
 *  переписываются волнами, и тест на живых строках ломался бы от любой правки
 *  формулировки. Заглушка отдаёт перевод трём записям индекса, остальные ведут
 *  себя как «ключа нет» (translate возвращает сам ключ). */
const FAKE: Record<string, string> = {
  "settings.customize.background.type.title": "Фон",
  "settings.customize.background.type.hint": "Что нарисовать за интерфейсом.",
  "settings.playback.sleepTimer.title": "Таймер сна",
  "settings.playback.sleepTimer.hint": "Музыка сама остановится через выбранные минуты.",
  "settings.system.tray.title": "Значок у часов",
  "settings.system.tray.hint": "Muza остаётся у часов, когда окно закрыто.",
};
const t = (key: string) => FAKE[key] ?? key;

describe("searchSettings", () => {
  it("находит по синониму, которого нет в названии: «обои» → фон", () => {
    const hits = searchSettings("обои", t);
    expect(hits.map((h) => h.titleKey)).toEqual(["settings.customize.background.type.title"]);
  });

  it("результат несёт tab и sub для навигации", () => {
    const [hit] = searchSettings("таймер", t);
    expect(hit.tab).toBe("playback");
    expect(hit.sub).toBeNull();
  });

  it("без списка умений (приложение) ряд значка у часов находится", () => {
    expect(searchSettings("часов", t).map((h) => h.titleKey)).toEqual(["settings.system.tray.title"]);
  });

  it("со списком умений браузера ряда значка у часов нет вовсе", () => {
    // Ровно тот же запрос и тот же словарь — разница только в площадке.
    const webCaps: SettingsCapability[] = ["themeMarket"];
    expect(searchSettings("часов", t, webCaps)).toEqual([]);
  });

  it("ряды без требований площадки находятся и в браузере", () => {
    const webCaps: SettingsCapability[] = [];
    expect(searchSettings("обои", t, webCaps).length).toBe(1);
  });
});
