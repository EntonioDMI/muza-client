import type { Track } from "@muza/api-client";
import type { useT } from "@muza/app/i18n";
import type { PluginMenuItem, PluginMenuKind } from "../plugins/usePlugins";
import type { ContextTarget } from "./contextTargets";

/** Сборка пунктов контекстного меню — чистая функция от цели и контекста.
 *
 *  До 2026-07-20 эти наборы жили JSX-массивами в четырёх местах (App.tsx
 *  catMenu/plMenu, PlaylistView, LibraryView) и не были тестируемы вовсе.
 *  Здесь матрица «роль × гость × Любимое × оффлайн» покрывается юнит-тестами
 *  без React (menuActions.test.ts).
 *
 *  Порядок пунктов трека: сперва действия НАД ОЧЕРЕДЬЮ (следующим/в очередь —
 *  самые частые), затем сборные (радио/плейлист/Любимое), затем карточные
 *  (поделиться/источники), хвост — оффлайн, вьюшные extras и плагины. */

type T = ReturnType<typeof useT>["t"];

export type MenuItem =
  | "-"
  | { header: string }
  | { icon?: string; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean; hint?: string };

/** Глобальные действия и данные, которые видит меню. Собирается в App один
 *  раз из уже существующих функций — buildMenuItems не знает про useState. */
export interface MenuContext {
  // — трек каталога —
  /** Вставить сразу после текущего (usePlayback.insertInQueue). */
  playNext: (tr: Track) => void;
  /** В конец очереди (queueCatalog). */
  queueTrack: (tr: Track) => void;
  startRadio: (tr: Track) => void;
  /** Диалог-пикер «В плейлист». */
  addToPlaylist: (tr: Track) => void;
  isLiked: (id: string) => boolean;
  toggleLike: (id: string) => void;
  /** Гость jam: докинуть трек хосту; null — jam не активен или мы хост. */
  jamAdd: ((tr: Track) => void) | null;
  shareTrack: (tr: Track) => void;
  showVersions: (tr: Track) => void;
  /** «Заменить версию» из Любимого (в плейлисте — свой путь через ctl). */
  replaceInFavorites: (tr: Track) => void;
  isPinned: (id: string) => boolean;
  toggleOffline: (tr: Track) => void;
  // — плейлист —
  openPlaylist: (id: string) => void;
  /** Роль в плейлисте; не найден/аноним → "owner" (поведение T17 как было). */
  playlistRole: (id: string) => "owner" | "collaborator" | "follower";
  playPlaylist: (id: string) => void;
  queuePlaylistNext: (id: string) => void;
  queuePlaylist: (id: string) => void;
  sharePlaylist: (id: string) => void;
  savePlaylistOffline: (id: string) => void;
  renamePlaylist: (pl: { id: string; name: string }) => void;
  changePlaylistIcon: (id: string) => void;
  deletePlaylist: (pl: { id: string; name: string }) => void;
  unfollowPlaylist: (pl: { id: string; name: string }) => void;
  // — медиатека (пустое место) —
  openCreatePlaylist: () => void;
  openAddLink: () => void;
  openImport: () => void;
  openJoinCode: () => void;
  // — массовые действия над выделением (2026-07-20) —
  playNextMany: (tracks: Track[]) => void;
  queueMany: (tracks: Track[]) => void;
  addManyToPlaylist: (tracks: Track[]) => void;
  /** Только ДОБАВЛЯЕТ в Любимое: toggle снимал бы лайк с уже лайкнутых
   *  (урок favoritesDrop 20.07). */
  likeMany: (ids: string[]) => void;
  pinMany: (tracks: Track[]) => void;
  // — плагины (T44) —
  pluginMenuItems: (kind: PluginMenuKind) => PluginMenuItem[];
  notifyPlugin: (pluginId: string, slotId: string, payload: unknown) => void;
}

