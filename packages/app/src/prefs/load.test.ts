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

  // ПЕРЕЕЗД ВНЕШНЕГО ВИДА НА ВЕРСИЮ 2 (редизайн 2026-08-04). Профиль хранится
  // целиком, поэтому у каждого живого пользователя геометрия лежит явными
  // числами и смена DEFAULT_PREFS его бы не коснулась. Граница миграции: трогаем
  // ТОЛЬКО поля, равные старым дефолтам, — то есть те, которых человек не
  // касался. Сломается эта граница — редизайн молча сотрёт чужие настройки.
  describe("переезд внешнего вида на версию 2", () => {
    it("нетронутые поля переезжают на новые дефолты", () => {
      const prefs = mergePrefs({ gapZone: 12, wSidebar: 280, hPlayerBar: 92, coverBarSize: 60 });
      expect(prefs.gapZone).toBe(8);
      expect(prefs.wSidebar).toBe(240);
      expect(prefs.hPlayerBar).toBe(72);
      expect(prefs.coverBarSize).toBe(48);
    });

    it("настроенное руками остаётся как было", () => {
      const prefs = mergePrefs({ gapZone: 20, wSidebar: 320, hPlayerBar: 110, coverBarSize: 80 });
      expect(prefs.gapZone).toBe(20);
      expect(prefs.wSidebar).toBe(320);
      expect(prefs.hPlayerBar).toBe(110);
      expect(prefs.coverBarSize).toBe(80);
    });

    it("профиль, уже проехавший переезд, второй раз не трогается", () => {
      // Человек ПОСЛЕ редизайна вернул себе прежнюю ширину сайдбара. Повторный
      // запуск обязан её сохранить, иначе настройка не удержится никогда.
      const prefs = mergePrefs({ lookVersion: 2, wSidebar: 280, hPlayerBar: 92 });
      expect(prefs.wSidebar).toBe(280);
      expect(prefs.hPlayerBar).toBe(92);
    });

    it("ступень v3 пуста (развёрнутый за вечер флет-дефолт) — ничего не двигает", () => {
      // Плоский вид стал ЛИЧНЫМ тумблером, а не дефолтом: профили не трогаются,
      // с какой бы версии ни приехали. Номер 3 сожжён — не переиспользовать.
      expect(mergePrefs({ lookVersion: 2, gapZone: 8 }).gapZone).toBe(8);
      expect(mergePrefs({ lookVersion: 2, gapZone: 20 }).gapZone).toBe(20);
      expect(mergePrefs({ lookVersion: 3, gapZone: 0 }).gapZone).toBe(0);
    });

    it("после слияния профиль помечен текущей версией вида", () => {
      expect(mergePrefs({}).lookVersion).toBe(DEFAULT_PREFS.lookVersion);
      expect(mergePrefs({ gapZone: 12 }).lookVersion).toBe(DEFAULT_PREFS.lookVersion);
    });

    it("выбор «Меньше/Обычные/Больше» переездом не трогается", () => {
      // Скругления поменяли ЧИСЛА в tokens/radius.css, а не имена пресетов:
      // новая шкала приезжает ко всем сама, а выбор человека — его выбор.
      expect(mergePrefs({ radius: "round" }).radius).toBe("round");
      expect(mergePrefs({ radius: "mild" }).radius).toBe("mild");
    });
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

  it("язык не из словаря → как у СУЩЕСТВУЮЩЕГО профиля, а не как у нового", () => {
    // Раньше здесь стоял DEFAULT_PREFS.language ("en"), и это была тихая
    // ловушка: дефолт площадки по замыслу для НОВЫХ профилей, а сюда попадает
    // заведомо не новый. Подмена ещё и необратима — стоит человеку тронуть
    // любую настройку, и «en» уезжает на диск как его осознанный выбор.
    expect(mergePrefs({ language: "de" } as never).language).toBe("ru");
    expect(mergePrefs({ language: 7 } as never).language).toBe("ru");
    // отсутствие поля — по-прежнему старый профиль, ему «ru»
    expect(mergePrefs({ blur: 1 }).language).toBe("ru");
  });

  it("локаль с регионом читается как язык: ru-RU → ru, en-GB → en", () => {
    // Профиль мог прийти из места, где язык хранится локалью. Буквального
    // совпадения со словарём нет, но выбор человека очевиден — уважаем его,
    // а не сбрасываем.
    expect(mergePrefs({ language: "ru-RU" } as never).language).toBe("ru");
    expect(mergePrefs({ language: "en-GB" } as never).language).toBe("en");
    expect(mergePrefs({ language: "EN-us" } as never).language).toBe("en");
    // Регион от НЕизвестного языка — по-прежнему «ru», словаря-то нет.
    expect(mergePrefs({ language: "de-DE" } as never).language).toBe("ru");
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
