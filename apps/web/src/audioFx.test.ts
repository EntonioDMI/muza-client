/** Звуковой тракт веба (audioFx.ts) — то, что можно проверить без плеера:
 *  множитель выравнивания громкости и уровень слота.
 *
 *  Почему уровень проверяется по `el.volume`: в jsdom нет AudioContext, значит
 *  ensureChain честно проваливается — ровно тот режим «plain», в котором
 *  вкладка живёт у большинства людей (эквалайзер по умолчанию выключен, цепь
 *  не строится). Web Audio-ветку проверить в jsdom нечем, и подменять её
 *  фиктивным AudioContext бессмысленно: тест доказывал бы только сам мок. */

import { describe, expect, it } from "vitest";
import { eqAttached, ensureChain, normFactor, setEqBands, setSlotLevel } from "./audioFx";

describe("normFactor — выравнивание громкости", () => {
  it("выключено или громкость не измерена — трек звучит как есть", () => {
    expect(normFactor(-20, false)).toBe(1);
    expect(normFactor(null, true)).toBe(1);
    expect(normFactor(null, false)).toBe(1);
  });

  it("тихий трек поднимает, громкий приглушает — к общей цели −14 LUFS", () => {
    // −20 LUFS тише цели на 6 дБ → ×2; −5 LUFS громче на 9 дБ → ×0.35
    expect(normFactor(-20, true)).toBeCloseTo(2, 2);
    expect(normFactor(-5, true)).toBeCloseTo(0.3548, 4);
    expect(normFactor(-14, true)).toBeCloseTo(1, 6);
  });

  it("битый замер не делает трек оглушительным: границы ±12 дБ", () => {
    // без границ −40 LUFS дало бы +26 дБ (×20) — это и есть «оглушительно»
    expect(normFactor(-40, true)).toBeCloseTo(3.981, 3);
    expect(normFactor(5, true)).toBeCloseTo(0.2512, 4);
  });
});

describe("setSlotLevel — уровень слота без Web Audio-цепи", () => {
  it("цепи нет — уровень идёт в громкость элемента", () => {
    const el = document.createElement("audio");
    setSlotLevel(el, 0.42);
    expect(el.volume).toBeCloseTo(0.42, 5);
  });

  it("усилить нечем — выше единицы клампится, ниже нуля не уходит", () => {
    const el = document.createElement("audio");
    setSlotLevel(el, 2.5);
    expect(el.volume).toBe(1);
    setSlotLevel(el, -3);
    expect(el.volume).toBe(0);
  });
});

describe("ensureChain — цепь строится только когда есть чем", () => {
  it("нет AudioContext — честный отказ, звук не трогаем", () => {
    const el = document.createElement("audio");
    el.volume = 0.5;
    expect(ensureChain(el)).toBe(false);
    expect(eqAttached()).toBe(false);
    expect(el.volume).toBe(0.5);
    // полосы без цепи — тихий no-op, а не исключение на каждый тумблер
    expect(() => setEqBands([1, 2, 3], true)).not.toThrow();
  });
});
