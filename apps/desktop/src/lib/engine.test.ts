import type { TrackSource } from "@muza/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  convertFileSrc: (path: string) => `asset:${path}`,
  isTauri: () => true,
}));

import { resolveTrack, toNativeSourceRefs } from "./engine";

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
    });
  });
});
