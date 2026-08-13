/** Слияние профиля с дефолтами и миграции старых сохранений.
 *
 *  Логика приехала из apps/desktop/src/App.tsx (2026-08-02) и теперь общая для
 *  обоих клиентов — а значит, ошибка здесь стоит вдвое дороже: она либо ломает
 *  запуск программы, либо тихо обнуляет настройки человека в браузере. */
import { afterEach, describe, expect, it } from "vitest";
import { loadPrefs, mergePrefs, PREFS_KEY, savePrefs } from "./load";
import { DEFAULT_PREFS, RADIUS_OVERRIDE_OFF, type Prefs } from "./types";

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
      // Профили, которые ступень v3 всё-таки успела задеть, чинит уже v4 — см.
      // «профиль, застрявший между раскладками» ниже.
      expect(mergePrefs({ lookVersion: 3, gapZone: 20 }).gapZone).toBe(20);
    });

    it("после слияния профиль помечен текущей версией вида", () => {
      expect(mergePrefs({}).lookVersion).toBe(DEFAULT_PREFS.lookVersion);
      expect(mergePrefs({ gapZone: 12 }).lookVersion).toBe(DEFAULT_PREFS.lookVersion);
    });

    it("выбор «Меньше/Обычные/Больше» переездом не трогается", () => {
      // Скругление стало свободным числом 2026-08-13, но выбор человека обязан
      // приехать НА ТО ЖЕ МЕСТО ШКАЛЫ: сохранённое имя пресета превращается в
      // его же --r-lg из tokens/radius.css, а не в дефолт.
      const stored = (radius: string) => mergePrefs({ radius } as unknown as Partial<Prefs>).radius;
      expect(stored("round")).toBe(28);
      expect(stored("soft")).toBe(16);
      expect(stored("mild")).toBe(8);
      // Незнакомая строка (чужой профиль, версия из будущего) → дефолт, а не NaN.
      expect(stored("такого-пресета-нет")).toBe(DEFAULT_PREFS.radius);
    });

    it("свободное скругление зажимается в границы ползунка", () => {
      // Профиль правят руками и приносят с чужой машины (шапка prefs/load.ts):
      // 999 не должен превратиться в окно из одних кругов, −5 — в NaN.
      expect(mergePrefs({ radius: 999 }).radius).toBe(40);
      expect(mergePrefs({ radius: -5 }).radius).toBe(0);
      expect(mergePrefs({ radius: 21 }).radius).toBe(21);
    });
  });

  // ПЕРЕЕЗД НА ВЕРСИЮ 4 (2026-08-05). Две правки в одной ступени: «продолжить
  // с места» включается по умолчанию, и чинится профиль, застрявший между
  // раскладками после отмены ступени v3.
  describe("переезд внешнего вида на версию 4", () => {
    it("«продолжить с места» включается тем, кто его никогда не включал", () => {
      // Улик нет (ключ позиций не заводился) → сегодняшнее false досталось от
      // старого дефолта, а не от человека.
      expect(mergePrefs({ resumePosition: false }).resumePosition).toBe(true);
      // Профиль вообще без поля — тем более: у него уже дефолт площадки.
      expect(mergePrefs({ blur: 10 }).resumePosition).toBe(true);
    });

    it("выключенное ОСОЗНАННО остаётся выключенным", () => {
      // Ключ muza.resume.v1 существует ⇒ настройку когда-то включали ⇒ её
      // нынешнее false — решение человека, и миграция обязана его пропустить.
      const prefs = mergePrefs({ resumePosition: false }, DEFAULT_PREFS, { hadResumeHistory: true });
      expect(prefs.resumePosition).toBe(false);
    });

    it("профиль, уже проехавший ступень, второй раз не трогается", () => {
      // Иначе выключить настройку было бы НЕВОЗМОЖНО: каждый запуск включал бы
      // её заново, и человек не смог бы её удержать.
      expect(mergePrefs({ lookVersion: 4, resumePosition: false }).resumePosition).toBe(false);
      expect(mergePrefs({ lookVersion: 4, zonesDocked: false, gapZone: 0 }).gapZone).toBe(0);
    });

    it("зазор 0 при выключенном плоском виде — след отменённой v3, возвращаем воздух", () => {
      // Такой профиль показывает скруглённые зоны впритык, а вкладка раскладки
      // при этом утверждает «Воздушная»: сам человек не чинится, потому что не
      // нажимает уже выбранное.
      expect(mergePrefs({ lookVersion: 3, zonesDocked: false, gapZone: 0 }).gapZone).toBe(8);
      // Профиль версии 1 доезжает сюда же: ступени складываются.
      expect(mergePrefs({ zonesDocked: false, gapZone: 0 }).gapZone).toBe(8);
    });

    it("обратная пара (плоский вид + зазор) не трогается — её могли собрать руками", () => {
      const prefs = mergePrefs({ lookVersion: 3, zonesDocked: true, gapZone: 12 });
      expect(prefs.gapZone).toBe(12);
      expect(prefs.zonesDocked).toBe(true);
      // И честный плоский вид (зоны встык) остаётся плоским.
      expect(mergePrefs({ lookVersion: 3, zonesDocked: true, gapZone: 0 }).gapZone).toBe(0);
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

  it("улику для ступени v4 loadPrefs берёт с диска, а не выдумывает", () => {
    const old = { ...DEFAULT_PREFS, lookVersion: 3, resumePosition: false };
    localStorage.setItem(PREFS_KEY, JSON.stringify(old));
    // Ключа позиций нет — настройку никогда не включали, переводим на дефолт.
    expect(loadPrefs().resumePosition).toBe(true);

    localStorage.setItem(PREFS_KEY, JSON.stringify(old));
    // Пустая карта — тоже улика: позиции чистятся по мере проигрывания, а сам
    // ключ остаётся. Поэтому проверяется СУЩЕСТВОВАНИЕ, а не содержимое.
    localStorage.setItem("muza.resume.v1", "{}");
    expect(loadPrefs().resumePosition).toBe(false);
  });

  it("МИГРАЦИЯ ЗАКРЕПЛЯЕТСЯ НА ДИСКЕ — иначе она отменяет сама себя", () => {
    // ⚠️ РЕГРЕССИЯ НА НАСТОЯЩИЙ БАГ (найден противоборствующей проверкой
    // 2026-08-05). Пока результат миграции никуда не писался, «продолжить с
    // места» жило РОВНО ОДИН СЕАНС:
    //   сеанс 1 — улик нет → resumePosition становится true;
    //   человек слушает трек дольше пяти секунд → resumeStore заводит ключ;
    //   сеанс 2 — улика теперь ЕСТЬ → та же ступень читает её как «выключил
    //   осознанно», а в сохранении по-прежнему false → настройка гаснет сама.
    // Лечится тем, что ступень одноразовая по-настоящему: версия схемы
    // закрепляется в хранилище при первом же чтении.
    const old = { ...DEFAULT_PREFS, lookVersion: 3, resumePosition: false };
    localStorage.setItem(PREFS_KEY, JSON.stringify(old));

    expect(loadPrefs().resumePosition).toBe(true); // сеанс 1: мигрировали
    const onDisk = JSON.parse(localStorage.getItem(PREFS_KEY) as string);
    expect(onDisk.lookVersion, "версия схемы обязана уехать в хранилище").toBe(DEFAULT_PREFS.lookVersion);
    expect(onDisk.resumePosition, "результат миграции обязан уехать в хранилище").toBe(true);

    // Человек послушал музыку — появилась улика, которая раньше всё ломала.
    localStorage.setItem("muza.resume.v1", '{"track":42}');
    expect(loadPrefs().resumePosition, "сеанс 2: настройка обязана выжить").toBe(true);
    // И сеанс 3 тоже — ступень больше не выполняется вовсе.
    expect(loadPrefs().resumePosition).toBe(true);
  });

  it("осознанно выключенную настройку миграция не воскрешает и на диск не лезет", () => {
    // Профиль уже версии 4: ступени отработали когда-то, false — выбор человека.
    const mine = { ...DEFAULT_PREFS, resumePosition: false };
    const raw = JSON.stringify(mine);
    localStorage.setItem(PREFS_KEY, raw);
    expect(loadPrefs().resumePosition).toBe(false);
    // Версия совпала — переписывать хранилище не за чем и незачем.
    expect(localStorage.getItem(PREFS_KEY)).toBe(raw);
  });

  it("savePrefs → loadPrefs возвращает профиль ЦЕЛИКОМ, включая неприменимые поля", () => {
    savePrefs({ ...DEFAULT_PREFS, miniPlayer: true, tray: false, blur: 7 });
    const back = loadPrefs();
    expect(back.miniPlayer).toBe(true);
    expect(back.tray).toBe(false);
    expect(back.blur).toBe(7);
  });
});
