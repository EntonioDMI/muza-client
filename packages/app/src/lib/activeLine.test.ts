/** Тестов на выбор активной строки не было вовсе — при том, что это самая
 *  заметная механика текста песни: ошибка здесь видна человеку каждую строку.
 *  Проверяем то, что легко сломать правкой: упреждение, ручной сдвиг, границу
 *  «нотки» и перемотку по строке. */

import { describe, expect, it } from "vitest";
import { activeLyricLine, LYRICS_LEAD_MS, lyricSeekSec } from "./activeLine";

const LINES = [{ t: 0 }, { t: 10 }, { t: 20 }, { t: 30 }];
const on = { synced: true, endNote: false };

describe("activeLyricLine", () => {
  it("не-синхронный текст не подсвечивается вовсе", () => {
    expect(activeLyricLine(15, LINES, { synced: false, endNote: true })).toBe(-1);
  });

  it("строка загорается на упреждение раньше своего таймкода", () => {
    const lead = LYRICS_LEAD_MS / 1000;
    expect(activeLyricLine(10 - lead, LINES, on)).toBe(1);
    // ...но не раньше: упреждение не должно съедать предыдущую строку целиком.
    expect(activeLyricLine(10 - lead - 0.01, LINES, on)).toBe(0);
  });

  it("до первой строки активна первая, а не «никакая»", () => {
    expect(activeLyricLine(0, LINES, on)).toBe(0);
  });

  it("ручной сдвиг двигает подсветку в обе стороны", () => {
    // +1000 мс — «показывать раньше»: на 9.0 уже вторая строка.
    expect(activeLyricLine(9, LINES, { ...on, offsetMs: 1000 })).toBe(1);
    // −1000 мс — «позже»: на 10.5 всё ещё первая (упреждение перекрыто).
    expect(activeLyricLine(10.5, LINES, { ...on, offsetMs: -1000 })).toBe(0);
  });

  it("нотка загорается после выдержки, считая от сдвинутого времени", () => {
    const endNote = { synced: true, endNote: true };
    // Зазор между последними строками 10с → выдержка кламп в 8с.
    expect(activeLyricLine(37, LINES, endNote)).toBe(3);
    expect(activeLyricLine(38.5, LINES, endNote)).toBe(LINES.length);
  });

  it("выдержка последней строки зажата в 2..8 секунд", () => {
    const endNote = { synced: true, endNote: true };
    const dense = [{ t: 0 }, { t: 100 }, { t: 100.5 }]; // зазор 0.5с → пол 2с
    expect(activeLyricLine(101.9, dense, endNote)).toBe(2);
    expect(activeLyricLine(103, dense, endNote)).toBe(dense.length);
  });

  it("пустой список не роняет и не выдумывает строку", () => {
    expect(activeLyricLine(5, [], { synced: true, endNote: true })).toBe(0);
  });
});

describe("lyricSeekSec", () => {
  it("упреждение НЕ вычитается — оно про показ, а не про звук", () => {
    expect(lyricSeekSec(30)).toBe(30);
  });

  it("ручной сдвиг вычитается: клик по строке попадает туда же, где подсветка", () => {
    expect(lyricSeekSec(30, 1500)).toBe(28.5);
    expect(lyricSeekSec(30, -1500)).toBe(31.5);
  });

  it("не уводит в отрицательное время у первых строк", () => {
    expect(lyricSeekSec(0.5, 3000)).toBe(0);
  });
});
