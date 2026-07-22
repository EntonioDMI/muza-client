/** useTrackVideo: лимит «один refresh на трек» (2026-07-21). refreshVideo()
 *  ре-резолвит протухший googlevideo-URL через onError <video>; без лимита
 *  мёртвое видео долбило бы InnerTube в цикле error→refresh→error. */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzaApi, TrackSource } from "@muza/api-client";
import type { PlayerTrack } from "./types";
import { useTrackVideo } from "./useTrackVideo";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getCachedSources: vi.fn(),
  putCachedSources: vi.fn(),
  getTrackSources: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: h.invoke,
  isTauri: () => true,
}));

vi.mock("./sourcesCache", () => ({
  getCachedSources: h.getCachedSources,
  putCachedSources: h.putCachedSources,
}));

const api = { getTrackSources: h.getTrackSources } as unknown as MuzaApi;

const ytTrack = (id: string): PlayerTrack => ({
  id,
  kind: "catalog",
  title: `Track ${id}`,
  artist: "Artist",
  album: "",
  duration: 200,
  cover: null,
  explicit: false,
  loudness: null,
});

const ytSource = (id: string): TrackSource => ({
  id: `s-${id}`,
  provider: "youtube",
  sourceId: `yt-${id}`,
  url: "",
  priority: 100,
  kind: "catalog",
  durationSec: 0,
  isChosen: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.getCachedSources.mockReturnValue(null);
  h.getTrackSources.mockImplementation(async (id: string) => [ytSource(id)]);
});

describe("useTrackVideo: лимит один refresh на трек", () => {
  it("первый refreshVideo() того же трека ре-резолвит; второй подряд — сдаётся на обложку, без нового вызова", async () => {
    h.invoke.mockResolvedValueOnce({ url: "https://googlevideo/a-1.mp4", itag: 136, expires_at_ms: 0 });
    const track = ytTrack("v1");
    const { result, rerender } = renderHook(
      ({ t }: { t: PlayerTrack | null }) => useTrackVideo(api, t, true, true),
      { initialProps: { t: track } },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.videoUrl).toBe("https://googlevideo/a-1.mp4");
    expect(h.invoke).toHaveBeenCalledTimes(1);

    // URL "протух" — <video> зовёт refreshVideo из onError. Первый refresh
    // для этого трека РАЗРЕШЁН: новый ре-резолв.
    h.invoke.mockResolvedValueOnce({ url: "https://googlevideo/a-2.mp4", itag: 136, expires_at_ms: 0 });
    act(() => {
      result.current.refreshVideo();
    });
    rerender({ t: track });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(result.current.videoUrl).toBe("https://googlevideo/a-2.mp4");

    // Второй refresh ПОДРЯД того же трека — лимит исчерпан: без нового
    // резолва, честно сдаёмся на обложку (videoUrl → null).
    h.invoke.mockClear();
    act(() => {
      result.current.refreshVideo();
    });
    rerender({ t: track });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.invoke).not.toHaveBeenCalled(); // ре-резолва не было
    expect(result.current.videoUrl).toBeNull(); // сдались на обложку
  });

  it("смена трека сбрасывает лимит — у нового трека свой собственный refresh", async () => {
    h.invoke.mockResolvedValueOnce({ url: "https://googlevideo/x-1.mp4", itag: 136, expires_at_ms: 0 });
    const trackX = ytTrack("vx");
    const { result, rerender } = renderHook(
      ({ t }: { t: PlayerTrack | null }) => useTrackVideo(api, t, true, true),
      { initialProps: { t: trackX } },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Трек vx уже израсходовал свой refresh
    act(() => {
      result.current.refreshVideo();
    });
    h.invoke.mockClear();

    // Переключились на другой трек
    const trackY = ytTrack("vy");
    h.invoke.mockResolvedValueOnce({ url: "https://googlevideo/y-1.mp4", itag: 136, expires_at_ms: 0 });
    rerender({ t: trackY });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.videoUrl).toBe("https://googlevideo/y-1.mp4");

    // refresh трека vy — это ПЕРВЫЙ его refresh, лимит vx на него не распространяется
    h.invoke.mockResolvedValueOnce({ url: "https://googlevideo/y-2.mp4", itag: 136, expires_at_ms: 0 });
    act(() => {
      result.current.refreshVideo();
    });
    rerender({ t: trackY });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.videoUrl).toBe("https://googlevideo/y-2.mp4");
  });
});
