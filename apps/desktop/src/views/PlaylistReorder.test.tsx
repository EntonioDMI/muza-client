import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, PlaylistDetail, Track } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { TestMenuProvider } from "../shell/menuTestUtils";
import { PlaylistView } from "./PlaylistView";

/** Реордер строк перетаскиванием — сквозной путь: pointer-жест в DragLayer →
 *  геометрия в dragEngine → PUT на сервер из PlaylistView.
 *
 *  Юнит-тесты dragEngine проверяют математику, но не проводку: между ними легко
 *  потерять payload, зону приёма или порядок id в запросе. Живьём это не
 *  проверить — снапшот Browser-pane в этом окружении виснет (30с) даже на
 *  пустой статике, а синтетические события не запускают нативный HTML5-drag.
 *  Поэтому жест воспроизводится здесь, в jsdom.
 *
 *  Два протеза под jsdom (он не считает раскладку):
 *   - getBoundingClientRect строк — иначе все прямоугольники нулевые и
 *     insertionIndex всегда вернул бы 0;
 *   - document.elementFromPoint — иначе dropTargetAt не найдёт зону и дроп
 *     молча не случится.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const track = (id: string, title: string): Track => ({
  id,
  artist: "A",
  title,
  durationSec: 100,
  coverUrl: null,
  isCached: true,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
});

const detail: PlaylistDetail = {
  id: "pl1",
  name: "Мой микс",
  tracks: [track("t1", "Первый"), track("t2", "Второй"), track("t3", "Третий")],
  isOwner: true,
  role: "owner",
  ownerUsername: "",
  inviteCode: null,
  publicCode: null,
  handle: null,
  visibility: "private",
  followersCount: 0,
  isFollowing: false,
  collaborators: [],
  addedBy: {},
  icon: null,
  iconCoverUrl: null,
};

const noop = () => undefined;
const ROW_H = 40;

function renderView(api: MuzaApi, onNotify: (t: string, i?: string) => void = noop) {
  return render(
    <TestMenuProvider>
    <DragLayer>
      <PlaylistView
        api={api}
        playlistId="pl1"
        userId="u1"
        likes={[]}
        currentId=""
        playing={false}
        onPlayCatalog={noop}
        onLike={noop}
        onNotify={onNotify}
        onReplaceVersion={noop}
        onShare={noop}
        onSaveOffline={noop}
        onChanged={noop}
        onDeleted={noop}
        onChangeIcon={noop}
      />
    </DragLayer>
    </TestMenuProvider>,
  );
}

/** Строки-обёртки в порядке отрисовки (у каждой draggable). */
function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[draggable]"));
}

/** Разложить строки подряд по ROW_H от y=0 и научить jsdom их «видеть». */
function layout(container: HTMLElement): void {
  rows(container).forEach((el, i) => {
    el.getBoundingClientRect = () =>
      ({ top: i * ROW_H, bottom: (i + 1) * ROW_H, left: 0, right: 200, width: 200, height: ROW_H, x: 0, y: i * ROW_H, toJSON: () => ({}) }) as DOMRect;
  });
  // дроп-зона — контейнер списка (на нём data-muza-drop)
  const zone = container.querySelector<HTMLElement>("[data-muza-drop]");
  document.elementFromPoint = () => zone;
}

function pointer(type: string, y: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y, button: 0, pointerId: 1 });
}

/** Жест: взять строку `from` и отпустить на высоте `y`. Подъём — рывком через
 *  DRAG_THRESHOLD, одним pointermove. */
function dragRow(container: HTMLElement, from: number, y: number): void {
  act(() => {
    rows(container)[from].dispatchEvent(pointer("pointerdown", from * ROW_H + 10));
  });
  act(() => {
    window.dispatchEvent(pointer("pointermove", y));
  });
  act(() => {
    window.dispatchEvent(pointer("pointerup", y));
  });
}

/** Тот же жест, но как его делает НАСТОЯЩАЯ мышь: pointermove летит каждые
 *  ~8-16мс, и курсор проходит все промежуточные точки, а не телепортируется.
 *
 *  Разница не косметическая. `dragRow` прыгает к цели одним событием и потому
 *  перескакивает полосу между slop'ом и порогом подъёма — а владелец в неё
 *  попадает всегда, потому что тянет сразу. Ради этого хелпер и живёт отдельно:
 *  любой порог, недостижимый при плавном движении, здесь падает. */
function dragRowGradually(container: HTMLElement, from: number, y: number, step = 5): void {
  const y0 = from * ROW_H + 10;
  act(() => {
    rows(container)[from].dispatchEvent(pointer("pointerdown", y0));
  });
  const dir = Math.sign(y - y0) || 1;
  for (let cur = y0 + dir * step; dir * (y - cur) > 0; cur += dir * step) {
    act(() => {
      window.dispatchEvent(pointer("pointermove", cur));
    });
  }
  act(() => {
    window.dispatchEvent(pointer("pointermove", y));
  });
  act(() => {
    window.dispatchEvent(pointer("pointerup", y));
  });
}

