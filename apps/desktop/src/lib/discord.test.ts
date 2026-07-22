import { describe, expect, it, vi } from "vitest";
import { discordCoverUrl, formatTemplate, updateDiscordActivity } from "./discord";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

// Обложка Discord-активности: ytimg-тумбы — через weserv center-crop (Discord
// не кропает внешние URL сам, поля уезжали в статус), остальное — как есть.
describe("discordCoverUrl", () => {
  it("ytimg-тумба заворачивается в weserv с квадратным кропом", () => {
    const out = discordCoverUrl("https://i.ytimg.com/vi/abc123/hqdefault.jpg");
    expect(out).toContain("images.weserv.nl");
    expect(out).toContain(encodeURIComponent("https://i.ytimg.com/vi/abc123/hqdefault.jpg"));
    expect(out).toContain("fit=cover");
    // trim обязателен: у hqdefault рамки двойные, без автообрезки боковые
    // полосы остаются ВНУТРИ центрального квадрата
    expect(out).toContain("trim=");
  });

  it("квадратные источники (iTunes) идут как есть", () => {
    const url = "https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg";
    expect(discordCoverUrl(url)).toBe(url);
  });

  it("не-https и пустое — null (локальные байты Discord не отдать)", () => {
    expect(discordCoverUrl("data:image/png;base64,xxx")).toBe(null);
    expect(discordCoverUrl("http://localhost:8000/cover.jpg")).toBe(null);
    expect(discordCoverUrl(null)).toBe(null);
  });

  it("ytimg в чужом хосте не подменяется (i.ytimg.com.evil.ru)", () => {
    const url = "https://i.ytimg.com.evil.ru/vi/abc/hqdefault.jpg";
    expect(discordCoverUrl(url)).toBe(url); // не наш паттерн — как есть, без прокси
  });
});

describe("formatTemplate", () => {
  it("подстановки и подчистка висячих разделителей", () => {
    expect(formatTemplate("{artist} — {album}", { track: "T", artist: "A" })).toBe("A");
    expect(formatTemplate("{track} · {artist}", { track: "T", artist: "A" })).toBe("T · A");
  });
});

// Мост к rpc.rs: КАЖДОЕ поле DiscordActivity обязано доехать до payload —
// end_ts уже терялся молча (поле было в типах с обеих сторон, но не в
// передаче), и вместо нативной прогресс-линии Discord показывал голый
// счётчик минут (жалоба 2026-07-22).
describe("updateDiscordActivity", () => {
  it("start_ts + end_ts доезжают до rpc_update (прогресс-линия)", async () => {
    invokeMock.mockResolvedValue(true);
    await updateDiscordActivity({
      details: "Track",
      state: "Artist",
      coverUrl: null,
      startTs: 1_000,
      endTs: 1_180,
      buttonLabel: null,
      buttonUrl: null,
    });
    expect(invokeMock).toHaveBeenCalledWith("rpc_update", {
      payload: expect.objectContaining({ start_ts: 1_000, end_ts: 1_180 }),
    });
  });

  it("прогресс-линия выключена — end_ts честный null, не undefined", async () => {
    invokeMock.mockResolvedValue(true);
    await updateDiscordActivity({
      details: "Track",
      state: "Artist",
      coverUrl: null,
      startTs: 1_000,
      endTs: null,
      buttonLabel: null,
      buttonUrl: null,
    });
    const payload = invokeMock.mock.lastCall?.[1]?.payload as Record<string, unknown>;
    expect(payload.end_ts).toBe(null);
  });
});
