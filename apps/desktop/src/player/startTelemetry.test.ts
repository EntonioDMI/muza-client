import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginStart,
  getStartLog,
  getStartSummary,
  getStartTsv,
  markClass,
  markError,
  markPlayCall,
  markSilence,
  markSound,
  markSources,
  markTimings,
  markUrl,
  resetStartTelemetryForTests,
  subscribeStartLog,
} from "./startTelemetry";
import { buildStartTsv, phaseMs, startClass, summarizeStarts, type StartRecord } from "../lib/startLog";

/** Ключ хранилища намеренно записан здесь СТРОКОЙ, а не импортом: это
 *  договорённость с внешним миром (журнал переживает перезапуск именно под
 *  этим именем), и тест обязан ломаться при её тихой смене. */
const KEY = "muza.starts.v1";

beforeEach(() => resetStartTelemetryForTests());
afterEach(() => vi.useRealTimers());

/** Запись журнала с нужными полями — остальные пустые, как у оборвавшегося
 *  старта. */
const rec = (over: Partial<StartRecord> = {}): StartRecord => ({
  trackId: "t",
  title: "Трек",
  reason: "manual",
  at: new Date(2026, 7, 5, 12, 0, 0, 0).getTime(),
  sourcesMs: null,
  urlMs: null,
  path: null,
  playCallMs: null,
  soundMs: null,
  error: null,
  ...over,
});

describe("startTelemetry", () => {
  it("пишет фазы старта по порядку и отдаёт свежие первыми", () => {
    beginStart("t1", "Первый", "manual");
    markSources();
    markUrl("stream");
    markPlayCall();
    markSound();
    beginStart("t2", "Второй", "auto");
    const log = getStartLog();
    expect(log.map((r) => r.trackId)).toEqual(["t2", "t1"]);
    const first = log[1];
    expect(first.path).toBe("stream");
    expect(first.sourcesMs).not.toBeNull();
    expect(first.soundMs).not.toBeNull();
    expect(first.error).toBeNull();
  });

  it("незавершённый старт помечается superseded при следующем", () => {
    beginStart("t1", "Первый", "manual");
    markUrl("resolve");
    beginStart("t2", "Второй", "manual");
    const [, prev] = getStartLog();
    expect(prev.error).toBe("superseded");
  });

  it("завершённый звуком старт НЕ помечается superseded", () => {
    beginStart("t1", "Первый", "manual");
    markSound();
    beginStart("t2", "Второй", "manual");
    const [, prev] = getStartLog();
    expect(prev.error).toBeNull();
  });

  it("markSound фиксируется один раз, ошибка не затирает звук", () => {
    beginStart("t1", "Первый", "manual");
    markSound();
    const soundMs = getStartLog()[0].soundMs;
    markSound();
    markError("поздний сбой");
    expect(getStartLog()[0].soundMs).toBe(soundMs);
    expect(getStartLog()[0].error).toBeNull();
  });

  it("кольцо ограничено двумя сотнями и подписчик уведомляется", () => {
    let calls = 0;
    const off = subscribeStartLog(() => calls++);
    for (let i = 0; i < 205; i++) beginStart(`t${i}`, `Трек ${i}`, "manual");
    const log = getStartLog();
    expect(log.length).toBe(200);
    // выбывают САМЫЕ СТАРЫЕ: матрица замера читается сериями подряд
    expect(log[0].trackId).toBe("t204");
    expect(log[199].trackId).toBe("t5");
    expect(calls).toBeGreaterThan(0);
    off();
  });

  it("первый старт после запуска помечен cold, следующие — нет", () => {
    beginStart("t1", "Первый", "manual");
    beginStart("t2", "Второй", "manual");
    const [second, first] = getStartLog();
    expect(first.cold).toBe(true);
    expect(second.cold).toBe(false);
  });

  it("markSilence — отдельная отметка, а не «примерно начало»", () => {
    vi.useFakeTimers();
    beginStart("t1", "Первый", "manual");
    vi.advanceTimersByTime(30);
    markSilence();
    vi.advanceTimersByTime(200);
    markSound();
    const r = getStartLog()[0];
    expect(r.silenceMs).not.toBeNull();
    // окно тишины считается от отметки, а не от начала старта
    expect(phaseMs(r, "silence")).toBe((r.soundMs ?? 0) - (r.silenceMs ?? 0));
    expect(phaseMs(r, "silence")).not.toBe(r.soundMs);
  });

  it("markSilence фиксируется один раз за старт", () => {
    vi.useFakeTimers();
    beginStart("t1", "Первый", "manual");
    markSilence();
    const first = getStartLog()[0].silenceMs;
    vi.advanceTimersByTime(100);
    markSilence();
    expect(getStartLog()[0].silenceMs).toBe(first);
  });
});

