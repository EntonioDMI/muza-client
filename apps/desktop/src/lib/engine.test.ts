import type { TrackSource } from "@muza/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  convertFileSrc: (path: string) => `asset:${path}`,
  isTauri: () => true,
}));

import {
  beginStart,
  getStartLog,
  resetStartTelemetryForTests,
} from "../player/startTelemetry";
import {
  cacheNamespace,
  engineStreamStart,
  fnv1a32,
  resolveTrack,
  toNativeSourceRefs,
} from "./engine";

const sources: TrackSource[] = [
  {
    id: "1",
    provider: "youtube",
    sourceId: "dQw4w9WgXcQ",
    url: "https://evil.test/private",
    priority: 100,
    kind: "catalog",
    durationSec: 180,
    isChosen: false,
  },
  {
    id: "2",
    provider: "soundcloud",
    sourceId: "123",
    url: "https://soundcloud.com/artist/song",
    priority: 80,
    kind: "catalog",
    durationSec: 180,
    isChosen: false,
  },
  {
    id: "3",
    provider: "local",
    sourceId: "abc",
    url: "local:abc",
    priority: 70,
    kind: "local",
    durationSec: 180,
    isChosen: false,
  },
  {
    id: "4",
    provider: "unknown",
    sourceId: "opaque",
    url: "https://evil.test/",
    priority: 60,
    kind: "catalog",
    durationSec: 180,
    isChosen: false,
  },
  {
    id: "5",
    provider: "bandcamp",
    sourceId: "456",
    url: "https://artist.bandcamp.com/track/song",
    priority: 50,
    kind: "direct",
    durationSec: 180,
    isChosen: true,
  },
];

describe("toNativeSourceRefs", () => {
  beforeEach(() => tauri.invoke.mockReset());

  it("emits exact trusted shapes, filters local/unknown and preserves order", () => {
    const refs = toNativeSourceRefs(sources);

    expect(refs).toEqual([
      { provider: "youtube", sourceId: "dQw4w9WgXcQ" },
      {
        provider: "soundcloud",
        sourceId: "123",
        canonicalUrl: "https://soundcloud.com/artist/song",
      },
      {
        provider: "bandcamp",
        sourceId: "456",
        canonicalUrl: "https://artist.bandcamp.com/track/song",
      },
    ]);
    expect(Object.hasOwn(refs[0], "url")).toBe(false);
    expect(Object.hasOwn(refs[0], "canonicalUrl")).toBe(false);
    expect(refs.every((ref) => !Object.hasOwn(ref, "url"))).toBe(true);
  });

  it("resolveTrack invokes engine_resolve with the pure mapper result", async () => {
    tauri.invoke.mockResolvedValueOnce({
      path: "C:/cache/42.webm",
      from_cache: false,
      provider: "youtube",
    });

    await resolveTrack("42", sources);

    expect(tauri.invoke).toHaveBeenCalledWith("engine_resolve", {
      trackId: "42",
      sources: toNativeSourceRefs(sources),
      quality: "auto",
      // Неймспейс кэша: без него track_id из разных БД (dev/prod)
      // коллидируют в одном каталоге — баг «чужая песня» 2026-07-14.
      cacheNs: cacheNamespace(),
    });
  });

  it("cacheNamespace стабилен и валиден для Rust-гейта (8 hex)", () => {
    const ns = cacheNamespace();
    expect(ns).toMatch(/^[0-9a-f]{8}$/);
    expect(cacheNamespace()).toBe(ns);
    // разные origin — разные неймспейсы (сама суть фикса)
    expect(fnv1a32("http://localhost:8000")).not.toBe(fnv1a32("https://api.muza.lol"));
  });
});

/** ПРОВОДКА ПОФАЗОВОГО ЗАМЕРА (2026-08-06). Rust научился отдавать отметки
 *  шагов добычи, и здесь проверяется единственное, что может их потерять:
 *  стык IPC. Форму отметок держит normalizeTimings (lib/startLog.ts), их
 *  накопление — startTelemetry; здесь — что вызов вообще случается и что
 *  ПУСТОЙ список (законный ответ кэш-хита) ничего не ломает. */
describe("отметки добычи доезжают до журнала стартов", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    resetStartTelemetryForTests();
  });

  it("resolveTrack кладёт отметки в текущий старт", async () => {
    beginStart("42", "трек", "manual");
    tauri.invoke.mockResolvedValueOnce({
      path: "C:/cache/42.webm",
      from_cache: false,
      provider: "soundcloud",
      timings: [
        ["sc_api_v2", 340],
        ["sc_probe", 21],
      ],
    });

    await resolveTrack("42", sources);

    expect(getStartLog()[0].timings).toEqual([
      ["sc_api_v2", 340],
      ["sc_probe", 21],
    ]);
  });

  it("engineStreamStart отчитывается и при отказе от стрима", async () => {
    beginStart("42", "трек", "manual");
    // Самый дорогой исход: ступень 0 отработала, стрим не завёлся — фазы
    // обязаны доехать, иначе эта работа невидима.
    tauri.invoke.mockResolvedValueOnce({
      stream: false,
      timings: [
        ["sc_api_v2", 300],
        ["first_chunk_wait", 8000],
      ],
    });

    await expect(engineStreamStart("42", sources)).resolves.toBe(false);

    expect(getStartLog()[0].timings).toEqual([
      ["sc_api_v2", 300],
      ["first_chunk_wait", 8000],
    ]);
  });

  it("пустой список и отсутствие поля разбор не ломают", async () => {
    beginStart("42", "трек", "manual");
    // кэш-хит: добывать не пришлось — Rust отдаёт []
    tauri.invoke.mockResolvedValueOnce({
      path: "C:/cache/42.webm",
      from_cache: true,
      provider: null,
      timings: [],
    });
    await expect(resolveTrack("42", sources)).resolves.toMatchObject({ fromCache: true });
    // поля нет вовсе — так отвечает клиент, собранный до этой правки
    tauri.invoke.mockResolvedValueOnce({ stream: false });
    await expect(engineStreamStart("42", sources)).resolves.toBe(false);

    // запись жива, просто без фаз — «нечего показать» вместо испорченного старта
    const rec = getStartLog()[0];
    expect(rec.trackId).toBe("42");
    expect(rec.timings).toBeUndefined();
  });

  it("отметки нескольких вызовов накапливаются в одном старте", async () => {
    beginStart("42", "трек", "manual");
    tauri.invoke.mockResolvedValueOnce({ stream: false, timings: [["warm_hit", 0]] });
    tauri.invoke.mockResolvedValueOnce({
      path: "C:/cache/42.webm",
      from_cache: false,
      provider: "youtube",
      timings: [["ladder", 4300]],
    });

    await engineStreamStart("42", sources);
    await resolveTrack("42", sources);

    expect(getStartLog()[0].timings).toEqual([
      ["warm_hit", 0],
      ["ladder", 4300],
    ]);
  });
});
