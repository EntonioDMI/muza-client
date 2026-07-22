/** Дрейф-математика useVideoSync (2026-07-21): est = pos + Δt·speed, сик
 *  только когда |video.currentTime − est| ПРЕВЫШАЕТ допуск 0.35с (граница —
 *  строго ">", не ">="). requestAnimationFrame стенд: мокаем rAF так, чтобы
 *  сами решали, когда исполнить очередной "кадр" — иначе тест либо ждал бы
 *  реальные кадры, либо гонялся бы за таймерами jsdom. */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoSync } from "./useVideoSync";

let rafCb: FrameRequestCallback | null = null;

const fakeVideo = (over: Partial<HTMLVideoElement> = {}): HTMLVideoElement =>
  ({
    readyState: 1,
    currentTime: 0,
    playbackRate: 1,
    paused: false,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    ...over,
  }) as unknown as HTMLVideoElement;

beforeEach(() => {
  rafCb = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Прогнать один "кадр" rAF-цикла (step перерегистрирует себя же в rafCb). */
const tick = () => act(() => void rafCb?.(0));

describe("useVideoSync: дрейф-математика", () => {
  it("Δt·speed внутри допуска (0.3с < 0.35с) — currentTime НЕ трогаем", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));
    expect(rafCb).not.toBeNull();

    now.mockReturnValue(1_000 + 300); // Δt=0.3с, speed=1 → est=10.3, diff=0.3
    tick();

    expect(video.currentTime).toBe(10); // допуск не превышен — без перемотки
  });

  it("Δt·speed СТРОГО превышает допуск (0.4с > 0.35с) — жёсткая перемотка на est", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(2_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(2_000 + 400); // Δt=0.4с → est=10.4, diff=0.4 > 0.35
    tick();

    expect(video.currentTime).toBeCloseTo(10.4);
  });

  it("порог 0.35с — граница СТРОГО не включена: ровно 0.35 не перематывает", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(500);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(500 + 350); // diff РОВНО 0.35 — код требует ">", не ">="
    tick();

    expect(video.currentTime).toBe(10);
  });

  it("speed множит экстраполяцию: тот же Δt, но speed=2 удваивает est", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(3_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 2 }));

    now.mockReturnValue(3_000 + 200); // Δt=0.2с × speed=2 → est=10.4, diff=0.4>0.35
    tick();

    expect(video.currentTime).toBeCloseTo(10.4);
  });

  it("playing=false — БЕЗ экстраполяции (est=pos), даже с большим Δt перемотки нет", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(4_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: false, speed: 1 }));

    now.mockReturnValue(4_000 + 5_000); // 5с реального времени — но на паузе est не растёт
    tick();

    expect(video.currentTime).toBe(10); // est осталась 10 — диапазон не превышен
  });

  it("readyState=0 (src ещё не открылся) — currentTime не трогаем, даже если дрейф большой", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(5_000);
    const video = fakeVideo({ currentTime: 0, readyState: 0 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(5_000 + 1_000);
    tick();

    expect(video.currentTime).toBe(0); // трогать currentTime рано — readyState 0
  });
});
