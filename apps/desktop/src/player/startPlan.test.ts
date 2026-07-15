/** Правило «глушить ли играющий трек перед добычей нового» (startPlan.ts).
 *
 *  Сам факт вызова этого правила из usePlayback.startAt и его последствия для
 *  движка проверяет usePlayback.test.ts (шпионы play/pause) — здесь только
 *  чистая таблица решений, как gaplessPlan.test.ts для planAutoAdvance. */

import { describe, expect, it } from "vitest";
import { shouldSilenceBeforeResolve } from "./startPlan";

describe("shouldSilenceBeforeResolve", () => {
  it("ручное переключение с добычей — глушим (жалоба владельца 2026-07-15)", () => {
    expect(shouldSilenceBeforeResolve({ auto: false, preloaded: false })).toBe(true);
  });

  it("авто-переход (кроссфейд/gapless) — НЕ глушим: старому треку перетекать в новый", () => {
    expect(shouldSilenceBeforeResolve({ auto: true, preloaded: false })).toBe(false);
  });

  it("преднагруженный трек — НЕ глушим: резолва нет, play идёт тем же тиком", () => {
    expect(shouldSilenceBeforeResolve({ auto: false, preloaded: true })).toBe(false);
  });

  it("авто-переход на преднагруженном (честный gapless) — НЕ глушим", () => {
    expect(shouldSilenceBeforeResolve({ auto: true, preloaded: true })).toBe(false);
  });
});