describe("startTelemetry: отметки добычи", () => {
  it("принимает пары, объекты и словарь, накапливая их", () => {
    beginStart("t1", "Первый", "manual");
    markTimings([["sc_client_id", 12]]);
    markTimings({ sc_api_v2: 340 });
    markTimings([{ label: "first_chunk_wait", ms: 90 }]);
    expect(getStartLog()[0].timings).toEqual([
      ["sc_client_id", 12],
      ["sc_api_v2", 340],
      ["first_chunk_wait", 90],
    ]);
  });

  it("мусор из добычи не роняет запись", () => {
    beginStart("t1", "Первый", "manual");
    markTimings("ерунда");
    markTimings([["ok", 5], ["без числа", "нет"], null, 42]);
    expect(getStartLog()[0].timings).toEqual([["ok", 5]]);
  });

  it("класс выводится из отметок добычи, если его не назвали", () => {
    expect(startClass(rec({ timings: [["sc_api_v2", 340]] }))).toBe("soundcloud");
    expect(startClass(rec({ timings: [["yt_innertube", 750]] }))).toBe("youtube");
    expect(startClass(rec({ path: "preloaded" }))).toBe("preloaded");
    expect(startClass(rec())).toBe("?");
    // холодный старт — отдельный класс: вопрос ровно в том, насколько он дороже
    expect(startClass(rec({ cold: true, timings: [["sc_probe", 20]] }))).toBe("cold:soundcloud");
  });

  it("явный markClass побеждает вывод по отметкам", () => {
    beginStart("t1", "Первый", "manual"); // первый в запуске — он холодный
    beginStart("t2", "Второй", "manual");
    markTimings({ sc_api_v2: 100 });
    markClass("local");
    expect(startClass(getStartLog()[0])).toBe("local");
    // приставка холодного старта остаётся и поверх явного класса
    markClass("local");
    expect(startClass({ ...getStartLog()[0], cold: true })).toBe("cold:local");
  });
});

