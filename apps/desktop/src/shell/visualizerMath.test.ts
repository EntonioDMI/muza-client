import { describe, expect, it } from "vitest";
import { bandCount, bandIndexForBar, barBands, waveShape } from "./visualizerMath";

/** Реальные параметры движка (`player/audioEngine.ts`): fftSize 2048 →
 *  frequencyBinCount 1024; sampleRate Windows/WASAPI обычно 48000. */
const BINS = 1024;
const RATE = 48000;

/** Центр бина в Гц: FFT линеен по частоте от 0 до Nyquist (sampleRate/2). */
const hz = (bin: number, bins = BINS, rate = RATE) => (bin * rate) / 2 / bins;

/** Синус в байтах getByteTimeDomainData (128 = ноль, 0..255). */
function sineBytes(len: number, periodSamples: number, amp = 1): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Math.round(128 + amp * 127 * Math.sin((2 * Math.PI * i) / periodSamples));
  }
  return out;
}

describe("barBands — раскладка бинов FFT по барам", () => {
  it("отдаёт ровно barCount полос", () => {
    expect(barBands(56, BINS, RATE)).toHaveLength(56);
    expect(barBands(24, BINS, RATE)).toHaveLength(24);
  });

  it("не оставляет дырок и не двоит бины: hi предыдущей = lo следующей", () => {
    const bands = barBands(56, BINS, RATE);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].lo).toBe(bands[i - 1].hi);
    }
  });

  it("ни одна полоса не пуста — у каждого бара есть свой бин", () => {
    for (const bars of [16, 32, 56, 96, 128]) {
      for (const band of barBands(bars, BINS, RATE)) {
        expect(band.hi).toBeGreaterThan(band.lo);
      }
    }
  });

  it("не вылезает за спектр и пропускает бин 0 (DC-смещение — не музыка)", () => {
    const bands = barBands(56, BINS, RATE);
    expect(bands[0].lo).toBeGreaterThanOrEqual(1);
    expect(bands[bands.length - 1].hi).toBeLessThanOrEqual(BINS);
  });

  // ─── Собственно починка: шкала логарифмическая, а не линейная ───────────

  it("расширяет полосы к верхам — низы детальнее верхов (лог, а не линейная шкала)", () => {
    // Ширина полосы в бинах = сколько спектра съедает один бар. У линейной
    // шкалы она ОДИНАКОВА у всех (в этом и баг), у лог-шкалы растёт к верхам.
    // Сравниваем третями, а не соседей: бины целые, округление краёв даёт
    // дребезг ±1 (5→4), и требовать монотонности по КАЖДОМУ шагу — требовать
    // неправды.
    const bands = barBands(56, BINS, RATE);
    const avgWidth = (part: typeof bands) =>
      part.reduce((s, b) => s + (b.hi - b.lo), 0) / part.length;
    const third = Math.floor(bands.length / 3);
    const low = avgWidth(bands.slice(0, third));
    const mid = avgWidth(bands.slice(third, 2 * third));
    const high = avgWidth(bands.slice(2 * third));
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid * 4);
    // верхний бар шире нижнего в разы — линейная дала бы равные
    const first = bands[0].hi - bands[0].lo;
    const last = bands[bands.length - 1].hi - bands[bands.length - 1].lo;
    expect(last).toBeGreaterThan(first * 4);
  });

  it("отдаёт середину шкалы музыке, а не хвосту тишины", () => {
    // Жалоба владельца: «вторая сторона почти не шейкается». Корень — линейная
    // раскладка: середина баров попадала в ~7 кГц, где у музыки почти пусто.
    // Середина ЛОГ-шкалы обязана попадать в диапазон, где энергия реально есть.
    const bands = barBands(56, BINS, RATE);
    const middle = bands[Math.floor(bands.length / 2)];
    expect(hz(middle.lo)).toBeLessThan(2000);
  });

  it("верхний бар доходит до верхов, но не в ультразвук", () => {
    const bands = barBands(56, BINS, RATE);
    const top = hz(bands[bands.length - 1].hi);
    expect(top).toBeGreaterThan(12000);
    expect(top).toBeLessThanOrEqual(18000);
  });

  it("нижний бар начинается на басах (десятки Гц)", () => {
    const bands = barBands(56, BINS, RATE);
    expect(hz(bands[0].lo)).toBeLessThan(60);
  });

  it("держит другой sampleRate (44100) в пределах спектра", () => {
    const bands = barBands(56, BINS, 44100);
    expect(bands[bands.length - 1].hi).toBeLessThanOrEqual(BINS);
    for (const b of bands) expect(b.hi).toBeGreaterThan(b.lo);
  });

  it("не ломается, когда баров больше, чем бинов (вырожденный случай)", () => {
    const bands = barBands(64, 32, RATE);
    expect(bands).toHaveLength(64);
    for (const b of bands) {
      expect(b.hi).toBeGreaterThan(b.lo);
      expect(b.hi).toBeLessThanOrEqual(32);
      expect(b.lo).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("bandIndexForBar / bandCount — зеркало", () => {
  it("без зеркала — тождество, полос столько же, сколько баров", () => {
    expect(bandCount(56, false)).toBe(56);
    for (const i of [0, 1, 27, 55]) expect(bandIndexForBar(i, 56, false)).toBe(i);
  });

  it("с зеркалом полос вдвое меньше", () => {
    expect(bandCount(56, true)).toBe(28);
    expect(bandCount(55, true)).toBe(28);
  });

  it("зеркалит: бары, равноудалённые от центра, читают одну полосу", () => {
    for (const bars of [56, 55]) {
      for (let i = 0; i < bars; i++) {
        expect(bandIndexForBar(i, bars, true)).toBe(bandIndexForBar(bars - 1 - i, bars, true));
      }
    }
  });

  it("кладёт низы в центр, верхи по краям", () => {
    expect(bandIndexForBar(27, 56, true)).toBe(0);
    expect(bandIndexForBar(28, 56, true)).toBe(0);
    expect(bandIndexForBar(0, 56, true)).toBe(27);
    expect(bandIndexForBar(55, 56, true)).toBe(27);
  });

  it("покрывает все полосы без дыр и не выходит за их число", () => {
    for (const bars of [56, 55, 24, 7]) {
      const n = bandCount(bars, true);
      const seen = new Set<number>();
      for (let i = 0; i < bars; i++) {
        const b = bandIndexForBar(i, bars, true);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(n);
        seen.add(b);
      }
      expect(seen.size).toBe(n);
    }
  });
});

describe("waveShape — сглаживание волны", () => {
  const LEN = 2048;

  it("отдаёт ровно points точек", () => {
    expect(waveShape(sineBytes(LEN, 480), 128, 0.6)).toHaveLength(128);
    expect(waveShape(sineBytes(LEN, 480), 64, 0)).toHaveLength(64);
  });

  it("без сглаживания — честное прореживание: края берутся как есть", () => {
    const bytes = sineBytes(LEN, 480);
    const out = waveShape(bytes, 128, 0);
    expect(out[0]).toBeCloseTo((bytes[0] - 128) / 128, 5);
    expect(out[out.length - 1]).toBeCloseTo((bytes[LEN - 1] - 128) / 128, 5);
  });

  it("тишина остаётся тишиной (128 = ноль)", () => {
    const flat = new Uint8Array(LEN).fill(128);
    for (const v of waveShape(flat, 128, 1)) expect(v).toBeCloseTo(0, 6);
  });

  it("не сдвигает фазу: симметричный вход → симметричный выход", () => {
    // Окно скользящего среднего ЦЕНТРИРОВАНО — у него нулевая групповая
    // задержка. Несимметричное (одностороннее) окно сдвинуло бы волну вбок.
    const bytes = new Uint8Array(LEN);
    for (let i = 0; i < LEN; i++) {
      const d = Math.abs(i - (LEN - 1) / 2) / ((LEN - 1) / 2); // 0 в центре, 1 по краям
      bytes[i] = Math.round(128 + 100 * (1 - d));
    }
    const out = waveShape(bytes, 65, 0.8);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(out[out.length - 1 - i], 5);
    }
  });

  it("не съедает пики: медленная волна сохраняет амплитуду даже на максимуме сглаживания", () => {
    // 100 Гц при 48 кГц — период 480 сэмплов, много длиннее окна сглаживания.
    const out = waveShape(sineBytes(LEN, 480), 128, 1);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.9);
  });

  it("срезает шумовую пилу — то, из-за чего волна выглядела отвратительно", () => {
    // Пила на частоте Найквиста: ±1 через сэмпл. Именно она рисовалась
    // поверх волны, когда полилиния шла по всем 2048 сэмплам подряд.
    const jag = new Uint8Array(LEN);
    for (let i = 0; i < LEN; i++) jag[i] = i % 2 === 0 ? 255 : 1;
    let peak = 0;
    for (const v of waveShape(jag, 128, 1)) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(0.15);
  });

  it("оставляет значения в пределах канваса (-1..1)", () => {
    const loud = new Uint8Array(LEN);
    for (let i = 0; i < LEN; i++) loud[i] = i % 2 === 0 ? 255 : 0;
    for (const v of waveShape(loud, 128, 0.5)) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("не ломается на вырожденных размерах", () => {
    expect(waveShape(sineBytes(LEN, 480), 1, 0.5)).toHaveLength(1);
    expect(waveShape(new Uint8Array(0), 8, 0.5)).toHaveLength(8);
    expect(waveShape(sineBytes(4, 4), 16, 1)).toHaveLength(16);
  });
});
