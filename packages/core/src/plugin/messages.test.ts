import { describe, expect, it } from "vitest";
import { makeErrorRes, makeEvent, makeReady, makeReq, makeRes, nextMessageId, parseEnvelope } from "./messages";

describe("parseEnvelope", () => {
  it("валидный req проходит", () => {
    const env = makeReq("1", "player.play", { foo: 1 });
    expect(parseEnvelope(env)).toEqual(env);
  });

  it("res/error/event/ready строятся корректно", () => {
    expect(parseEnvelope(makeRes("1", { ok: true }))?.kind).toBe("res");
    expect(parseEnvelope(makeErrorRes("1", "denied", "нет права"))?.code).toBe("denied");
    expect(parseEnvelope(makeEvent("2", "track:change", { id: "x" }))?.kind).toBe("event");
    expect(parseEnvelope(makeReady("0"))?.kind).toBe("ready");
  });

  it("мусор от постороннего окна -> null, не исключение", () => {
    expect(parseEnvelope("просто строка")).toBeNull();
    expect(parseEnvelope({ hello: "world" })).toBeNull();
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope(undefined)).toBeNull();
  });

  it("v != 1 отклоняется (протокол устареет предсказуемо)", () => {
    expect(parseEnvelope({ v: 2, id: "1", kind: "ready" })).toBeNull();
  });

  it("неизвестный kind отклоняется", () => {
    expect(parseEnvelope({ v: 1, id: "1", kind: "hack" })).toBeNull();
  });

  it("неизвестный code отклоняется", () => {
    expect(parseEnvelope({ v: 1, id: "1", kind: "error", code: "whatever" })).toBeNull();
  });
});

describe("nextMessageId", () => {
  it("генерирует уникальные id подряд", () => {
    const ids = new Set(Array.from({ length: 20 }, () => nextMessageId("req")));
    expect(ids.size).toBe(20);
  });
});