export function buildMenuItems(target: ContextTarget, ctx: MenuContext, t: T): MenuItem[] {
  switch (target.kind) {
    case "track":
      return trackItems(target, ctx, t);
    case "playlist":
      return playlistItems(target, ctx, t);
    case "queueTrack":
      return queueTrackItems(target, ctx, t);
    case "libraryBlank":
      return libraryBlankItems(target.ctl, ctx, t);
    case "playlistBlank":
      return [
        { icon: "square-check-big", label: t("menu.selection.enter"), onClick: target.ctl.enterSelect },
        { icon: "list-checks", label: t("menu.selection.all"), onClick: target.ctl.selectAll },
      ];
    case "selection":
      return selectionItems(target, ctx, t);
    case "playlistSelection":
      return playlistSelectionItems(target, t);
    case "localTrack":
      return localTrackItems(target.ctl, t);
  }
}

/** Меню выделения (ПКМ по выделенному): заголовок-счётчик + массовые
 *  действия. «Убрать…» — только где есть что убирать (ctl.remove). */
function selectionItems(target: Extract<ContextTarget, { kind: "selection" }>, ctx: MenuContext, t: T): MenuItem[] {
  const { tracks, place, ctl } = target;
  const n = tracks.length;
  return [
    { header: t("menu.selection.count", { count: n }) },
    // очередь: playNext/queue добавляли бы КОПИИ уже стоящих в очереди треков
    ...(place === "list"
      ? [
          { icon: "list-start", label: t("menu.catalog.playNext"), onClick: () => ctx.playNextMany(tracks) },
          { icon: "list-end", label: t("menu.catalog.queue"), onClick: () => ctx.queueMany(tracks) },
        ]
      : []),
    { icon: "plus", label: t("menu.addToPlaylist"), onClick: () => ctx.addManyToPlaylist(tracks) },
    { icon: "heart", label: t("menu.catalog.like"), onClick: () => ctx.likeMany(tracks.map((x) => x.id)) },
    { icon: "download", label: t("menu.catalog.saveOffline"), onClick: () => ctx.pinMany(tracks) },
    ...(ctl.remove
      ? ([
          "-",
          {
            icon: "list-x",
            label: ctl.remove.scope === "queue" ? t("menu.queue.remove") : t("views.playlist.removeFromPlaylist"),
            danger: true,
            hint: String(n),
            onClick: ctl.remove.run,
          },
        ] as const)
      : []),
    "-",
    { icon: "x", label: t("menu.selection.clear"), onClick: ctl.clear },
  ];
}

/** Меню выделенных ПЛИТОК плейлистов (медиатека). */
function playlistSelectionItems(
  target: Extract<ContextTarget, { kind: "playlistSelection" }>,
  t: T,
): MenuItem[] {
  const { playlists, ctl } = target;
  return [
    { header: t("menu.selection.count", { count: playlists.length }) },
    { icon: "download", label: t("menu.catalog.saveOffline"), onClick: ctl.saveOffline },
    "-",
    {
      icon: "trash-2",
      label: t("menu.playlist.delete"),
      danger: true,
      hint: String(playlists.length),
      onClick: ctl.requestDelete,
    },
    "-",
    { icon: "x", label: t("menu.selection.clear"), onClick: ctl.clear },
  ];
}

/** Меню трека — единое для всех мест (поиск/хоум/Любимое/статистика/плейлист/
 *  плеер-бар); место решает добавки: «Заменить версию» — только Любимое,
 *  правка состава — только плейлист (через ctl), у играющего сейчас нет
 *  «Играть следующим». */
