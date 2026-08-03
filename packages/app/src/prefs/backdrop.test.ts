/** ФОН КАРАОКЕ И ТИПЫ АНИМАЦИИ (заявка владельца 2026-08-03).
 *
 *  Три вещи, ради которых этот файл существует:
 *   1. значения по умолчанию дают ПРЕЖНИЙ вид — караоке не должно измениться ни
 *      у кого, кто настройку не трогал;
 *   2. старое направление вращения (bgAnimatedInvert) переезжает в новую модель
 *      без потери картинки;
 *   3. мусор в новых полях (чужая тема, правленый руками профиль) уходит к
 *      дефолту, а не в CSS. */

import { describe, expect, it } from "vitest";
import {
  backdropViewFromPrefs,
  DEFAULT_SCENE_BACKDROP,
  legacyInvertFromSpin,
  normalizeDiscs,
  normalizeSpin,
  spinFromLegacyInvert,
  SPIN_PAIRS,
} from "./backdrop";
import { DEFAULT_PREFS, type Prefs } from "./types";

describe("значения по умолчанию = сегодняшний вид", () => {
  it("караоке по умолчанию рисует обложку трека, а не что-то новое", () => {
    expect(DEFAULT_PREFS.karaokeBgType).toBe("cover");
    expect(DEFAULT_SCENE_BACKDROP.type).toBe("cover");
    expect(DEFAULT_SCENE_BACKDROP.zone).toBe("scene");
  });

  it("основной фон по умолчанию не изменился: выключен", () => {
    expect(DEFAULT_PREFS.bgType).toBe("none");
  });

  it("анимация по умолчанию — две обложки навстречу друг другу (вид до 03.08)", () => {
    expect(DEFAULT_PREFS.bgAnimDiscs).toBe("two");
    expect(DEFAULT_PREFS.bgAnimSpin).toBe("inward");
    expect(DEFAULT_PREFS.karaokeBgAnimDiscs).toBe("two");
    expect(DEFAULT_PREFS.karaokeBgAnimSpin).toBe("inward");
    // Прежняя пара направлений: левый круг по часовой, правый против.
    expect(SPIN_PAIRS.inward).toEqual(["cw", "ccw"]);
    // Старый тумблер invert=true менял их местами — это и есть "outward".
    expect(SPIN_PAIRS.outward).toEqual(["ccw", "cw"]);
  });

  it("ручки караоке равны ручкам основного фона: одинаковые дефолты", () => {
    expect(DEFAULT_PREFS.karaokeBgAnimSpeedSec).toBe(DEFAULT_PREFS.bgAnimSpeedSec);
    expect(DEFAULT_PREFS.karaokeBgAnimOpacity).toBe(DEFAULT_PREFS.bgAnimOpacity);
    expect(DEFAULT_PREFS.karaokeBgAnimScale).toBe(DEFAULT_PREFS.bgAnimScale);
    expect(DEFAULT_PREFS.karaokeBgAnimEdge).toBe(DEFAULT_PREFS.bgAnimEdge);
  });
});

describe("backdropViewFromPrefs", () => {
  it("зона приложения читает bg*, зона сцены — karaokeBg*", () => {
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      bgType: "color",
      bgColor: "#111111",
      karaokeBgType: "gradient",
      karaokeBgColor: "#222222",
      karaokeBgColor2: "#333333",
    };
    expect(backdropViewFromPrefs(prefs, "app")).toMatchObject({ type: "color", color: "#111111" });
    expect(backdropViewFromPrefs(prefs, "scene")).toMatchObject({
      type: "gradient",
      color: "#222222",
      color2: "#333333",
    });
  });

  it("«как основной фон» берёт ВСЕ настройки основного — этого владелец и ждал с гифкой", () => {
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      bgType: "image",
      bgImageUrl: "https://example.test/loop.gif",
      karaokeBgType: "same",
      // Свои значения караоке при "same" не участвуют вовсе.
      karaokeBgImageUrl: "https://example.test/ignored.png",
    };
    const scene = backdropViewFromPrefs(prefs, "scene");
    expect(scene.type).toBe("image");
    expect(scene.imageUrl).toBe("https://example.test/loop.gif");
    // Рисуется всё равно как СЦЕНА: приглушение подложки караоке не нужно.
    expect(scene.zone).toBe("scene");
  });

  it("гифке не нужен свой вид фона: она едет обычной ссылкой на картинку", () => {
    const prefs: Prefs = { ...DEFAULT_PREFS, karaokeBgType: "image", karaokeBgImageUrl: "https://example.test/a.gif" };
    expect(backdropViewFromPrefs(prefs, "scene")).toMatchObject({
      type: "image",
      imageUrl: "https://example.test/a.gif",
    });
  });

  it("размытие нулевое — рисовалка узнаёт об этом и не ставит фильтр впустую", () => {
    const prefs: Prefs = { ...DEFAULT_PREFS, blurScenery: 0 };
    expect(backdropViewFromPrefs(prefs, "scene").sceneryBlurPx).toBe(0);
  });
});

