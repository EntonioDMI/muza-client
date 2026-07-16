import { describe, expect, it } from "vitest";
import { discordCoverUrl, formatTemplate } from "./discord";

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