function trackItems(target: Extract<ContextTarget, { kind: "track" }>, ctx: MenuContext, t: T): MenuItem[] {
  const { track: tr, place, ctl } = target;
  // слоты плагинов track и catalogTrack схлопнуты в один список: с уходом
  // демо-каталога «трек» и «каталожный трек» стали одним и тем же, а
  // menus.track используют уже написанные плагины (examples/hello-plugin)
  const pluginItems = [...ctx.pluginMenuItems("catalogTrack"), ...ctx.pluginMenuItems("track")];
  const liked = ctx.isLiked(tr.id);
  const pinned = ctx.isPinned(tr.id);

  // вьюшные extras плейлиста собираются заранее: разделитель ставится только
  // если из-под гейтов canEdit/canChangeIcon хоть что-то выжило (viewer — ничего)
  const playlistExtras: MenuItem[] =
    ctl && place === "playlist"
      ? [
          ...(ctl.canEdit
            ? [
                { icon: "arrow-up-to-line", label: t("menu.playlistTrack.toStart"), onClick: ctl.moveToStart },
                { icon: "arrow-down-to-line", label: t("menu.playlistTrack.toEnd"), onClick: ctl.moveToEnd },
              ]
            : []),
          ...(ctl.canChangeIcon
            ? [{ icon: "image", label: t("views.playlist.changePlaylistIcon"), onClick: ctl.changeIcon }]
            : []),
          ...(ctl.canEdit
            ? [
                { icon: "refresh-cw", label: t("menu.catalog.replaceVersion"), onClick: ctl.replaceVersion },
                { icon: "list-x", label: t("views.playlist.removeFromPlaylist"), onClick: ctl.removeTrack },
              ]
            : []),
        ]
      : [];

  return [
    ...(place !== "player"
      ? [
          { icon: "list-start", label: t("menu.catalog.playNext"), onClick: () => ctx.playNext(tr) },
          { icon: "list-end", label: t("menu.catalog.queue"), onClick: () => ctx.queueTrack(tr) },
        ]
      : []),
    { icon: "radio", label: t("menu.catalog.radio"), onClick: () => ctx.startRadio(tr) },
    { icon: "plus", label: t("menu.addToPlaylist"), onClick: () => ctx.addToPlaylist(tr) },
    {
      icon: liked ? "heart-off" : "heart",
      label: liked ? t("menu.catalog.unlike") : t("menu.catalog.like"),
      onClick: () => ctx.toggleLike(tr.id),
    },
    ...(ctx.jamAdd
      ? [{ icon: "radio-tower", label: t("menu.catalog.addToJam"), onClick: () => ctx.jamAdd?.(tr) }]
      : []),
    { icon: "share-2", label: t("menu.catalog.share"), onClick: () => ctx.shareTrack(tr) },
    { icon: "git-branch", label: t("menu.catalog.versions"), onClick: () => ctx.showVersions(tr) },
    ...(place === "favorites"
      ? [{ icon: "refresh-cw", label: t("menu.catalog.replaceVersion"), onClick: () => ctx.replaceInFavorites(tr) }]
      : []),
    {
      icon: pinned ? "cloud-off" : "download",
      label: pinned ? t("menu.catalog.removeOffline") : t("menu.catalog.saveOffline"),
      onClick: () => ctx.toggleOffline(tr),
    },
    ...(playlistExtras.length ? (["-"] as const) : []),
    ...playlistExtras,
    ...(pluginItems.length ? (["-"] as const) : []),
    ...pluginItems.map((mi) => ({
      icon: mi.icon || "puzzle",
      label: mi.title,
      onClick: () => ctx.notifyPlugin(mi.pluginId, mi.slotId, { id: tr.id, title: tr.title, artist: tr.artist }),
    })),
  ];
}

/** Меню трека в ОЧЕРЕДИ: операции по id (PlayerTrack не возит каталожную
 *  форму); «В Любимое» — только каталожным трекам, локальный без серверного
 *  id лайкать некуда. */
function queueTrackItems(target: Extract<ContextTarget, { kind: "queueTrack" }>, ctx: MenuContext, t: T): MenuItem[] {
  const { track: tr, ctl } = target;
  const liked = ctx.isLiked(tr.id);
  return [
    { icon: "play", label: t("menu.queue.play"), onClick: ctl.play },
    { icon: "list-start", label: t("menu.queue.playNext"), onClick: ctl.playNext, disabled: !ctl.canPlayNext },
    ...(tr.kind === "catalog"
      ? [
          {
            icon: liked ? "heart-off" : "heart",
            label: liked ? t("menu.catalog.unlike") : t("menu.catalog.like"),
            onClick: () => ctx.toggleLike(tr.id),
          },
        ]
      : []),
    "-",
    { icon: "list-x", label: t("menu.queue.remove"), onClick: ctl.remove },
    { icon: "eraser", label: t("menu.queue.clearAfter"), onClick: ctl.clearAfter, disabled: !ctl.canClearAfter },
  ];
}