describe("журнал переживает перезапуск", () => {
  it("сохранённое поднимается при следующем запуске модуля", () => {
    vi.useFakeTimers();
    beginStart("t1", "Первый", "manual");
    markSound();
    beginStart("t2", "Второй", "auto");
    markSound();
    vi.advanceTimersByTime(1000);
    expect(window.localStorage.getItem(KEY)).toBeTruthy();
    // «перезагрузка окна»: модуль поднимается заново, хранилище остаётся
    resetStartTelemetryForTests({ keepStored: true });
    expect(getStartLog().map((r) => r.trackId)).toEqual(["t2", "t1"]);
  });

  it("запись откладывается, пока старт в полёте, и всё же доезжает", () => {
    vi.useFakeTimers();
    beginStart("t1", "Первый", "manual");
    // старт ещё идёт — синхронной записи в измеряемом участке быть не должно
    vi.advanceTimersByTime(1000);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    markSound();
    vi.advanceTimersByTime(1000);
    expect(window.localStorage.getItem(KEY)).toBeTruthy();
  });

  it("зависший старт не отменяет запись навсегда", () => {
    vi.useFakeTimers();
    beginStart("t1", "Первый", "manual");
    vi.advanceTimersByTime(8000); // потолок откладывания — 6с
    expect(window.localStorage.getItem(KEY)).toBeTruthy();
  });

  it("уход окна дописывает последний старт немедленно", () => {
    vi.useFakeTimers();
    beginStart("t1", "Первый", "manual");
    markSound();
    expect(window.localStorage.getItem(KEY)).toBeNull(); // окно склейки ещё открыто
    window.dispatchEvent(new Event("pagehide"));
    expect(window.localStorage.getItem(KEY)).toBeTruthy();
  });

  it("несколько отметок одного старта склеиваются в одну запись", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    beginStart("t1", "Первый", "manual");
    markSources();
    markUrl("stream");
    markPlayCall();
    markSound();
    vi.advanceTimersByTime(1000);
    expect(spy.mock.calls.filter(([k]) => k === KEY).length).toBe(1);
    spy.mockRestore();
  });

  it("битое хранилище не роняет журнал", () => {
    window.localStorage.setItem(KEY, "{это не json");
    expect(getStartLog()).toEqual([]);
  });

  it("битые записи выбрасываются поштучно, целые читаются", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([{ at: 1, trackId: "ok", title: "Т", reason: "manual" }, { нет: "времени" }, "строка", null]),
    );
    const log = getStartLog();
    expect(log.length).toBe(1);
    expect(log[0].trackId).toBe("ok");
    // запись СТАРОГО клиента (без timings/silence/cls) обязана читаться как есть
    expect(log[0].timings).toBeUndefined();
    expect(log[0].silenceMs).toBeNull();
  });

  it("хранилище обрезается до размера кольца", () => {
    const many = Array.from({ length: 260 }, (_, i) => ({ ...rec({ trackId: `t${i}` }) }));
    window.localStorage.setItem(KEY, JSON.stringify(many));
    const log = getStartLog();
    expect(log.length).toBe(200);
    expect(log[0].trackId).toBe("t259"); // свежие первыми
  });
});

describe("разбор журнала: фазы", () => {
  it("фазы — это разности, а не сырые моменты", () => {
    const r = rec({ sourcesMs: 20, urlMs: 900, playCallMs: 950, soundMs: 1200, silenceMs: 5 });
    expect(phaseMs(r, "sources")).toBe(20);
    expect(phaseMs(r, "url")).toBe(880);
    expect(phaseMs(r, "engine")).toBe(50);
    expect(phaseMs(r, "bytes")).toBe(250);
    expect(phaseMs(r, "silence")).toBe(1195);
    expect(phaseMs(r, "total")).toBe(1200);
  });

  it("без источников добыча ссылки считается от клика", () => {
    expect(phaseMs(rec({ urlMs: 300 }), "url")).toBe(300);
  });

  it("не случившиеся фазы дают null, а не ноль", () => {
    const r = rec({ sourcesMs: 20 });
    expect(phaseMs(r, "url")).toBeNull();
    expect(phaseMs(r, "engine")).toBeNull();
    expect(phaseMs(r, "bytes")).toBeNull();
    expect(phaseMs(r, "silence")).toBeNull();
    expect(phaseMs(r, "total")).toBeNull();
  });
});

