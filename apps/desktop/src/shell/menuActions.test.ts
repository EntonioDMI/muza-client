import { describe, expect, it, vi } from "vitest";
import type { Track } from "@muza/api-client";
import { buildMenuItems, type MenuContext, type MenuItem } from "./menuActions";
import type { ContextTarget } from "./contextTargets";
import type { LocalEntry } from "../lib/localFiles";
import type { PlayerTrack } from "../player/types";

// Матрица наборов пунктов: до 2026-07-20 эта логика жила JSX-массивами в
// четырёх местах (App.tsx catMenu/plMenu, PlaylistView, LibraryView) и не
// тестировалась вовсе. t — identity: проверяем КЛЮЧИ переводов, не строки.

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

const queueTrack: PlayerTrack = {
  id: "t1",
  kind: "catalog",
  title: "Title",
  artist: "Artist",
  album: "",
  duration: 180,
  cover: null,
  explicit: false,
  loudness: null,
};

function makeCtx(over: Partial<MenuContext> = {}): MenuContext {
  return {
    playNext: vi.fn(),
    queueTrack: vi.fn(),
    startRadio: vi.fn(),
    addToPlaylist: vi.fn(),
    isLiked: () => false,
    toggleLike: vi.fn(),
    jamAdd: null,
    shareTrack: vi.fn(),
    showVersions: vi.fn(),
    replaceInFavorites: vi.fn(),
    isPinned: () => false,
    toggleOffline: vi.fn(),
    openPlaylist: vi.fn(),
    playlistRole: () => "owner",
    playPlaylist: vi.fn(),
    queuePlaylistNext: vi.fn(),
    queuePlaylist: vi.fn(),
    sharePlaylist: vi.fn(),
    savePlaylistOffline: vi.fn(),
    renamePlaylist: vi.fn(),
    changePlaylistIcon: vi.fn(),
    playlistPinned: () => false,
    togglePlaylistPinned: vi.fn(),
    deletePlaylist: vi.fn(),
    unfollowPlaylist: vi.fn(),
    openCreatePlaylist: vi.fn(),
    openAddLink: vi.fn(),
    openImport: vi.fn(),
    openJoinCode: vi.fn(),
    playNextMany: vi.fn(),
    queueMany: vi.fn(),
    addManyToPlaylist: vi.fn(),
    likeMany: vi.fn(),
    pinMany: vi.fn(),
    copyText: vi.fn(),
    pluginMenuItems: () => [],
    notifyPlugin: vi.fn(),
    ...over,
  };
}

function labels(items: MenuItem[]): string[] {
  return items.map((it) => (it === "-" ? "-" : "header" in it ? `#${it.header}` : it.label));
}

function item(items: MenuItem[], label: string) {
  const found = items.find((it) => it !== "-" && "label" in it && it.label === label);
  if (found === undefined || found === "-" || !("label" in found)) throw new Error(`нет пункта ${label}`);
  return found;
}

