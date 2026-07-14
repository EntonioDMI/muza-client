import { describe, expect, it } from "vitest";
import { PLAYLIST_ICON_IDS, pickRandomPlaylistIcon, playlistIconUrl } from "./playlistIcons";

describe("PLAYLIST_ICON_IDS", () => {
  it("ровно 38 id вида pi-01..pi-38", () => {
    expect(PLAYLIST_ICON_IDS).toHaveLength(38);
    expect(PLAYLIST_ICON_IDS[0]).toBe("pi-01");
    expect(PLAYLIST_ICON_IDS[9]).toBe("pi-10");
    expect(PLAYLIST_ICON_IDS[37]).toBe("pi-38");
    for (const id of PLAYLIST_ICON_IDS) expect(id).toMatch(/^pi-\d{2}$/);
  });
});

describe("playlistIconUrl", () => {
  it("собирает публичный путь к ассету", () => {
    expect(playlistIconUrl("pi-05")).toBe("/playlist-icons/pi-05.png");
  });
});

describe("pickRandomPlaylistIcon", () => {
  it("детерминизм через инъекцию rng: rng()=0 -> первый элемент пула", () => {
    expect(pickRandomPlaylistIcon([], () => 0)).toBe("pi-01");
  });

  it("детерминизм через инъекцию rng: rng() около 1 -> последний элемент пула (клэмп)", () => {
    expect(pickRandomPlaylistIcon([], () => 0.999999)).toBe("pi-38");
  });

  it("не выбирает id из usedIds, если есть свободные", () => {
    const used = PLAYLIST_ICON_IDS.slice(0, 37); // заняты все, кроме pi-38
    expect(pickRandomPlaylistIcon(used, () => 0)).toBe("pi-38");
    expect(pickRandomPlaylistIcon(used, () => 0.999999)).toBe("pi-38");
  });

  it("фолбэк на полный манифест, если ВСЕ id заняты", () => {
    const allUsed = [...PLAYLIST_ICON_IDS];
    expect(pickRandomPlaylistIcon(allUsed, () => 0)).toBe("pi-01");
    expect(pickRandomPlaylistIcon(allUsed, () => 0.5)).toBe(PLAYLIST_ICON_IDS[Math.floor(0.5 * 38)]);
  });

  it("случайные прогоны (Math.random по умолчанию) всегда возвращают валидный id", () => {
    for (let i = 0; i < 100; i += 1) {
      const id = pickRandomPlaylistIcon([]);
      expect(PLAYLIST_ICON_IDS).toContain(id);
    }
  });

  it("не повторяется по многим прогонам, пока не занят весь манифест (стат. проверка не-повтора)", () => {
    const used: string[] = [];
    for (let i = 0; i < 38; i += 1) {
      const id = pickRandomPlaylistIcon(used);
      expect(used).not.toContain(id);
      used.push(id);
    }
    expect(new Set(used).size).toBe(38);
  });
});
