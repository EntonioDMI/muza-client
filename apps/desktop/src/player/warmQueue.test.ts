/** Очередь прогрева (Фаза 1, спека 2026-07-16): порядок важнее охвата —
 *  экран из 20 треков греется ~35с, и на первый клик по свежему экрану
 *  прогрев может не успеть (это нормально). Отсюда приоритеты: hover (курсор
 *  приходит раньше клика) > видимые строки сверху вниз > очередь
 *  воспроизведения. Лимиты — решение владельца, ЖЁСТКИЙ режим: бот-детект
 *  бьёт по IP и ломает ВСЮ добычу, не только прогрев.
 *
 *  Тесты ходят реальным путём класса (fake timers + управляемые промисы
 *  прогрева), а не по мокам самих проверяемых веток. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WARM_FAIL_COOLDOWN_MS,
  WARM_PARALLELISM,
  WARM_RATE_PER_HOUR,
  WARM_RATE_PER_MINUTE,
  WARM_VISIBLE_DWELL_MS,
  WarmQueue,
  type WarmOutcome,
} from "./warmQueue";

/** Управляемые прогревы: started — порядок реальных запусков, finish/fail —
 *  завершение конкретного id (стенд вместо живого yt-dlp --simulate). */
function testRuns() {
  const started: string[] = [];
  const resolvers = new Map<string, (o: WarmOutcome) => void>();
  const rejecters = new Map<string, (e: unknown) => void>();
  const run = vi.fn(
    (id: string) =>
      new Promise<WarmOutcome>((resolve, reject) => {
        started.push(id);
        resolvers.set(id, resolve);
        rejecters.set(id, reject);
      }),
  );
  return {
    run,
    started,
    finish: async (id: string, outcome: WarmOutcome = "warmed") => {
      resolvers.get(id)?.(outcome);
      await vi.advanceTimersByTimeAsync(0);
    },
    fail: async (id: string) => {
      rejecters.get(id)?.(new Error("прогрев упал"));
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WarmQueue: приоритет", () => {
  it("hover обгоняет видимое, видимое — очередь (в любом порядке заявок)", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run, { parallelism: 1 });
    // блокер занимает единственный слот, пока копятся заявки
    q.request("block", "queue");
    await vi.advanceTimersByTimeAsync(0);
    // заявки нарочно в обратном порядке важности
    q.request("из-очереди", "queue");
    q.request("видимый", "visible");
    q.request("под-курсором", "hover");
    // dwell видимости дожидаемся, пока блокер ещё держит слот, — приоритеты
    // сравниваются на реальных заявках
    await vi.advanceTimersByTimeAsync(WARM_VISIBLE_DWELL_MS);
    await t.finish("block");
    await t.finish("под-курсором");
    await t.finish("видимый");
    await t.finish("из-очереди");
    expect(t.started).toEqual(["block", "под-курсором", "видимый", "из-очереди"]);
    q.dispose();
  });

  it("hover по уже ждущему треку поднимает его в голову", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run, { parallelism: 1 });
    q.request("block", "queue");
    await vi.advanceTimersByTimeAsync(0);
    q.request("a", "queue");
    q.request("b", "queue");
    q.request("b", "hover"); // курсор пришёл на строку b
    await t.finish("block");
    await t.finish("b");
    // суть — порядок: b (hover-апгрейд) стартует раньше a; освободившийся
    // слот дальше честно продолжает качать очередь (a тоже стартует)
    expect(t.started).toEqual(["block", "b", "a"]);
    q.dispose();
  });
});

describe("WarmQueue: сигнал доезжает до прогрева", () => {
  /** Rust (engine_warm) различает сигналы: в кулдауне circuit-breaker'а
   *  visible-прогрев не имеет права доваливаться в yt-dlp simulate
   *  (CPU-лавина 2026-07-19), hover/queue — можно. Поэтому run обязан
   *  получать сигнал ПОБЕДИВШЕЙ заявки, включая hover-апгрейд ждущей. */
  it("run получает сигнал заявки; hover-апгрейд меняет и сигнал", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run, { parallelism: 1 });
    q.request("block", "queue");
    await vi.advanceTimersByTimeAsync(0);
    q.request("видимый", "visible");
    q.request("апгрейд", "visible");
    q.request("апгрейд", "hover"); // курсор пришёл на ждущую строку
    await t.finish("block");
    await t.finish("апгрейд");
    await vi.advanceTimersByTimeAsync(WARM_VISIBLE_DWELL_MS); // dwell «видимого»
    await t.finish("видимый");
    expect(t.run).toHaveBeenCalledWith("block", "queue");
    expect(t.run).toHaveBeenCalledWith("апгрейд", "hover");
    expect(t.run).toHaveBeenCalledWith("видимый", "visible");
    q.dispose();
  });
});

