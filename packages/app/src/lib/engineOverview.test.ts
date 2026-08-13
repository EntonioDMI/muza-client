/** Сторож обзора состояния включения треков.
 *
 *  Здесь проверяется не арифметика ради арифметики, а те различия, ради
 *  которых обзор и заведён: перебитый старт против сбоя, «сломано сейчас»
 *  против «сбоило и прошло», молчание вместо правдоподобной цифры. Ошибка в
 *  любом из них означает, что экран будет уверенно показывать неправду, — а
 *  это хуже, чем не показывать ничего. */

import { describe, expect, it } from "vitest";
import type { SearchSourceHealth } from "@muza/api-client";
import type { TrackStartRecord } from "../platform";
import { buildOverview, compressJournal, RECENT_WINDOW } from "./engineOverview";

let clock = 1_000_000;
function start(patch: Partial<TrackStartRecord> = {}): TrackStartRecord {
  clock += 1000;
  return {
    trackId: `t${clock}`,
    title: "Песня",
    reason: "manual",
    at: clock,
    sourcesMs: 20,
    urlMs: 200,
    path: "resolve",
    playCallMs: 260,
    soundMs: 500,
    error: null,
    silenceMs: 5,
    cls: "soundcloud",
    cold: false,
    ...patch,
  };
}

/** Записи приходят НОВЫМИ ПЕРВЫМИ — как их отдаёт площадка. */
const newestFirst = (records: TrackStartRecord[]) => [...records].reverse();

const source = (patch: Partial<SearchSourceHealth> = {}): SearchSourceHealth => ({
  source: "youtube:music",
  attempts: 10,
  ok: 10,
  empty: 0,
  failed: 0,
  medianMs: 400,
  avgCount: 8,
  lastFailure: null,
  lastOkAt: 5000,
  failureRate: 0,
  ...patch,
});

describe("вердикт", () => {
  it("нечего сказать — значит всё в порядке, и список причин пуст", () => {
    const o = buildOverview({ starts: newestFirst([start(), start(), start()]), health: null, searchSources: [] });
    expect(o.level).toBe("ok");
    expect(o.notes).toEqual([]);
  });

  it("⚠️ перебитый следующим нажатием — НЕ сбой: человек сам переключил", () => {
    // Склей их, и обычное перелистывание плейлиста объявит аварию.
    const records = Array.from({ length: 10 }, () => start({ error: "superseded", soundMs: null }));
    const o = buildOverview({ starts: newestFirst(records), health: null, searchSources: [] });
    expect(o.failed).toBe(0);
    expect(o.interrupted).toBe(10);
    expect(o.level).toBe("ok");
  });

  it("каждый пятый не заиграл — это авария, и она названа числами", () => {
    const records = [
      ...Array.from({ length: 8 }, () => start()),
      ...Array.from({ length: 2 }, () => start({ error: "нет сети", soundMs: null })),
    ];
    const o = buildOverview({ starts: newestFirst(records), health: null, searchSources: [] });
    expect(o.level).toBe("bad");
    expect(o.notes[0]).toMatchObject({ key: "someDidNotPlay", params: { failed: 2, total: 10 } });
  });

  it("одна неудача из двух не поднимает тревогу — выборки ещё нет", () => {
    const o = buildOverview({
      starts: newestFirst([start(), start({ error: "нет сети", soundMs: null })]),
      health: null,
      searchSources: [],
    });
    expect(o.level).toBe("ok");
  });

  it("⚠️ место поиска, молчащее СЕЙЧАС, — первая строка вердикта", () => {
    // Ровно эта слепота стоила месяцев однобокой выдачи: YouTube не
    // резолвился, поиск отдавал остаток и молчал об этом.
    const o = buildOverview({
      starts: newestFirst([start()]),
      health: null,
      searchSources: [source({ failed: 4, ok: 6, failureRate: 0.4, lastOkAt: 1000, lastFailure: { reason: "имя не разрешилось", at: 9000 } })],
    });
    expect(o.level).toBe("bad");
    expect(o.notes[0]).toMatchObject({ key: "searchPlaceDown", params: { place: "youtube:music" } });
    expect(o.searchPlaces[0].downNow).toBe(true);
  });

  it("сбоило, но починилось — тревоги нет, хотя доля отказов та же", () => {
    const o = buildOverview({
      starts: newestFirst([start()]),
      health: null,
      searchSources: [source({ failed: 4, ok: 6, failureRate: 0.4, lastOkAt: 9000, lastFailure: { reason: "имя не разрешилось", at: 1000 } })],
    });
    expect(o.searchPlaces[0].downNow).toBe(false);
    expect(o.level).toBe("warn");
    expect(o.notes[0].key).toBe("searchPlaceShaky");
  });

  it("шаткое место поиска не оттесняет настоящую аварию наверх списка", () => {
    const records = [
      ...Array.from({ length: 6 }, () => start()),
      ...Array.from({ length: 4 }, () => start({ error: "нет сети", soundMs: null })),
    ];
    const o = buildOverview({
      starts: newestFirst(records),
      health: null,
      searchSources: [source({ failed: 1, ok: 9, failureRate: 0.1, lastOkAt: 9000, lastFailure: { reason: "разок не ответил", at: 1000 } })],
    });
    expect(o.notes.map((n) => n.key)).toEqual(["someDidNotPlay"]);
  });
});