describe("враждебный ввод в новых полях", () => {
  // Профиль правят руками и приносят с чужой машины, тема приезжает с витрины;
  // оба фильтра сверяют только ВИД значения — строка "; drop" их проходит.
  const junk = {
    ...DEFAULT_PREFS,
    karaokeBgType: "; drop",
    karaokeBgAnimSpin: "хаха",
    karaokeBgAnimDiscs: "сорок",
    karaokeBgAnimScale: 1e9,
    karaokeBgAnimOpacity: Number.NaN,
    karaokeBgAnimSpeedSec: -1e9,
    karaokeBgAnimEdge: Number.POSITIVE_INFINITY,
    karaokeBgColor: 42,
  } as unknown as Prefs;

  it("незнакомый вид фона караоке падает в «обложку трека», а не гасит сцену", () => {
    expect(backdropViewFromPrefs(junk, "scene").type).toBe("cover");
  });

  it("числа зажимаются границами ползунков, NaN и бесконечность берут дефолт", () => {
    const v = backdropViewFromPrefs(junk, "scene");
    // Конечное, но запредельное — к границе ползунка (свой ползунок больше не
    // даст, и чужая тема тоже не должна).
    expect(v.animScale).toBe(200);
    expect(v.animSpeedSec).toBe(16);
    // NaN и ±Infinity зажимать не во что: у них нет «ближайшей границы», и они
    // берут дефолт — та же развилка, что в clampToRange (prefs/legacyPrefs.ts).
    expect(v.animEdge).toBe(DEFAULT_PREFS.karaokeBgAnimEdge);
    expect(v.animOpacity).toBe(DEFAULT_PREFS.karaokeBgAnimOpacity);
  });

  it("незнакомые направление и число обложек берут прежний вид", () => {
    const v = backdropViewFromPrefs(junk, "scene");
    expect(v.animSpin).toBe("inward");
    expect(v.animDiscs).toBe("two");
  });

  it("не-строка вместо цвета не уезжает в CSS", () => {
    expect(backdropViewFromPrefs(junk, "scene").color).toBe(DEFAULT_PREFS.karaokeBgColor);
  });

  it("нормализаторы поодиночке: любой мусор → прежнее значение", () => {
    for (const bad of [null, undefined, 0, {}, [], "spin"]) {
      expect(normalizeSpin(bad)).toBe("inward");
      expect(normalizeDiscs(bad)).toBe("two");
    }
  });
});

describe("зеркало старого тумблера направления", () => {
  it("старый invert=true — это «в разные стороны»", () => {
    expect(spinFromLegacyInvert(true)).toBe("outward");
    expect(spinFromLegacyInvert(false)).toBe("inward");
  });

  it("обратный перевод для старой рисовалки", () => {
    expect(legacyInvertFromSpin("inward")).toBe(false);
    expect(legacyInvertFromSpin("outward")).toBe(true);
    expect(legacyInvertFromSpin("cw")).toBe(false);
    expect(legacyInvertFromSpin("ccw")).toBe(true);
  });

  it("две прежние позиции переводятся туда и обратно без потерь", () => {
    for (const invert of [true, false]) {
      expect(legacyInvertFromSpin(spinFromLegacyInvert(invert))).toBe(invert);
    }
  });
});

describe("одна обложка", () => {
  it("крутится как левый круг пары: «навстречу» становится «по часовой»", () => {
    expect(SPIN_PAIRS.inward[0]).toBe("cw");
    expect(SPIN_PAIRS.outward[0]).toBe("ccw");
    expect(SPIN_PAIRS.cw[0]).toBe("cw");
    expect(SPIN_PAIRS.ccw[0]).toBe("ccw");
  });

  it("«обе в одну сторону» — новая возможность: пара одинаковых направлений", () => {
    expect(SPIN_PAIRS.cw).toEqual(["cw", "cw"]);
    expect(SPIN_PAIRS.ccw).toEqual(["ccw", "ccw"]);
  });
});