describe("WarmQueue: лимиты (жёсткий режим — решение владельца)", () => {
  it("параллелизм ≤ 2 по умолчанию", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run);
    // сигнал queue: тест про лимит слотов, dwell видимости здесь ни при чём
    for (const id of ["a", "b", "c", "d"]) q.request(id, "queue");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.started).toEqual(["a", "b"]);
    expect(WARM_PARALLELISM).toBe(2);
    await t.finish("a");
    expect(t.started).toEqual(["a", "b", "c"]);
    q.dispose();
  });

  it("не больше 30 прогревов в минуту, хвост уходит после сдвига окна", async () => {
    const t = testRuns();
    // parallelism выше лимита, чтобы упереться именно в окно
    const q = new WarmQueue(t.run, { parallelism: 100 });
    for (let i = 0; i < 35; i++) q.request(`t${i}`, "queue");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.started).toHaveLength(WARM_RATE_PER_MINUTE);
    expect(WARM_RATE_PER_MINUTE).toBe(30);
    // окно скользящее: через минуту+ хвост стартует сам, без новых заявок
    await vi.advanceTimersByTimeAsync(61_000);
    expect(t.started).toHaveLength(35);
    q.dispose();
  });
});

describe("WarmQueue: dwell видимости и часовое окно (2026-07-19)", () => {
  /** Быстрый скролл поиска раньше генерировал заявку на КАЖДУЮ мелькнувшую
   *  строку (118 результатов → волна прогрева → бот-гейт → CPU-лавина
   *  yt-dlp-фолбэков). Видимость становится заявкой только после
   *  WARM_VISIBLE_DWELL_MS непрерывной видимости; hover/queue — сразу. */
  it("visible становится заявкой только после непрерывной видимости", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run);
    q.request("a", "visible");
    await vi.advanceTimersByTimeAsync(WARM_VISIBLE_DWELL_MS - 1);
    expect(t.started).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.started).toEqual(["a"]);
    expect(WARM_VISIBLE_DWELL_MS).toBe(1500);
    q.dispose();
  });

  it("уход с экрана до истечения dwell снимает заявку (скролл бесплатен)", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run);
    q.request("a", "visible");
    await vi.advanceTimersByTimeAsync(1000);
    q.cancel("a");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.started).toEqual([]);
    q.dispose();
  });

  it("hover по ждущему dwell продвигает мгновенно и с hover-сигналом", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run);
    q.request("a", "visible");
    await vi.advanceTimersByTimeAsync(100);
    q.request("a", "hover");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.started).toEqual(["a"]);
    expect(t.run).toHaveBeenCalledWith("a", "hover");
    q.dispose();
  });

  /** 30/мин без часового капа = до 1800/час при лимите гостевой сессии
   *  YouTube ~300 видео/час — долгая сессия скролла сама загоняла IP под
   *  бот-гейт. Второе скользящее окно ограничивает час. */
  it("часовое окно: сверх WARM_RATE_PER_HOUR не стартует, хвост уходит после сдвига", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run, { parallelism: 1000, ratePerMinute: 1000 });
    for (let i = 0; i < 125; i++) q.request(`h${i}`, "hover");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.started).toHaveLength(WARM_RATE_PER_HOUR);
    expect(WARM_RATE_PER_HOUR).toBe(120);
    await vi.advanceTimersByTimeAsync(3_600_001);
    expect(t.started).toHaveLength(125);
    q.dispose();
  });
});

describe("WarmQueue: отмена и дедупликация", () => {
  it("отмена при уходе строки с экрана — ждущая заявка не запускается", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run, { parallelism: 1 });
    q.request("block", "queue");
    await vi.advanceTimersByTimeAsync(0);
    q.request("ушёл-с-экрана", "visible");
    q.cancel("ушёл-с-экрана");
    await t.finish("block");
    expect(t.started).toEqual(["block"]);
    q.dispose();
  });

  it("уже прогретый не дёргается повторно", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run);
    q.request("a", "hover");
    await t.finish("a", "warmed");
    q.request("a", "hover");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.run).toHaveBeenCalledTimes(1);
    q.dispose();
  });

  it("уже закэшированный не дёргается повторно", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run);
    q.request("a", "hover");
    await t.finish("a", "cached");
    q.request("a", "hover");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.run).toHaveBeenCalledTimes(1);
    q.dispose();
  });

  it("заявка на трек в полёте не плодит второй прогрев", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run);
    q.request("a", "visible");
    await vi.advanceTimersByTimeAsync(0);
    q.request("a", "hover");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.run).toHaveBeenCalledTimes(1);
    q.dispose();
  });

  it("ошибка прогрева не долбит повторно до кулдауна, после — можно", async () => {
    const t = testRuns();
    const q = new WarmQueue(t.run);
    q.request("a", "hover");
    await t.fail("a");
    q.request("a", "hover");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(WARM_FAIL_COOLDOWN_MS + 1);
    q.request("a", "hover");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.run).toHaveBeenCalledTimes(2);
    q.dispose();
  });
});
