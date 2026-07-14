import { describe, expect, it } from "vitest";
import {
  CROSSFADE_SEC,
  GAPLESS_LEAD_SEC,
  GAPLESS_XFADE_SEC,
  nextPollDelayMs,
  pickAutoFadeSec,
  planAutoAdvance,
  type AutoAdvanceInput,
} from "./gaplessPlan";

const base: AutoAdvanceInput = {
  remaining: 10,
  crossfadeEnabled: false,
  gaplessEnabled: false,
  repeatOne: false,
  hasNext: true,
  alreadyAdvanced: false,
};

describe("planAutoAdvance — оба выключены", () => {
  it("никогда не триггерит, даже у самого конца трека", () => {
    expect(planAutoAdvance({ ...base, remaining: 0.01 })).toEqual({ trigger: false, fadeSec: 0 });
  });
});

describe("planAutoAdvance — crossfade", () => {
  it("не триггерит, пока до конца больше окна", () => {
    expect(planAutoAdvance({ ...base, crossfadeEnabled: true, remaining: CROSSFADE_SEC + 0.1 }).trigger).toBe(false);
  });

  it("триггерит внутри окна (CROSSFADE_SEC .. margin)", () => {
    const plan = planAutoAdvance({ ...base, crossfadeEnabled: true, remaining: CROSSFADE_SEC - 0.5 });
    expect(plan).toEqual({ trigger: true, fadeSec: CROSSFADE_SEC });
  });

  it("не триггерит впритык к самому концу (нижняя граница margin)", () => {
    expect(planAutoAdvance({ ...base, crossfadeEnabled: true, remaining: 0.1 }).trigger).toBe(false);
  });
});

describe("planAutoAdvance — gapless", () => {
  it("не триггерит, пока до конца больше lead-окна", () => {
    expect(planAutoAdvance({ ...base, gaplessEnabled: true, remaining: GAPLESS_LEAD_SEC + 0.01 }).trigger).toBe(false);
  });

  it("триггерит внутри lead-окна с коротким micro-fade", () => {
    const plan = planAutoAdvance({ ...base, gaplessEnabled: true, remaining: GAPLESS_LEAD_SEC - 0.05 });
    expect(plan).toEqual({ trigger: true, fadeSec: GAPLESS_XFADE_SEC });
  });

  it("не триггерит после фактического конца (remaining <= 0)", () => {
    expect(planAutoAdvance({ ...base, gaplessEnabled: true, remaining: 0 }).trigger).toBe(false);
    expect(planAutoAdvance({ ...base, gaplessEnabled: true, remaining: -0.2 }).trigger).toBe(false);
  });
});

describe("planAutoAdvance — приоритет crossfade над gapless", () => {
  it("при обоих включённых внутри crossfade-окна работает длинный кроссфейд, а не micro-fade", () => {
    // GAPLESS_LEAD_SEC < CROSSFADE_TRIGGER_MARGIN_SEC — окна не пересекаются на числовой
    // прямой, так что здесь проверяем сам порядок проверки веток: crossfade проверяется
    // первым и решает исход, даже когда gapless тоже включён.
    const plan = planAutoAdvance({
      ...base,
      crossfadeEnabled: true,
      gaplessEnabled: true,
      remaining: CROSSFADE_SEC - 1,
    });
    expect(plan).toEqual({ trigger: true, fadeSec: CROSSFADE_SEC });
  });

  it("пока crossfade включён, gapless-ветка не подхватывает даже вне crossfade-окна (нижний margin)", () => {
    // remaining=0.1 — внутри gapless-lead, но ниже crossfade-margin: раз crossfade включён,
    // приоритет за ним целиком (см. !input.crossfadeEnabled в gapless-ветке) — переход не запускается,
    // трек естественно доиграет и пойдёт обычный (не-фейдовый) переход по onEnded.
    const plan = planAutoAdvance({ ...base, crossfadeEnabled: true, gaplessEnabled: true, remaining: 0.1 });
    expect(plan.trigger).toBe(false);
  });
});

describe("planAutoAdvance — защитные условия", () => {
  it("repeat one — не триггерит независимо от префов", () => {
    expect(planAutoAdvance({ ...base, gaplessEnabled: true, repeatOne: true, remaining: 0.1 }).trigger).toBe(false);
  });

  it("конец очереди (hasNext=false) — не триггерит", () => {
    expect(planAutoAdvance({ ...base, gaplessEnabled: true, hasNext: false, remaining: 0.1 }).trigger).toBe(false);
  });

  it("уже запущен ранний переход для этого pos — повторно не триггерит", () => {
    expect(planAutoAdvance({ ...base, gaplessEnabled: true, alreadyAdvanced: true, remaining: 0.1 }).trigger).toBe(
      false,
    );
  });
});

describe("GAPLESS_LEAD_SEC — T19 fast-follow: узкое окно, не костыль под грубый timeupdate", () => {
  it("остаётся вплотную к micro-fade, а не в 30 раз шире (регресс на 1.5с)", () => {
    // Точный триггер (usePlayback.pollGapless, self-adjusting setTimeout от
    // engine().position()) делает широкое окно ненужным — если кто-то в
    // будущем накрутит LEAD обратно "для надёжности", этот тест напомнит,
    // что задача ревью #2 была ровно обратной.
    expect(GAPLESS_LEAD_SEC).toBeGreaterThan(GAPLESS_XFADE_SEC);
    expect(GAPLESS_LEAD_SEC).toBeLessThanOrEqual(0.15);
  });
});

describe("nextPollDelayMs — T19-fix: чистая формула планировщика usePlayback.pollGapless", () => {
  it("далеко от конца — грубый большой прыжок до (remaining − lead)", () => {
    // 10с до конца, lead=2с, шаг=20мс → ждём (10-2)*1000 = 8000мс, не шаг
    expect(nextPollDelayMs(10, 2, 20)).toBe(8000);
  });

  it("только перешли порог — расчёт от свежего remaining, не залипает на старом", () => {
    // 2.5с до конца, lead=2с → (2.5-2)*1000 = 500мс — корректный пересчёт у самой границы
    expect(nextPollDelayMs(2.5, 2, 20)).toBe(500);
  });

  it("внутри lead-окна — фиксированный тесный шаг", () => {
    expect(nextPollDelayMs(1, 2, 20)).toBe(20);
    expect(nextPollDelayMs(0.05, 2, 20)).toBe(20);
  });

  it("край: remaining === lead — уже тесный шаг (не грубый прыжок в 0мс)", () => {
    expect(nextPollDelayMs(2, 2, 20)).toBe(20);
  });

  it("край: remaining === 0 (трек физически закончился) — тесный шаг", () => {
    expect(nextPollDelayMs(0, 2, 20)).toBe(20);
  });

  it("край: remaining отрицательный (таймер снаружи ещё не остановили) — всё ещё тесный шаг, не отрицательная задержка", () => {
    expect(nextPollDelayMs(-0.5, 2, 20)).toBe(20);
  });
});

describe("pickAutoFadeSec", () => {
  it("crossfade приоритетнее gapless", () => {
    expect(pickAutoFadeSec({ crossfade: true, gapless: true })).toBe(CROSSFADE_SEC);
  });

  it("только gapless — короткий micro-fade", () => {
    expect(pickAutoFadeSec({ crossfade: false, gapless: true })).toBe(GAPLESS_XFADE_SEC);
  });

  it("оба выключены — 0 (мгновенный переход, обратная совместимость)", () => {
    expect(pickAutoFadeSec({ crossfade: false, gapless: false })).toBe(0);
  });
});