describe("buildMenuItems: каталожный трек", () => {
  it("базовый набор поиска: очередь-действия первыми, без «Заменить версию» и jam", () => {
    const items = buildMenuItems({ kind: "track", track, place: "search" }, makeCtx(), t);
    // ⚠️ ЧИСТКА 13.08: «Радио по треку», «Поделиться» и «Сохранить офлайн» из
    // набора убраны решением владельца (обоснование каждого — в шапке
    // packages/app/src/shell/menuActions.ts). Набор стережём равенством, а не
    // включением, именно ради таких правок: вернувшийся пункт уронит тест.
    expect(labels(items)).toEqual([
      "menu.catalog.playNext",
      "menu.catalog.queue",
      "menu.addToPlaylist",
      "menu.catalog.like",
      "menu.catalog.versions",
    ]);
  });

  it("снятые 13.08 пункты не возвращаются: радио, поделиться, сохранить офлайн", () => {
    const items = buildMenuItems({ kind: "track", track, place: "search" }, makeCtx(), t);
    expect(labels(items)).not.toContain("menu.catalog.radio");
    expect(labels(items)).not.toContain("menu.catalog.share");
    expect(labels(items)).not.toContain("menu.catalog.saveOffline");
  });

  it("плеер-бар (place=player): без «Играть следующим»/«В очередь» — трек уже играет", () => {
    const items = buildMenuItems({ kind: "track", track, place: "player" }, makeCtx(), t);
    expect(labels(items)).not.toContain("menu.catalog.playNext");
    expect(labels(items)).not.toContain("menu.catalog.queue");
    expect(labels(items)).toContain("menu.addToPlaylist"); // общий набор доехал
  });

  it("из Любимого добавляется «Заменить версию»", () => {
    const items = buildMenuItems({ kind: "track", track, place: "favorites" }, makeCtx(), t);
    expect(labels(items)).toContain("menu.catalog.replaceVersion");
  });

  it("лайкнутый трек — пункт меняется на «Убрать из Любимого»", () => {
    const items = buildMenuItems({ kind: "track", track, place: "search" }, makeCtx({ isLiked: () => true }), t);
    expect(labels(items)).toContain("menu.catalog.unlike");
    expect(labels(items)).not.toContain("menu.catalog.like");
  });

  it("гость jam видит «В jam», хост/одиночка — нет", () => {
    const guest = buildMenuItems({ kind: "track", track, place: "search" }, makeCtx({ jamAdd: vi.fn() }), t);
    expect(labels(guest)).toContain("menu.catalog.addToJam");
    const host = buildMenuItems({ kind: "track", track, place: "search" }, makeCtx({ jamAdd: null }), t);
    expect(labels(host)).not.toContain("menu.catalog.addToJam");
  });

  /** ⚠️ ВХОДА В ОФЛАЙН В МЕНЮ БОЛЬШЕ НЕТ, А ВЫХОД ОСТАЛСЯ (13.08). Пункт
   *  «Сохранить офлайн» снят решением владельца, но «Убрать из офлайна»
   *  показывается уже сохранённым трекам: экрана со списком сохранённого в
   *  продукте нет, и без этого пункта снять пин было бы неоткуда. */
  it("закреплённый оффлайн трек — виден «Убрать из офлайна»", () => {
    const items = buildMenuItems({ kind: "track", track, place: "search" }, makeCtx({ isPinned: () => true }), t);
    expect(labels(items)).toContain("menu.catalog.removeOffline");
    expect(labels(items)).not.toContain("menu.catalog.saveOffline");
  });

  it("НЕ закреплённый трек не получает ни того, ни другого", () => {
    const items = buildMenuItems({ kind: "track", track, place: "search" }, makeCtx({ isPinned: () => false }), t);
    expect(labels(items)).not.toContain("menu.catalog.removeOffline");
    expect(labels(items)).not.toContain("menu.catalog.saveOffline");
  });

  it("плагины: слоты catalogTrack и track схлопнуты, разделитель перед ними, payload — {id,title,artist}", () => {
    const notifyPlugin = vi.fn();
    const ctx = makeCtx({
      pluginMenuItems: (kind) =>
        kind === "playlist" ? [] : [{ pluginId: "p1", slotId: `${kind}-slot`, title: `${kind}-item` }],
      notifyPlugin,
    });
    const items = buildMenuItems({ kind: "track", track, place: "search" }, ctx, t);
    const ls = labels(items);
    expect(ls).toContain("catalogTrack-item");
    expect(ls).toContain("track-item");
    expect(ls.indexOf("-")).toBeLessThan(ls.indexOf("catalogTrack-item"));
    item(items, "track-item").onClick?.();
    expect(notifyPlugin).toHaveBeenCalledWith("p1", "track-slot", { id: "t1", title: "Title", artist: "Artist" });
  });
});

describe("buildMenuItems: трек в плейлисте (ctl)", () => {
  const ctl = () => ({
    changeIcon: vi.fn(),
    replaceVersion: vi.fn(),
    removeTrack: vi.fn(),
    moveToStart: vi.fn(),
    moveToEnd: vi.fn(),
    canChangeIcon: true,
    canEdit: true,
  });

  it("владелец: общий набор + перестановка, иконка, правка состава за разделителем", () => {
    const items = buildMenuItems({ kind: "track", track, place: "playlist", ctl: ctl() }, makeCtx(), t);
    const ls = labels(items);
    expect(ls).toContain("menu.addToPlaylist"); // общий набор доехал
    const tail = ls.slice(ls.indexOf("-"));
    expect(tail).toEqual([
      "-",
      "menu.playlistTrack.toStart",
      "menu.playlistTrack.toEnd",
      "views.playlist.changePlaylistIcon",
      "menu.catalog.replaceVersion",
      "views.playlist.removeFromPlaylist",
    ]);
  });

  it("viewer (canEdit=false, canChangeIcon=false): extras нет ЦЕЛИКОМ, и лишнего разделителя тоже", () => {
    const items = buildMenuItems(
      { kind: "track", track, place: "playlist", ctl: { ...ctl(), canChangeIcon: false, canEdit: false } },
      makeCtx(),
      t,
    );
    const ls = labels(items);
    expect(ls).not.toContain("views.playlist.removeFromPlaylist");
    expect(ls).not.toContain("menu.catalog.replaceVersion");
    expect(ls).not.toContain("menu.playlistTrack.toStart");
    expect(ls.filter((x) => x === "-")).toHaveLength(0);
  });
});

