import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { TestMenuProvider } from "../shell/menuTestUtils";
import { PlatformProvider, type LocalFileEntry, type LocalFilesPort } from "../platform";
import { LibraryView } from "./LibraryView";

/** Умение = наличие порта (волна экранов веб-паритета, 2026-08-02).
 *
 *  Медиатека — первый общий экран, который РЕАЛЬНО зависит от площадки:
 *  файлы с диска есть у приложения и не могут появиться у браузера. Тест
 *  сторожит обе стороны договора: без порта вкладки «Локальные» нет ВОВСЕ
 *  (не серой — это правило розетки, packages/app/src/platform/types.ts), с
 *  портом она показывает ровно то, что отдало устройство.
 *
 *  Без LanguageProvider → DEFAULT_LANG="en" (прецедент LibraryView.followed). */

afterEach(() => cleanup());

const entry = (over: Partial<LocalFileEntry> = {}): LocalFileEntry => ({
  hash: "h1",
  path: "C:/music/one.mp3",
  artist: "Someone",
  title: "Some file",
  duration_sec: 154,
  available: true,
  ...over,
});

function fakePort(over: Partial<LocalFilesPort> = {}): LocalFilesPort {
  return {
    list: () => Promise.resolve([entry()]),
    pickAndScan: () => Promise.resolve(null),
    scanPaths: () => Promise.resolve([]),
    resolvePath: () => Promise.resolve(null),
    forget: () => Promise.resolve(),
    serverIds: () => ({}),
    rememberServerId: () => undefined,
    ...over,
  };
}

const noop = () => undefined;

function renderView(port?: LocalFilesPort) {
  return render(
    <PlatformProvider adapter={port ? { localFiles: port } : {}}>
      <TestMenuProvider>
        <DragLayer>
          <LibraryView
            api={{} as MuzaApi}
            canSearch
            srvPlaylists={[]}
            currentId={null}
            playing={false}
            favoritesCount={0}
            onOpenFavorites={noop}
            onOpenPlaylist={noop}
            onNotify={noop}
          />
        </DragLayer>
      </TestMenuProvider>
    </PlatformProvider>,
  );
}

describe("LibraryView — файлы с диска устройства", () => {
  it("площадка без порта: вкладки «Локальные» нет вовсе", () => {
    renderView();

    expect(screen.getByText("Playlists")).toBeTruthy();
    expect(screen.getByText("Albums")).toBeTruthy();
    expect(screen.queryByText("Local")).toBeNull();
  });

  it("порт есть: вкладка показывает список устройства", async () => {
    const list = vi.fn(() => Promise.resolve([entry()]));
    renderView(fakePort({ list }));

    const tab = screen.getByText("Local");
    tab.click();

    await waitFor(() => expect(screen.getByText("Some file")).toBeTruthy());
    expect(list).toHaveBeenCalled();
  });

  it("файла нет на устройстве — строка объясняет это подписью артиста", async () => {
    renderView(fakePort({ list: () => Promise.resolve([entry({ available: false })]) }));

    screen.getByText("Local").click();

    await waitFor(() => expect(screen.getByText(/file not on this device/)).toBeTruthy());
  });
});
