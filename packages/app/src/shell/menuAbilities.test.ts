import { describe, expect, it, vi } from "vitest";
import type { Track } from "@muza/api-client";
import { buildMenuItems, type MenuAbilities, type MenuItem } from "./menuActions";

// Правило «есть умение — есть пункт» (2026-08-02). Полный набор десктопа
// проверяет матрица apps/desktop/src/shell/menuActions.test.ts — там же
// сторожится, что приложение не изменилось. Здесь проверяется ВТОРАЯ
// площадка: браузер, у которого умений заметно меньше. Ничего серого и
// неработающего в его меню быть не должно.
// t — identity: проверяем КЛЮЧИ переводов, не строки.

const t = ((key: string) => key) as unknown as Parameters<typeof buildMenuItems>[2];

const track: Track = {
  id: "t1",
  artist: "Artist",
  title: "Title",
  durationSec: 180,
  coverUrl: null,
  isCached: false,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
};

function labels(items: MenuItem[]): string[] {
  return items.map((it) => (it === "-" ? "-" : "header" in it ? `#${it.header}` : it.label));
}

/** Ровно то, что умеет веб на 2026-08-02. */
function webAbilities(over: Partial<MenuAbilities> = {}): MenuAbilities {
  return {
    addToPlaylist: vi.fn(),
    isLiked: () => false,
    toggleLike: vi.fn(),
    downloadTrack: vi.fn(),
    addManyToPlaylist: vi.fn(),
    likeMany: vi.fn(),
    ...over,
  };
}

describe("меню браузера: пункта нет там, где нет умения", () => {
  it("трек: только в плейлист, лайк и скачать — ни очереди, ни радио, ни офлайна", () => {
    const items = buildMenuItems({ kind: "track", track, place: "search" }, webAbilities(), t);
    expect(labels(items)).toEqual(["menu.addToPlaylist", "menu.catalog.like", "common.download"]);
  });

  it("трек: «Заменить версию» не появляется даже в Любимом — умения нет", () => {
    const items = buildMenuItems({ kind: "track", track, place: "favorites" }, webAbilities(), t);
    expect(labels(items)).not.toContain("menu.catalog.replaceVersion");
  });

  it("трек в плейлисте: из правок состава только «Убрать» — перестановки веб не умеет", () => {
    const removeTrack = vi.fn();
    const items = buildMenuItems(
      { kind: "track", track, place: "playlist", ctl: { canEdit: true, canChangeIcon: false, removeTrack } },
      webAbilities(),
      t,
    );
    expect(labels(items)).toEqual([
      "menu.addToPlaylist",
      "menu.catalog.like",
      "common.download",
      "-",
      "views.playlist.removeFromPlaylist",
    ]);
  });

  it("«Скачать» — умение ТОЛЬКО браузера: без него пункта нет", () => {
    const items = buildMenuItems({ kind: "track", track, place: "search" }, webAbilities({ downloadTrack: undefined }), t);
    expect(labels(items)).not.toContain("common.download");
  });

  it("выделение: массовые действия без вставок в очередь и без «сохранить офлайн»", () => {
    const tracks = [track, { ...track, id: "t2" }];
    const items = buildMenuItems(
      { kind: "selection", tracks, count: 2, place: "list", ctl: { clear: vi.fn() } },
      webAbilities(),
      t,
    );
    expect(labels(items)).toEqual([
      "#menu.selection.count",
      "menu.addToPlaylist",
      "menu.catalog.like",
      "-",
      "menu.selection.clear",
    ]);
  });

  it("локальный файл: «Показать в папке» пропадает вместе с умением площадки", () => {
    const entry = { hash: "h1", artist: "A", title: "T" };
    const browser = buildMenuItems(
      { kind: "localTrack", entry, ctl: { addToPlaylist: null, reveal: null, forget: vi.fn() } },
      webAbilities(),
      t,
    );
    expect(labels(browser)).toEqual(["views.library.removeFromMuza"]);

    const desktop = buildMenuItems(
      { kind: "localTrack", entry, ctl: { addToPlaylist: null, reveal: vi.fn(), forget: vi.fn() } },
      webAbilities(),
      t,
    );
    expect(labels(desktop)).toContain("menu.library.showInFolder");
  });

  it("плейлист без единого умения: пусто, а не голые разделители", () => {
    expect(buildMenuItems({ kind: "playlist", id: "p1", name: "P" }, {}, t)).toEqual([]);
  });

  it("плейлист: разделитель появляется только между НЕПУСТЫМИ группами", () => {
    const items = buildMenuItems(
      { kind: "playlist", id: "p1", name: "P" },
      { openPlaylist: vi.fn(), deletePlaylist: vi.fn(), playlistRole: () => "owner" },
      t,
    );
    expect(labels(items)).toEqual(["menu.playlist.open", "-", "menu.playlist.delete"]);
  });

  it("пустое место медиатеки: без умений остаются только пункты выбора, без ведущего разделителя", () => {
    const items = buildMenuItems(
      { kind: "libraryBlank", ctl: { enterSelect: vi.fn(), selectAll: vi.fn() } },
      {},
      t,
    );
    expect(labels(items)).toEqual(["menu.selection.enterPlaylists", "menu.selection.all"]);
  });

  it("текст песни: без умения копировать остаётся только «Смысл строки»", () => {
    const items = buildMenuItems(
      { kind: "lyrics", allText: "a\nb", lineText: "b", lineIndex: 1, hasNote: true, ctl: { explain: vi.fn() } },
      {},
      t,
    );
    expect(labels(items)).toEqual(["menu.lyrics.meaning"]);
  });
});
