import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { HistoryItem, MuzaApi, Track } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { TestMenuProvider } from "../shell/menuTestUtils";
import { PlatformProvider } from "../platform";
import { LibraryView } from "./LibraryView";

/** Вкладка «История» — регрессия волны экранов (2026-08-02).
 *
 *  Вкладка жила отдельной веб-страницей и пропала, когда медиатека стала общим
 *  экраном: пользователь веба потерял список, которого в приложении и не было.
 *  Вернули её сюда — в ОБЩИЙ экран, по тому же правилу, что и остальные части
 *  медиатеки: показывается ровно там, где программа дала обработчик
 *  воспроизведения (играть список нечем — показывать его нечестно).
 *
 *  Тест сторожит обе стороны договора: без обработчика вкладки нет ВОВСЕ (не
 *  серой), с обработчиком она отдаёт серверный список и играет его КАК ЦЕЛОЕ,
 *  с нажатой позиции, — а не один трек в пустой очереди.
 *
 *  Без LanguageProvider → DEFAULT_LANG="en" (прецедент LibraryView.followed). */

afterEach(() => cleanup());

const track = (id: string, title: string): Track => ({
  id,
  artist: "Someone",
  title,
  durationSec: 154,
  coverUrl: null,
  isCached: false,
  sources: [],
  loudness: null,
  localHash: null,
});

const items: HistoryItem[] = [
  { track: track("t1", "First song"), playedAt: "2026-08-02T10:00:00Z", completed: true },
  { track: track("t2", "Second song"), playedAt: "2026-08-02T09:00:00Z", completed: true },
  // тот же трек второй раз: в истории это ДВЕ строки, а не одна
  { track: track("t1", "First song"), playedAt: "2026-08-02T08:00:00Z", completed: false },
];

const noop = () => undefined;

function renderView(onPlayHistory?: (tracks: Track[], startIndex: number) => void, getHistory = vi.fn(() => Promise.resolve(items))) {
  render(
    <PlatformProvider adapter={{}}>
      <TestMenuProvider>
        <DragLayer>
          <LibraryView
            api={{ getHistory } as unknown as MuzaApi}
            canSearch
            srvPlaylists={[]}
            currentId={null}
            playing={false}
            favoritesCount={0}
            onOpenFavorites={noop}
            onOpenPlaylist={noop}
            onPlayHistory={onPlayHistory}
            onNotify={noop}
          />
        </DragLayer>
      </TestMenuProvider>
    </PlatformProvider>,
  );
  return getHistory;
}

describe("LibraryView — вкладка «История»", () => {
  it("программа не умеет играть список: вкладки нет вовсе", () => {
    renderView();

    expect(screen.getByText("Playlists")).toBeTruthy();
    expect(screen.queryByText("History")).toBeNull();
  });

  it("умеет: вкладка показывает серверный список, повторы — отдельными строками", async () => {
    const getHistory = renderView(noop);

    screen.getByText("History").click();

    await waitFor(() => expect(screen.getAllByText("First song").length).toBe(2));
    expect(screen.getByText("Second song")).toBeTruthy();
    expect(getHistory).toHaveBeenCalledWith(50);
  });

  it("нажатие на строке играет ВЕСЬ список с этой позиции", async () => {
    const onPlay = vi.fn();
    renderView(onPlay);

    screen.getByText("History").click();
    await waitFor(() => expect(screen.getByText("Second song")).toBeTruthy());

    // вторая строка списка — «Second song».
    // Ищем по aria-label напрямую: getAllByRole в этой связке jsdom+dom-testing
    // клонирует узлы и спотыкается о наши инлайн-стили (короткая запись
    // background), а нам нужна кнопка, а не проверка ролей.
    document.querySelector<HTMLElement>('[aria-label="Listen: Second song"]')!.click();

    expect(onPlay).toHaveBeenCalledTimes(1);
    const [tracks, index] = onPlay.mock.calls[0];
    expect(tracks.map((x: Track) => x.title)).toEqual(["First song", "Second song", "First song"]);
    expect(index).toBe(1);
  });

  it("сервер не ответил — вместо белого экрана пустое состояние", async () => {
    renderView(noop, vi.fn(() => Promise.reject(new Error("нет сети"))) as never);

    screen.getByText("History").click();

    await waitFor(() => expect(screen.getByText("History is empty")).toBeTruthy());
  });
});