describe("Реордер плейлиста перетаскиванием", () => {
  it("тащим первую строку вниз — сервер получает ВЕСЬ новый порядок", async () => {
    const reorderPlaylist = vi.fn().mockResolvedValue(undefined);
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail), reorderPlaylist } as unknown as MuzaApi;
    const { container } = renderView(api);
    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());
    layout(container);

    // y=105 — ниже середины третьей строки (mid=100) → встаём в конец
    dragRow(container, 0, 105);

    await waitFor(() => expect(reorderPlaylist).toHaveBeenCalledTimes(1));
    expect(reorderPlaylist).toHaveBeenCalledWith("pl1", ["t2", "t3", "t1"]);
  });

  it("тащим ПЛАВНО, как настоящей мышью — перенос обязан начаться", async () => {
    const reorderPlaylist = vi.fn().mockResolvedValue(undefined);
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail), reorderPlaylist } as unknown as MuzaApi;
    const { container } = renderView(api);
    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());
    layout(container);

    // Ровно то, что делает владелец: нажал и сразу потянул, без удержания.
    dragRowGradually(container, 0, 105);

    await waitFor(() => expect(reorderPlaylist).toHaveBeenCalledWith("pl1", ["t2", "t3", "t1"]));
  });

  /** Гонка, которую видно только на живой мыши: между pointermove и pointerup
   *  React может не успеть перерисоваться, и dragRef — он обновляется В РЕНДЕРЕ —
   *  на момент отпускания ещё пуст. Обработчик up на этом выходит вхолостую, а
   *  назначенный рендер потом всё равно рисует карточку: снимать её уже некому.
   *
   *  Прежние тесты гонку не видели: каждое событие шло в своём act(), а act()
   *  прогоняет рендер, так что dragRef всегда оказывался заполнен. Здесь все три
   *  события — в одном act(), как их и получает приложение. */
  it("отпустили сразу после рывка — карточка не залипает на курсоре", async () => {
    const reorderPlaylist = vi.fn().mockResolvedValue(undefined);
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail), reorderPlaylist } as unknown as MuzaApi;
    const { container } = renderView(api);
    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());
    layout(container);

    act(() => {
      rows(container)[0].dispatchEvent(pointer("pointerdown", 10));
      window.dispatchEvent(pointer("pointermove", 105));
      window.dispatchEvent(pointer("pointerup", 105));
    });

    // Превью печатает название трека — залипшая карточка даёт второй «Первый».
    expect(screen.getAllByText("Первый")).toHaveLength(1);
  });

  it("тащим последнюю строку вверх", async () => {
    const reorderPlaylist = vi.fn().mockResolvedValue(undefined);
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail), reorderPlaylist } as unknown as MuzaApi;
    const { container } = renderView(api);
    await waitFor(() => expect(screen.getByText("Третий")).toBeTruthy());
    layout(container);

    // y=5 — выше середины первой строки (mid=20) → встаём в начало
    dragRow(container, 2, 5);

    await waitFor(() => expect(reorderPlaylist).toHaveBeenCalledWith("pl1", ["t3", "t1", "t2"]));
  });

  it("подняли и бросили в свой же слот — на сервер не ходим", async () => {
    const reorderPlaylist = vi.fn().mockResolvedValue(undefined);
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail), reorderPlaylist } as unknown as MuzaApi;
    const { container } = renderView(api);
    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());
    layout(container);

    // Взяли строку 1 (y=50) и увели на y=25: рывок в 25px больше
    // DRAG_THRESHOLD, поэтому карточка реально поднимается, — но 25 всё ещё
    // выше середины своей строки (60) и ниже середины первой (20), то есть
    // индекс вставки равен исходному. Важно поднять по-настоящему: жест без
    // подъёма не дошёл бы до дропа вообще и тест был бы пустым.
    dragRow(container, 1, 25);

    expect(reorderPlaylist).not.toHaveBeenCalled();
  });

  it("сервер отказал — порядок откатывается и владелец видит тост", async () => {
    const reorderPlaylist = vi.fn().mockRejectedValue(new Error("403 нет доступа"));
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail), reorderPlaylist } as unknown as MuzaApi;
    const onNotify = vi.fn();
    const { container } = renderView(api, onNotify);
    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());
    layout(container);

    dragRow(container, 0, 105);

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("403 нет доступа", "x"));
    // откат: «Первый» снова первый в списке
    await waitFor(() => {
      const titles = rows(container).map((el) => el.textContent);
      expect(titles[0]).toContain("Первый");
    });
  });
});
