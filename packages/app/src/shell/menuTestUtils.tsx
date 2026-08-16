import type { ReactNode } from "react";
import { ContextMenuProvider } from "./ContextMenu";
import type { MenuContext } from "./menuActions";

/** Тест-обвязка контекстного меню: вью, зовущие useContextMenu()
 *  (PlaylistView, LibraryView, …), обязаны рендериться внутри провайдера.
 *  Глобальные действия здесь — noop: вьюшные тесты проверяют пункты,
 *  собранные из target.ctl (замыкания самого вью), а матрица глобальных
 *  наборов покрыта отдельно в menuActions.test.ts.
 *
 *  Переехало из apps/desktop/src/shell/menuTestUtils.tsx 2026-08-02 вместе с
 *  самим меню; на старом месте пенёк-ре-экспорт.
 *
 *  ⚠️ Набор ПОЛНЫЙ (MenuContext) намеренно: так обвязка повторяет десктоп, где
 *  умеют всё. Тест площадки с урезанным набором должен собирать свой объект
 *  MenuAbilities сам — иначе он проверит не то меню, которое увидит человек. */
export function noopMenuCtx(over: Partial<MenuContext> = {}): MenuContext {
  const noop = () => undefined;
  return {
    playNext: noop,
    queueTrack: noop,
    startRadio: noop,
    addToPlaylist: noop,
    isLiked: () => false,
    toggleLike: noop,
    dislikeTrack: noop,
    openArtist: noop,
    muteArtist: noop,
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
    playlistPinned: () => false,
    togglePlaylistPinned: noop,
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
    copyText: noop,
    pluginMenuItems: () => [],
    notifyPlugin: noop,
    ...over,
  };
}

export function TestMenuProvider({ ctx, children }: { ctx?: Partial<MenuContext>; children: ReactNode }) {
  return <ContextMenuProvider ctx={noopMenuCtx(ctx)}>{children}</ContextMenuProvider>;
}