describe("числа", () => {
  it("считаются только по доигравшим до звука", () => {
    const o = buildOverview({
      starts: newestFirst([
        start({ soundMs: 400, playCallMs: 300, urlMs: 200, sourcesMs: 20 }),
        start({ soundMs: 600, playCallMs: 300, urlMs: 200, sourcesMs: 20 }),
        start({ error: "нет сети", soundMs: null }),
      ]),
      health: null,
      searchSources: [],
    });
    expect(o.typicalMs).toBe(500);
  });

  it("нечем ответить — null, а не ноль", () => {
    // Ноль читался бы как «включается мгновенно», то есть ровно наоборот.
    const o = buildOverview({
      starts: newestFirst([start({ error: "нет сети", soundMs: null })]),
      health: null,
      searchSources: [],
    });
    expect(o.typicalMs).toBeNull();
    expect(o.coldMs).toBeNull();
    expect(o.phases).toEqual([]);
  });

  it("первый после запуска — САМЫЙ СВЕЖИЙ такой, а не усреднение по всем", () => {
    const o = buildOverview({
      starts: newestFirst([start({ cold: true, soundMs: 4000 }), start(), start({ cold: true, soundMs: 2500 })]),
      health: null,
      searchSources: [],
    });
    expect(o.coldMs).toBe(2500);
  });

  it("шаг, которого не было, в полосу не попадает", () => {
    const o = buildOverview({
      starts: newestFirst([start({ sourcesMs: null, urlMs: 200, playCallMs: 260, soundMs: 500 })]),
      health: null,
      searchSources: [],
    });
    expect(o.phases.map((p) => p.key)).toEqual(["url", "engine", "bytes"]);
  });

  it("разбирается только окно последних включений, а не весь журнал", () => {
    const records = Array.from({ length: RECENT_WINDOW + 25 }, () => start());
    const o = buildOverview({ starts: newestFirst(records), health: null, searchSources: [] });
    expect(o.total).toBe(RECENT_WINDOW);
    expect(o.recent).toHaveLength(RECENT_WINDOW);
  });

  it("лента идёт старым слева: время течёт вправо", () => {
    const a = start({ title: "первая" });
    const b = start({ title: "вторая" });
    const o = buildOverview({ starts: newestFirst([a, b]), health: null, searchSources: [] });
    expect(o.recent.map((r) => r.title)).toEqual(["первая", "вторая"]);
  });
});

describe("группировка", () => {
  it("места складываются по укрупнённым группам, неизвестное — в «остальное»", () => {
    const o = buildOverview({
      starts: newestFirst([
        start({ cls: "soundcloud" }),
        start({ cls: "soundcloud" }),
        start({ cls: "youtube" }),
        start({ cls: "preloaded" }),
      ]),
      health: null,
      searchSources: [],
    });
    expect(o.places).toEqual([
      { key: "soundcloud", count: 2, failed: 0 },
      { key: "other", count: 1, failed: 0 },
      { key: "youtube", count: 1, failed: 0 },
    ]);
  });

  it("приставка холодного старта не заводит отдельное место", () => {
    const o = buildOverview({
      starts: newestFirst([start({ cls: "cold:soundcloud" }), start({ cls: "soundcloud" })]),
      health: null,
      searchSources: [],
    });
    expect(o.places).toEqual([{ key: "soundcloud", count: 2, failed: 0 }]);
  });

  it("одинаковые причины — одной строкой, различаются только хвостами", () => {
    const o = buildOverview({
      starts: newestFirst([
        start({ error: "не удалось получить трек — id 111", soundMs: null }),
        start({ error: "не удалось получить трек — id 222", soundMs: null }),
        start({ error: "нет места на диске", soundMs: null }),
      ]),
      health: null,
      searchSources: [],
    });
    expect(o.failures).toEqual([
      { reason: "не удалось получить трек", count: 2, lastAt: expect.any(Number) },
      { reason: "нет места на диске", count: 1, lastAt: expect.any(Number) },
    ]);
  });
});

describe("сжатый журнал", () => {
  it("одна авария — одна строка со счётчиком, а не двадцать строк", () => {
    const out = compressJournal([
      { at_ms: 1, text: "сбой быстрого пути: YouTube требует вход — деталь A" },
      { at_ms: 2, text: "сбой быстрого пути: YouTube требует вход — деталь B" },
      { at_ms: 3, text: "быстрый путь на паузе" },
    ]);
    expect(out).toEqual([
      { head: "быстрый путь на паузе", detail: "", count: 1, lastAt: 3 },
      { head: "сбой быстрого пути: YouTube требует вход", detail: "деталь B", count: 2, lastAt: 2 },
    ]);
  });

  it("хвост берётся у самого свежего события — старый уже разобран", () => {
    const out = compressJournal([
      { at_ms: 9, text: "сбой — свежая зацепка" },
      { at_ms: 1, text: "сбой — древняя зацепка" },
    ]);
    expect(out[0]).toMatchObject({ detail: "свежая зацепка", count: 2, lastAt: 9 });
  });
});