describe("buildMenuItems: трек в очереди", () => {
  const ctl = (over: Partial<Extract<ContextTarget, { kind: "queueTrack" }>["ctl"]> = {}) => ({
    play: vi.fn(),
    playNext: vi.fn(),
    remove: vi.fn(),
    clearAfter: vi.fn(),
    canPlayNext: true,
    canClearAfter: true,
    ...over,
  });

  it("каталожный трек: играть, следующим, Любимое, убрать, очистить после", () => {
    const items = buildMenuItems({ kind: "queueTrack", track: queueTrack, ctl: ctl() }, makeCtx(), t);
    expect(labels(items)).toEqual([
      "menu.queue.play",
      "menu.queue.playNext",
      "menu.catalog.like",
      "-",
      "menu.queue.remove",
      "menu.queue.clearAfter",
    ]);
  });

  it("локальный трек без серверного id: лайкать некуда — пункта Любимого нет", () => {
    const local: PlayerTrack = { ...queueTrack, kind: "local" };
    const items = buildMenuItems({ kind: "queueTrack", track: local, ctl: ctl() }, makeCtx(), t);
    expect(labels(items)).not.toContain("menu.catalog.like");
  });

  it("текущий/следующий и последний: пункты видимы, но недоступны (disabled)", () => {
    const items = buildMenuItems(
      { kind: "queueTrack", track: queueTrack, ctl: ctl({ canPlayNext: false, canClearAfter: false }) },
      makeCtx(),
      t,
    );
    expect(item(items, "menu.queue.playNext").disabled).toBe(true);
    expect(item(items, "menu.queue.clearAfter").disabled).toBe(true);
  });
});

describe("buildMenuItems: плейлист", () => {
  const pl = { id: "pl1", name: "Мой плейлист" };

  it("владелец: игровые действия + владельческие, удаление — danger", () => {
    const items = buildMenuItems({ kind: "playlist", ...pl }, makeCtx(), t);
    expect(labels(items)).toEqual([
      "menu.playlist.open",
      "menu.playlist.play",
      "menu.playlist.playNext",
      "menu.playlist.queue",
      "-",
      // ⚠️ «Поделиться» снято 13.08 той же правкой, что у трека: пункт отдавал
      // КАРТИНКУ плейлиста. Настоящая раздача доступа (ShareVisibilityDialog,
      // лесенка private → код → public) живёт на странице плейлиста и цела.
      // «Сохранить офлайн» у ПЛЕЙЛИСТА, наоборот, оставлено: довод владельца
      // про перетаскивание на рабочий стол работает для трека, а не для
      // альбома целиком.
      "menu.catalog.saveOffline",
      "menu.playlist.pin",
      "menu.playlist.rename",
      "menu.playlist.changeIcon",
      "-",
      "menu.playlist.delete",
    ]);
    expect(item(items, "menu.playlist.delete").danger).toBe(true);
  });

  it("владелец: закреплённый плейлист — пункт «Открепить» вместо «Закрепить»", () => {
    const items = buildMenuItems({ kind: "playlist", ...pl }, makeCtx({ playlistPinned: () => true }), t);
    const ls = labels(items);
    expect(ls).toContain("menu.playlist.unpin");
    expect(ls).not.toContain("menu.playlist.pin");
  });

  it("подписка (follower): игровые действия есть, правок нет, «Убрать из библиотеки» в хвосте", () => {
    const items = buildMenuItems({ kind: "playlist", ...pl }, makeCtx({ playlistRole: () => "follower" }), t);
    const ls = labels(items);
    expect(ls).toContain("menu.playlist.play");
    expect(ls).not.toContain("menu.playlist.rename");
    expect(ls).not.toContain("menu.playlist.delete");
    expect(ls[ls.length - 1]).toBe("menu.playlist.unfollow");
  });

  it("совместный (collaborator): игровые действия без правок и без отписки", () => {
    const items = buildMenuItems({ kind: "playlist", ...pl }, makeCtx({ playlistRole: () => "collaborator" }), t);
    const ls = labels(items);
    expect(ls).toContain("menu.playlist.queue");
    expect(ls).not.toContain("menu.playlist.rename");
    expect(ls).not.toContain("menu.playlist.unfollow");
  });

  it("плагины playlist-слота получают payload {id,name}", () => {
    const notifyPlugin = vi.fn();
    const ctx = makeCtx({
      pluginMenuItems: (kind) => (kind === "playlist" ? [{ pluginId: "p1", slotId: "s1", title: "pl-item" }] : []),
      notifyPlugin,
    });
    const items = buildMenuItems({ kind: "playlist", ...pl }, ctx, t);
    item(items, "pl-item").onClick?.();
    expect(notifyPlugin).toHaveBeenCalledWith("p1", "s1", { id: "pl1", name: "Мой плейлист" });
  });
});

