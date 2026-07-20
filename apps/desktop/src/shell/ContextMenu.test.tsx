import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Track } from "@muza/api-client";
import { ContextMenuProvider, useContextMenu, type ContextMenuApi } from "./ContextMenu";
import type { MenuContext } from "./menuActions";

// Транспорт контекстного меню: открытие с координатами события, закрытие по
// клику/Escape. Наборы пунктов проверяет menuActions.test.ts — здесь только
// механика, поэтому ассерты по РОЛЯМ и порядку (первый пункт трека — «Радио»,
// первый пункт плейлиста — «Открыть»), не по тексту: без LanguageProvider
// t отдаёт английские строки, привязываться к ним хрупко.

afterEach(() => cleanup());

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
    pluginMenuItems: () => [],
    notifyPlugin: vi.fn(),
    ...over,
  };
}

function Row() {
  const { openMenu } = useContextMenu();
  return (
    <div data-testid="row" onContextMenu={(e) => openMenu(e, { kind: "track", track, place: "search" })}>
      row
    </div>
  );
}

function renderWithProvider(ctx = makeCtx(), apiRef?: { current: ContextMenuApi | null }) {
  return render(
    <ContextMenuProvider ctx={ctx} apiRef={apiRef}>
      <Row />
    </ContextMenuProvider>,
  );
}

describe("ContextMenu — транспорт", () => {
  it("ПКМ открывает меню и гасит нативное (preventDefault)", () => {
    renderWithProvider();
    // fireEvent возвращает false, если внутри был preventDefault
    expect(fireEvent.contextMenu(screen.getByTestId("row"), { clientX: 40, clientY: 50 })).toBe(false);
    expect(screen.getByRole("menu")).toBeTruthy();
    // базовый набор каталожного трека вне Любимого: 8 пунктов (см. menuActions.test.ts)
    expect(screen.getAllByRole("menuitem")).toHaveLength(8);
  });

  it("клик по пункту зовёт действие и закрывает меню", () => {
    const ctx = makeCtx();
    renderWithProvider(ctx);
    fireEvent.contextMenu(screen.getByTestId("row"));
    fireEvent.click(screen.getAllByRole("menuitem")[0]); // «Играть следующим» — первый
    expect(ctx.playNext).toHaveBeenCalledWith(track);
    // delayed-unmount: панель ещё в DOM на время exit-анимации, но фон inert
    expect(document.querySelector('[role="menu"]')?.closest("[inert]")).toBeTruthy();
  });

  it("Escape закрывает меню", () => {
    renderWithProvider();
    fireEvent.contextMenu(screen.getByTestId("row"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector('[role="menu"]')?.closest("[inert]")).toBeTruthy();
  });

  it("App-путь: openMenu доступен через apiRef снаружи провайдера", () => {
    const apiRef = { current: null as ContextMenuApi | null };
    renderWithProvider(makeCtx(), apiRef);
    expect(apiRef.current).not.toBeNull();
    const ctx = { preventDefault: () => undefined, stopPropagation: () => undefined };
    // вызов через ref идёт вне React-события (колбэк App) — нужен act
    act(() => {
      apiRef.current?.openMenu({ clientX: 10, clientY: 10, ...ctx }, { kind: "playlist", id: "pl1", name: "P" });
    });
    // владелец: открыть/играть/следующим/в очередь/поделиться/оффлайн/
    // переименовать/иконка/удалить = 9 пунктов (разделители — не menuitem)
    expect(screen.getAllByRole("menuitem")).toHaveLength(9);
  });
});
