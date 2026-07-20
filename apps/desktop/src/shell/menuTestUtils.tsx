import type { ReactNode } from "react";
import { ContextMenuProvider } from "./ContextMenu";
import type { MenuContext } from "./menuActions";

/** Тест-обвязка контекстного меню: вью, зовущие useContextMenu()
 *  (PlaylistView, LibraryView, …), обязаны рендериться внутри провайдера.
 *  Глобальные действия здесь — noop: вьюшные тесты проверяют пункты,
 *  собранные из target.ctl (замыкания самого вью), а матрица глобальных
 *  наборов покрыта отдельно в menuActions.test.ts. */
export function noopMenuCtx(over: Partial<MenuContext> = {}): MenuContext {
  const noop = () => undefined;
  return {
    playNext: noop,
    queueTrack: noop,
    startRadio: noop,
    addToPlaylist: noop,
    isLiked: () => false,
    toggleLike: noop,
    jamAdd: null,
    shareTrack: noop,
    showVersions: noop,
    replaceInFavorites: noop,
    isPinned: () => false,
    toggleOffline: noop,
    openPlaylist: noop,
    playlistRole: () => "owner",
    playPlaylist: noop,
    queuePlaylistNext: noop,
    queuePlaylist: noop,
    sharePlaylist: noop,
    savePlaylistOffline: noop,
    renamePlaylist: noop,
    changePlaylistIcon: noop,
    deletePlaylist: noop,
    unfollowPlaylist: noop,
    openCreatePlaylist: noop,
    openAddLink: noop,
    openImport: noop,
    openJoinCode: noop,
    playNextMany: noop,
    queueMany: noop,
    addManyToPlaylist: noop,
    likeMany: noop,
    pinMany: noop,
    pluginMenuItems: () => [],
    notifyPlugin: noop,
    ...over,
  };
}

export function TestMenuProvider({ ctx, children }: { ctx?: Partial<MenuContext>; children: ReactNode }) {
  return <ContextMenuProvider ctx={noopMenuCtx(ctx)}>{children}</ContextMenuProvider>;
}
