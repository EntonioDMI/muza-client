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
    scanPaths: () => Promise.resolve({ entries: [], found: 0, truncated: false }),
    resolvePath: () => Promise.resolve(null),
    forget: () => Promise.resolve(),
    serverIds: () => ({}),
    rememberServerId: () => undefined,
    ...over,
  };
}

const noop = () => undefined;

function renderView(
  port?: LocalFilesPort,
  opts: { onNotify?: (text: string, icon?: string) => void; canSearch?: boolean } = {},
) {
  return render(
    <PlatformProvider adapter={port ? { localFiles: port } : {}}>
      <TestMenuProvider>
        <DragLayer>
          <LibraryView
            api={{} as MuzaApi}
            canSearch={opts.canSearch ?? true}
            srvPlaylists={[]}
            currentId={null}
            playing={false}
            favoritesCount={0}
            onOpenFavorites={noop}
            onOpenPlaylist={noop}
            onNotify={opts.onNotify ?? noop}
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

  /** РЕГРЕСС ЖАЛОБЫ 12.08 «локальная библиотека не работает».
   *
   *  Сканер отдавал просто массив, и три РАЗНЫХ исхода приходили одинаково
   *  пустыми. Человек на все три видел «No audio files found» и шёл искать
   *  музыку в другой папке — даже когда музыка была найдена, но не открылась.
   *  Тесты сторожат, что каждый исход говорит своё. */
  describe("итог скана: три исхода, а не один", () => {
    async function pickFolder(result: Awaited<ReturnType<LocalFilesPort["pickAndScan"]>>) {
      const notify = vi.fn();
      renderView(fakePort({ pickAndScan: () => Promise.resolve(result) }), {
        onNotify: notify,
        canSearch: false, // регистрация на сервере к этой проверке отношения не имеет
      });
      screen.getByText("Local").click();
      await waitFor(() => expect(screen.getByText("Add folder")).toBeTruthy());
      screen.getByText("Add folder").click();
      await waitFor(() => expect(notify).toHaveBeenCalled());
      return String(notify.mock.calls[0][0]);
    }

    it("в папке правда нет музыки — так и говорим", async () => {
      const text = await pickFolder({ entries: [], found: 0, truncated: false });
      expect(text).toMatch(/No audio files found/);
    });

    it("файлы есть, но ни один не открылся — это ДРУГОЙ текст", async () => {
      const text = await pickFolder({ entries: [], found: 7, truncated: false });
      expect(text).toMatch(/none of them opened/);
      expect(text).toContain("7");
      expect(text).not.toMatch(/No audio files found/);
    });

    it("упёрлись в потолок — говорим, что взяли не всё", async () => {
      const text = await pickFolder({ entries: [entry()], found: 1, truncated: true });
      expect(text).toMatch(/There are more in that folder/);
    });
  });
});
