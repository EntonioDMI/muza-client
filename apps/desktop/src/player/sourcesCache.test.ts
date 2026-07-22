import { beforeEach, describe, expect, it } from "vitest";
import type { TrackSource } from "@muza/api-client";
import { ensureSources, getCachedSources, invalidateCachedSources } from "./sourcesCache";

const SRC: TrackSource[] = [
  { id: 1, provider: "youtube", url: "yt:abc", isDead: false } as unknown as TrackSource,
];

beforeEach(() => invalidateCachedSources("t1"));

describe("ensureSources (single-flight)", () => {
  it("параллельные вызовы делят ОДИН запрос (pointerdown + клик)", async () => {
    let loads = 0;
    const load = () =>
      new Promise<TrackSource[]>((r) => {
        loads++;
        setTimeout(() => r(SRC), 5);
      });
    const [a, b] = await Promise.all([ensureSources("t1", load), ensureSources("t1", load)]);
    expect(loads).toBe(1);
    expect(a).toBe(b);
    expect(getCachedSources("t1")).toEqual(SRC);
  });

  it("ошибка не кэшируется — следующий вызов пробует заново", async () => {
    let loads = 0;
    const failing = () => {
      loads++;
      return Promise.reject(new Error("сеть упала"));
    };
    await expect(ensureSources("t1", failing)).rejects.toThrow("сеть упала");
    await expect(ensureSources("t1", failing)).rejects.toThrow("сеть упала");
    expect(loads).toBe(2);
    expect(getCachedSources("t1")).toBeNull();
  });

  it("свежий кэш отдаётся без запроса", async () => {
    let loads = 0;
    const load = () => {
      loads++;
      return Promise.resolve(SRC);
    };
    await ensureSources("t1", load);
    await ensureSources("t1", load);
    expect(loads).toBe(1);
  });
});
