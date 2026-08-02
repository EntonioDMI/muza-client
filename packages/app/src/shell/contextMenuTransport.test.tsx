import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Track } from "@muza/api-client";
import { ContextMenuProvider, useContextMenu, type MenuAbilities } from "./ContextMenu";

// Транспорт меню на ВТОРОЙ площадке. Матрицу пунктов и механику открытия/
// закрытия проверяют menuAbilities.test.ts и десктопный ContextMenu.test.tsx;
// здесь — только разница площадок: нативное меню браузера остаётся человеку.

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

const abilities: MenuAbilities = { addToPlaylist: () => undefined };

function Row() {
  const { openMenu } = useContextMenu<MenuAbilities>();
  return (
    <div data-testid="row" onContextMenu={(e) => openMenu(e, { kind: "track", track, place: "search" })}>
      row
    </div>
  );
}

/** ПКМ мимо любых строк — прямо по body. */
function contextMenuOnBody(): boolean {
  return fireEvent.contextMenu(document.body, { clientX: 5, clientY: 5 });
}

describe("ContextMenuProvider: нативное меню площадки", () => {
  it("по умолчанию (приложение) нативное меню давится везде", () => {
    render(
      <ContextMenuProvider ctx={abilities}>
        <Row />
      </ContextMenuProvider>,
    );
    // fireEvent возвращает false, если внутри был preventDefault
    expect(contextMenuOnBody()).toBe(false);
  });

  it("suppressNativeMenu={false} (браузер): меню страницы НЕ отбирается", () => {
    render(
      <ContextMenuProvider ctx={abilities} suppressNativeMenu={false}>
        <Row />
      </ContextMenuProvider>,
    );
    expect(contextMenuOnBody()).toBe(true);
  });

  it("на строке своё меню открывается и гасит нативное даже без подавителя", () => {
    render(
      <ContextMenuProvider ctx={abilities} suppressNativeMenu={false}>
        <Row />
      </ContextMenuProvider>,
    );
    expect(fireEvent.contextMenu(screen.getByTestId("row"), { clientX: 40, clientY: 50 })).toBe(false);
    // умений у площадки одно — и пункт ровно один
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });
});