describe("разбор журнала: медиана и p90", () => {
  it("пустой журнал даёт пустую сводку", () => {
    expect(summarizeStarts([])).toEqual([]);
    expect(getStartSummary()).toEqual([]);
  });

  it("единственный прогон: медиана и p90 равны ему самому", () => {
    const [s] = summarizeStarts([rec({ cls: "soundcloud", soundMs: 640 })]);
    expect(s.count).toBe(1);
    expect(s.phases.total).toEqual({ median: 640, p90: 640 });
  });

  it("десять прогонов: медиана по середине, p90 — в хвосте", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => rec({ cls: "sc", soundMs: n * 100 }));
    const [s] = summarizeStarts(values);
    expect(s.count).toBe(10);
    // как считает таблица: медиана — середина, p90 — линейная интерполяция
    expect(s.phases.total).toEqual({ median: 550, p90: 910 });
  });

  it("выброс тянет p90, но не медиану — ради этого p90 и взят", () => {
    const runs = [100, 100, 100, 100, 100, 100, 100, 100, 100, 5000].map((ms) => rec({ cls: "sc", soundMs: ms }));
    const s = summarizeStarts(runs)[0];
    // одно «иногда» из десяти: медиана его не заметила вовсе, p90 вырос вшестеро
    expect(s.phases.total?.median).toBe(100);
    expect(s.phases.total?.p90).toBe(590);
  });

  it("классы считаются раздельно, крупные сверху", () => {
    const runs = [
      ...Array.from({ length: 3 }, () => rec({ cls: "soundcloud", soundMs: 200 })),
      rec({ cls: "soundcloud", cold: true, soundMs: 3000 }),
    ];
    const summary = summarizeStarts(runs);
    expect(summary.map((s) => s.cls)).toEqual(["soundcloud", "cold:soundcloud"]);
    expect(summary[0].phases.total?.median).toBe(200);
    expect(summary[1].phases.total?.median).toBe(3000);
  });

  it("фаза, которой не было ни разу, в сводку не попадает", () => {
    const [s] = summarizeStarts([rec({ cls: "sc", soundMs: 300 })]);
    expect(s.phases.total).toBeDefined();
    expect(s.phases.silence).toBeUndefined();
    expect(s.phases.sources).toBeUndefined();
  });
});

describe("выгрузка журнала в TSV", () => {
  it("шапка — договорённый порядок колонок", () => {
    const [head] = buildStartTsv([]).split("\n");
    expect(head.split("\t")).toEqual([
      "at",
      "reason",
      "class",
      "sourcesMs",
      "urlMs",
      "path",
      "playCallMs",
      "soundMs",
      "error",
      "timings",
      "silenceMs",
    ]);
  });

  it("строка складывается из фаз, класса и отметок добычи", () => {
    const tsv = buildStartTsv([
      rec({
        reason: "manual",
        cls: "soundcloud",
        sourcesMs: 20,
        urlMs: 900,
        path: "stream",
        playCallMs: 950,
        soundMs: 1200,
        silenceMs: 5,
        timings: [
          ["sc_api_v2", 340],
          ["sc_m3u8", 120],
        ],
      }),
    ]);
    const cells = tsv.split("\n")[1].split("\t");
    expect(cells[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(cells.slice(1)).toEqual([
      "manual",
      "soundcloud",
      "20",
      "900",
      "stream",
      "950",
      "1200",
      "",
      "sc_api_v2=340;sc_m3u8=120",
      "5",
    ]);
  });

  it("пустая ячейка вместо null — иначе таблица откажется считать медиану", () => {
    const cells = buildStartTsv([rec({ error: "нет сети" })]).split("\n")[1].split("\t");
    expect(cells[3]).toBe("");
    expect(cells[8]).toBe("нет сети");
  });

  it("табы и переводы строк внутри ячейки не разваливают таблицу", () => {
    const tsv = buildStartTsv([rec({ error: "первая\tвторая\nтретья" })]);
    expect(tsv.split("\n").length).toBe(2);
    expect(tsv.split("\n")[1].split("\t").length).toBe(11);
  });

  it("строки идут хронологически, старые сверху", () => {
    beginStart("t1", "Первый", "manual");
    markSound();
    beginStart("t2", "Второй", "manual");
    markSound();
    const rows = getStartTsv().split("\n").slice(1);
    expect(rows.length).toBe(2);
    // на экране порядок обратный — там нужен последний старт, в таблице серия
    expect(getStartLog()[0].trackId).toBe("t2");
  });
});