/** Меню плейлиста (сайдбар/плитка медиатеки): игровые действия — всем ролям,
 *  владельческие пункты — только owner; подписке — «Убрать из библиотеки». */
function playlistItems(pl: { id: string; name: string }, ctx: MenuContext, t: T): MenuItem[] {
  const role = ctx.playlistRole(pl.id);
  const pluginItems = ctx.pluginMenuItems("playlist");
  return [
    { icon: "list-music", label: t("menu.playlist.open"), onClick: () => ctx.openPlaylist(pl.id) },
    { icon: "play", label: t("menu.playlist.play"), onClick: () => ctx.playPlaylist(pl.id) },
    { icon: "list-start", label: t("menu.playlist.playNext"), onClick: () => ctx.queuePlaylistNext(pl.id) },
    { icon: "list-end", label: t("menu.playlist.queue"), onClick: () => ctx.queuePlaylist(pl.id) },
    "-",
    { icon: "share-2", label: t("menu.catalog.share"), onClick: () => ctx.sharePlaylist(pl.id) },
    { icon: "download", label: t("menu.catalog.saveOffline"), onClick: () => ctx.savePlaylistOffline(pl.id) },
    ...(role === "owner"
      ? ([
          { icon: "pencil", label: t("menu.playlist.rename"), onClick: () => ctx.renamePlaylist(pl) },
          { icon: "image", label: t("menu.playlist.changeIcon"), onClick: () => ctx.changePlaylistIcon(pl.id) },
          "-",
          { icon: "trash-2", label: t("menu.playlist.delete"), danger: true, onClick: () => ctx.deletePlaylist(pl) },
        ] as const)
      : []),
    ...(role === "follower"
      ? ([
          "-",
          { icon: "list-x", label: t("menu.playlist.unfollow"), onClick: () => ctx.unfollowPlaylist(pl) },
        ] as const)
      : []),
    ...(pluginItems.length ? (["-"] as const) : []),
    ...pluginItems.map((mi) => ({
      icon: mi.icon || "puzzle",
      label: mi.title,
      onClick: () => ctx.notifyPlugin(mi.pluginId, mi.slotId, { id: pl.id, name: pl.name }),
    })),
  ];
}

/** ПКМ по пустому месту медиатеки: всё, что раньше пряталось по кнопкам шапки
 *  и сайдбару, плюс вход в выбор плиток. Показывается только серверной
 *  сессии (LibraryView гейтит): анониму нечего предложить, а пустое меню
 *  хуже, чем ничего. */
function libraryBlankItems(
  ctl: Extract<ContextTarget, { kind: "libraryBlank" }>["ctl"],
  ctx: MenuContext,
  t: T,
): MenuItem[] {
  return [
    { icon: "plus", label: t("menu.library.createPlaylist"), onClick: ctx.openCreatePlaylist },
    { icon: "link", label: t("menu.library.addLink"), onClick: ctx.openAddLink },
    { icon: "import", label: t("menu.library.importPlaylist"), onClick: ctx.openImport },
    { icon: "key-round", label: t("menu.library.joinCode"), onClick: ctx.openJoinCode },
    ...(ctl
      ? ([
          "-",
          { icon: "square-check-big", label: t("menu.selection.enterPlaylists"), onClick: ctl.enterSelect },
          { icon: "list-checks", label: t("menu.selection.all"), onClick: ctl.selectAll },
        ] as const)
      : []),
  ];
}

/** Меню локального файла (медиатека → «Локальные»). */
function localTrackItems(ctl: Extract<ContextTarget, { kind: "localTrack" }>["ctl"], t: T): MenuItem[] {
  return [
    ...(ctl.addToPlaylist
      ? [{ icon: "plus", label: t("menu.addToPlaylist"), onClick: ctl.addToPlaylist }]
      : []),
    ...(ctl.reveal
      ? [{ icon: "folder-open", label: t("menu.library.showInFolder"), onClick: ctl.reveal }]
      : []),
    { icon: "trash-2", label: t("views.library.removeFromMuza"), onClick: ctl.forget },
  ];
}
