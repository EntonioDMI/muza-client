import { beforeEach, describe, expect, it } from "vitest";
import {
  beginStart,
  getStartLog,
  markError,
  markPlayCall,
  markSound,
  markSources,
  markUrl,
  resetStartTelemetryForTests,
  subscribeStartLog,
} from "./startTelemetry";

beforeEach(() => resetStartTelemetryForTests());

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

  it("кольцо ограничено и подписчик уведомляется", () => {
    let calls = 0;
    const off = subscribeStartLog(() => calls++);
    for (let i = 0; i < 25; i++) beginStart(`t${i}`, `Трек ${i}`, "manual");
    expect(getStartLog().length).toBe(20);
    expect(calls).toBeGreaterThan(0);
    off();
  });
});
