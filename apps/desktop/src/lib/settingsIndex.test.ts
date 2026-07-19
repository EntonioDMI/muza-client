import { describe, expect, it } from "vitest";
import { SETTINGS_INDEX, searchSettings } from "./settingsIndex";
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
 *  переписываются волнами 2/4, и тест на живых строках ломался бы от любой
 *  правки формулировки. Заглушка отдаёт перевод двум записям индекса,
 *  остальные ведут себя как «ключа нет» (translate возвращает сам ключ). */
const FAKE: Record<string, string> = {
  "settings.customize.background.type.title": "Фон",
  "settings.customize.background.type.hint": "Что нарисовать за интерфейсом.",
  "settings.playback.sleepTimer.title": "Таймер сна",
  "settings.playback.sleepTimer.hint": "Музыка сама остановится через выбранные минуты.",
};
const t = (key: string) => FAKE[key] ?? key;

describe("searchSettings", () => {
  it("находит по синониму, которого нет в названии: «обои» → фон", () => {
    const hits = searchSettings("обои", t);
    expect(hits.map((h) => h.titleKey)).toEqual(["settings.customize.background.type.title"]);
  });

  it("находит по слову из подсказки", () => {
    const hits = searchSettings("остановится", t);
    expect(hits.map((h) => h.titleKey)).toEqual(["settings.playback.sleepTimer.title"]);
  });

  it("регистронезависим и терпит лишние пробелы", () => {
    expect(searchSettings("  ФОН  ", t).length).toBe(1);
  });

  it("все слова запроса обязаны совпасть", () => {
    expect(searchSettings("фон минуты", t)).toEqual([]);
  });

  it("пустой запрос — пустой результат", () => {
    expect(searchSettings("   ", t)).toEqual([]);
  });

  it("результат несёт tab и sub для навигации", () => {
    const [hit] = searchSettings("таймер", t);
    expect(hit.tab).toBe("playback");
    expect(hit.sub).toBeNull();
  });
});
