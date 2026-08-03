/** Признак занятости поиска НЕ заложник номера запроса (правка 2026-08-03).
 *
 *  Симптом: ввёл «radiohead», нажал «Искать в источниках» (секунды — сервер
 *  поднимает провайдеры), дописал букву — и всё, приехали. Ответ полного поиска
 *  возвращался с УЖЕ устаревшим номером (живой ввод двигает номер на каждую
 *  букву), `setBusy(false)` стоял под сверкой номера и не выполнялся: кнопка
 *  навсегда серая, под выдачей навсегда «Ищем в источниках…». Лечилось только
 *  очисткой строки поиска.
 *
 *  Разделение, которое стерегут эти тесты: НОМЕР отсекает устаревшие ДАННЫЕ
 *  (чужой ответ не пишет выдачу), ЗАНЯТОСТЬ принадлежит кнопке и снимается
 *  всегда — и на успехе, и на отказе.
 *
 *  Без LanguageProvider useT() отдаёт DEFAULT_LANG="en" — ассерты английские. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError, type GroupedSearchResult, type MuzaApi } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { TestMenuProvider } from "../shell/menuTestUtils";
import { SearchView } from "./SearchView";

afterEach(() => cleanup());

const track = (id: string) => ({
  id,
  artist: "A",
  title: `Трек ${id}`,
  durationSec: 100,
  coverUrl: null,
  isCached: false,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
});

const single = (id: string): GroupedSearchResult => ({ kind: "single", track: track(id) });

/** Промис, который тест разрешает руками — окно «полный поиск ещё идёт». */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const noop = () => undefined;

function Harness({ api }: { api: MuzaApi }) {
  const [q, setQ] = useState("");
  return (
    <SearchView
      api={api}
      canSearch
      currentId={null}
      playing={false}
      likes={[]}
      query={q}
      onQueryChange={setQ}
      onPlayCatalog={noop}
      onLike={noop}
      onNotify={noop}
      onCatalogMenu={noop}
      onOpenPlaylist={noop}
      onOpenScPlaylist={noop}
    />
  );
}

function renderView(api: MuzaApi) {
  return render(
    <TestMenuProvider>
      <DragLayer>
        <Harness api={api} />
      </DragLayer>
    </TestMenuProvider>,
  );
}

const typeQuery = (value: string) => {
  fireEvent.change(screen.getByPlaceholderText("Track, artist, album"), { target: { value } });
};

const sourcesButton = () => screen.getByRole("button", { name: /Search in sources|Searching/ });

describe("SearchView — «Искать в источниках» не залипает", () => {
  it("дописал букву, пока идёт полный поиск → ответ пришёл, кнопка снова живая", async () => {
    const full = deferred<GroupedSearchResult[]>();
    const searchGrouped = vi.fn((_q: string, opts?: { scope?: string }) =>
      opts?.scope === "full" ? full.promise : Promise.resolve([single("catalog-1")]),
    );
    const api = {
      searchGrouped,
      search: vi.fn().mockResolvedValue([]),
      searchPublicPlaylists: vi.fn().mockResolvedValue([]),
    } as unknown as MuzaApi;
    renderView(api);

    typeQuery("radiohead");
    fireEvent.click(sourcesButton());
    // занятость видна: кнопка недоступна, под выдачей строка ожидания
    await waitFor(() => expect(sourcesButton().hasAttribute("disabled")).toBe(true));
    expect(screen.getByText(/Searching in sources/)).toBeTruthy();

    // ⚠️ вот он, сценарий: живой ввод двигает номер, пока полный поиск в пути
    typeQuery("radioheadd");
    full.resolve([single("full-1")]);

    await waitFor(() => expect(sourcesButton().hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText(/Searching in sources/)).toBeNull();
  });

  it("устаревший ответ занятость снимает, а ВЫДАЧУ не пишет", async () => {
    const full = deferred<GroupedSearchResult[]>();
    const searchGrouped = vi.fn((_q: string, opts?: { scope?: string }) =>
      opts?.scope === "full" ? full.promise : Promise.resolve([single("catalog-1")]),
    );
    const api = {
      searchGrouped,
      search: vi.fn().mockResolvedValue([]),
      searchPublicPlaylists: vi.fn().mockResolvedValue([]),
    } as unknown as MuzaApi;
    renderView(api);

    typeQuery("radiohead");
    fireEvent.click(sourcesButton());
    await waitFor(() => expect(sourcesButton().hasAttribute("disabled")).toBe(true));

    typeQuery("radioheadd");
    full.resolve([single("full-1")]);

    await waitFor(() => expect(sourcesButton().hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText("Трек full-1")).toBeNull();
  });

  it("отказ сервера тоже снимает занятость (иначе кнопка мертва до очистки строки)", async () => {
    const full = deferred<GroupedSearchResult[]>();
    const api = {
      searchGrouped: vi.fn((_q: string, opts?: { scope?: string }) =>
        opts?.scope === "full" ? full.promise : Promise.resolve([]),
      ),
      search: vi.fn().mockResolvedValue([]),
      searchPublicPlaylists: vi.fn().mockResolvedValue([]),
    } as unknown as MuzaApi;
    renderView(api);

    typeQuery("radiohead");
    fireEvent.click(sourcesButton());
    await waitFor(() => expect(sourcesButton().hasAttribute("disabled")).toBe(true));

    typeQuery("radioheadd");
    full.reject(new ApiError(503, "Источники недоступны"));

    await waitFor(() => expect(sourcesButton().hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText(/Searching in sources/)).toBeNull();
  });
});

describe("SearchView — «Загрузить ещё» не залипает", () => {
  it("дописал букву, пока грузится продолжение → кнопка снова живая", async () => {
    const more = deferred<GroupedSearchResult[]>();
    let calls = 0;
    const api = {
      searchGrouped: vi.fn((_q: string, opts?: { limit?: number }) => {
        calls += 1;
        // первый вызов — живой каталожный поиск (лимит 30), дальше «ещё»
        return opts?.limit === 30 && calls === 1 ? Promise.resolve([single("a")]) : more.promise;
      }),
      search: vi.fn().mockResolvedValue([]),
      searchPublicPlaylists: vi.fn().mockResolvedValue([]),
    } as unknown as MuzaApi;
    renderView(api);

    typeQuery("radiohead");
    const loadMore = await screen.findByRole("button", { name: "Load more" });
    fireEvent.click(loadMore);
    await waitFor(() => expect(screen.getByRole("button", { name: "Loading…" })).toBeTruthy());

    typeQuery("radioheadd");
    more.resolve([single("b")]);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Loading…" })).toBeNull());
  });
});