describe("buildMenuItems: пустое место медиатеки", () => {
  it("создать / по ссылке / импорт / код — все действия из ctx", () => {
    const ctx = makeCtx();
    const items = buildMenuItems({ kind: "libraryBlank" }, ctx, t);
    expect(labels(items)).toEqual([
      "menu.library.createPlaylist",
      "menu.library.addLink",
      "menu.library.importPlaylist",
      "menu.library.joinCode",
    ]);
    item(items, "menu.library.createPlaylist").onClick?.();
    expect(ctx.openCreatePlaylist).toHaveBeenCalled();
  });
});

describe("buildMenuItems: выделение", () => {
  const tracks = [track, { ...track, id: "t2" }];

  it("заголовок-счётчик первым; «Убрать…» — только с ctl.remove, danger, подпись по scope", () => {
    const withRemove = buildMenuItems(
      {
        kind: "selection",
        tracks,
        count: tracks.length,
        place: "list",
        ctl: { remove: { scope: "playlist", run: vi.fn() }, clear: vi.fn() },
      },
      makeCtx(),
      t,
    );
    expect(labels(withRemove)[0]).toBe("#menu.selection.count");
    expect(item(withRemove, "views.playlist.removeFromPlaylist").danger).toBe(true);

    const noRemove = buildMenuItems({ kind: "selection", tracks, count: tracks.length, place: "list", ctl: { clear: vi.fn() } }, makeCtx(), t);
    expect(labels(noRemove)).not.toContain("views.playlist.removeFromPlaylist");

    const queueRemove = buildMenuItems(
      { kind: "selection", tracks, count: tracks.length, place: "queue", ctl: { remove: { scope: "queue", run: vi.fn() }, clear: vi.fn() } },
      makeCtx(),
      t,
    );
    expect(labels(queueRemove)).toContain("menu.queue.remove");
  });

  it("в очереди нет playNext/queue — они добавляли бы копии уже стоящих треков", () => {
    const items = buildMenuItems({ kind: "selection", tracks, count: tracks.length, place: "queue", ctl: { clear: vi.fn() } }, makeCtx(), t);
    expect(labels(items)).not.toContain("menu.catalog.playNext");
    expect(labels(items)).not.toContain("menu.catalog.queue");
  });

  it("счётчик показывает реальное выделение, а не длину каталожного списка", () => {
    // Локальные файлы в каталожную форму не превращаются и в tracks не попадают,
    // но «Убрать из очереди» работает по полному набору id. Пока счётчик брался
    // из tracks.length, в меню стояло «Выбрано: 2», а убиралось 3.
    // локальный переводчик, который проговаривает подставленные значения
    const spyT = ((key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key) as unknown as Parameters<typeof buildMenuItems>[2];
    const items = buildMenuItems(
      { kind: "selection", tracks, count: 3, place: "queue", ctl: { remove: { scope: "queue", run: vi.fn() }, clear: vi.fn() } },
      makeCtx(),
      spyT,
    );
    const first = items[0];
    expect(typeof first === "object" && "header" in first ? first.header : null).toBe(
      'menu.selection.count:{"count":3}',
    );
  });

  it("массовые действия получают ВСЕ выделенные треки", () => {
    const ctx = makeCtx();
    const items = buildMenuItems({ kind: "selection", tracks, count: tracks.length, place: "list", ctl: { clear: vi.fn() } }, ctx, t);
    item(items, "menu.catalog.queue").onClick?.();
    expect(ctx.queueMany).toHaveBeenCalledWith(tracks);
    item(items, "menu.catalog.like").onClick?.();
    expect(ctx.likeMany).toHaveBeenCalledWith(["t1", "t2"]);
  });
});

describe("buildMenuItems: пустое место плейлиста", () => {
  it("вход в режим выбора + выделить все", () => {
    const enterSelect = vi.fn();
    const items = buildMenuItems({ kind: "playlistBlank", ctl: { enterSelect, selectAll: vi.fn() } }, makeCtx(), t);
    expect(labels(items)).toEqual(["menu.selection.enter", "menu.selection.all"]);
    item(items, "menu.selection.enter").onClick?.();
    expect(enterSelect).toHaveBeenCalled();
  });
});

describe("buildMenuItems: текст песни (ПКМ, 2026-07-21)", () => {
  const base = { kind: "lyrics" as const, allText: "line1\nline2", ctl: { explain: vi.fn() } };

  it("ПКМ по строке с note: все три пункта — весь текст, строка, смысл", () => {
    const target: ContextTarget = { ...base, lineText: "line2", lineIndex: 1, hasNote: true };
    expect(labels(buildMenuItems(target, makeCtx(), t))).toEqual([
      "menu.lyrics.copyAll",
      "menu.lyrics.copyLine",
      "menu.lyrics.meaning",
    ]);
  });

  it("ПКМ мимо строк (lineText=null): только «весь текст»", () => {
    const target: ContextTarget = { ...base, lineText: null, lineIndex: null, hasNote: false };
    expect(labels(buildMenuItems(target, makeCtx(), t))).toEqual(["menu.lyrics.copyAll"]);
  });

  it("строка без note: без пункта «Смысл»", () => {
    const target: ContextTarget = { ...base, lineText: "line1", lineIndex: 0, hasNote: false };
    expect(labels(buildMenuItems(target, makeCtx(), t))).toEqual(["menu.lyrics.copyAll", "menu.lyrics.copyLine"]);
  });

  it("копирование идёт через ctx.copyText с текстом и ключом тоста", () => {
    const ctx = makeCtx();
    const target: ContextTarget = { ...base, lineText: "line2", lineIndex: 1, hasNote: true };
    const items = buildMenuItems(target, ctx, t);
    item(items, "menu.lyrics.copyAll").onClick?.();
    expect(ctx.copyText).toHaveBeenCalledWith("line1\nline2", "toast.lyrics.copiedAll");
    item(items, "menu.lyrics.copyLine").onClick?.();
    expect(ctx.copyText).toHaveBeenCalledWith("line2", "toast.lyrics.copiedLine");
    item(items, "menu.lyrics.meaning").onClick?.();
    expect(target.ctl.explain).toHaveBeenCalledWith(1);
  });
});

describe("buildMenuItems: локальный файл", () => {
  const entry = { hash: "h1", artist: "A", title: "T", duration_sec: 60, available: true } as unknown as LocalEntry;

  it("зарегистрирован и на устройстве: плейлист + папка + убрать", () => {
    const target: ContextTarget = {
      kind: "localTrack",
      entry,
      ctl: { addToPlaylist: vi.fn(), reveal: vi.fn(), forget: vi.fn() },
    };
    expect(labels(buildMenuItems(target, makeCtx(), t))).toEqual([
      "menu.addToPlaylist",
      "menu.library.showInFolder",
      "views.library.removeFromMuza",
    ]);
  });

  it("не зарегистрирован и файла нет: только «Убрать из Музы»", () => {
    const target: ContextTarget = {
      kind: "localTrack",
      entry,
      ctl: { addToPlaylist: null, reveal: null, forget: vi.fn() },
    };
    expect(labels(buildMenuItems(target, makeCtx(), t))).toEqual(["views.library.removeFromMuza"]);
  });
});
