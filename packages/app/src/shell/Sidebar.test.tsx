import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { DragLayer } from "./DragLayer";
import { Sidebar, type SidebarPlaylist } from "./Sidebar";

/** Боковая панель: то, что легко потерять при переезде из приложения в общий
 *  пакет, и то, чего в вебе не было вовсе.
 *
 *  Главная проверка здесь — СИСТЕМА КООРДИНАТ индекса реордера. Панель отдаёт
 *  в перетаскивание только подвижные строки (подписки и закреплённые
 *  исключены), поэтому toIndex приходит в координатах УРЕЗАННОГО списка.
 *  Вызывающий, применивший его к полному списку, промахнётся ровно на число
 *  исключённых — именно это чинили в приложении 2026-08-02, и именно это
 *  ловит тест «индекс — в координатах подвижных».
 *
 *  Протезы под jsdom (он не считает раскладку) — те же два, что в
 *  apps/desktop/src/views/PlaylistReorder.test.tsx: прямоугольники строк и
 *  document.elementFromPoint. */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PLAYLISTS: SidebarPlaylist[] = [
  { id: "pin", name: "Закреплённый", meta: "1 тр.", pinned: true, fixed: true },
  { id: "a", name: "Альфа", meta: "2 тр." },
  { id: "b", name: "Бета", meta: "3 тр." },
  { id: "c", name: "Гамма", meta: "4 тр." },
  { id: "sub", name: "Подписка", meta: "5 тр.", fixed: true },
];

const ROW_H = 56;
const noop = () => undefined;

function renderSidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <DragLayer>
      <Sidebar
        logoSrc="/glyph.svg"
        nav={[{ key: "home", icon: "home", label: "Главная" }]}
        activeNavKey="home"
        onSelectNav={noop}
        playlists={PLAYLISTS}
        favoritesCount={3}
        favoritesActive={false}
        onOpenFavorites={noop}
        onOpenPlaylist={noop}
        onOpenSettings={noop}
        onDropTrack={noop}
        onReorderPlaylists={noop}
        {...props}
      />
    </DragLayer>,
  );
}

/** Обёртка строки по имени плейлиста. Искать по data-muza-drop нельзя: у
 *  fixed-строк зоны приёма НЕТ вовсе (и это отдельно проверяется ниже), так
 *  что такой селектор молча пропустил бы закреплённую и подписку. */
function rowOf(container: HTMLElement, name: string): HTMLElement {
  const label = Array.from(container.querySelectorAll("span")).find((s) => s.textContent === name);
  const row = label?.closest("div");
  if (!row) throw new Error(`строка «${name}» не найдена`);
  return row;
}

function rows(container: HTMLElement): HTMLElement[] {
  return PLAYLISTS.map((p) => rowOf(container, p.name));
}

/** Разложить строки подряд по ROW_H и научить jsdom их «видеть». Первая
 *  строка списка — «Любимое», поэтому плейлисты начинаются с ROW_H. */
function layout(container: HTMLElement): void {
  rows(container).forEach((el, i) => {
    const top = (i + 1) * ROW_H;
    el.getBoundingClientRect = () =>
      ({ top, bottom: top + ROW_H, left: 0, right: 240, width: 240, height: ROW_H, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  });
}

function pointer(type: string, y: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y, button: 0, pointerId: 1 });
}

/** Взять строку и отпустить на высоте y. Жест ловится ВСЕЙ строкой (владелец
 *  04.08: «было бы удобнее хвататься за весь блок»), точки-⠿ остались только
 *  подсказкой. Подъём — рывком через DRAG_THRESHOLD; порядок коммитится прямо
 *  в pointerup: предпросмотр живой, и ждать посадки больше нечего. */
function dragByGrip(row: HTMLElement, fromY: number, toY: number): void {
  if (!row.querySelector('[data-testid="reorder-grip"]')) throw new Error("строка не переставляется");
  act(() => {
    row.dispatchEvent(pointer("pointerdown", fromY));
  });
  // Двух движений мало не по прихоти: ПЕРВОЕ только поднимает плашку (курсор
  // проехал DRAG_THRESHOLD) и на этом выходит, будущую позицию не считая.
  // Живая мышь шлёт события каждые ~8-16мс, так что одиночного move не бывает,
  // но синтетический жест обязан это повторить — иначе `to` навсегда равен
  // `from` и коммита не происходит вовсе.
  act(() => {
    window.dispatchEvent(pointer("pointermove", toY));
  });
  act(() => {
    window.dispatchEvent(pointer("pointermove", toY));
  });
  act(() => {
    window.dispatchEvent(pointer("pointerup", toY));
  });
}

describe("Боковая панель: реордер плейлистов", () => {
  it("ручка есть только у подвижных строк: ни у закреплённой, ни у подписки", () => {
    const { container } = renderSidebar();
    const withGrip = rows(container).map((r) => Boolean(r.querySelector('[data-testid="reorder-grip"]')));
    expect(withGrip).toEqual([false, true, true, true, false]);
  });

  it("нет onReorderPlaylists — нет и ручек (веб без права на порядок)", () => {
    const { container } = renderSidebar({ onReorderPlaylists: undefined });
    expect(rows(container).every((r) => !r.querySelector('[data-testid="reorder-grip"]'))).toBe(true);
  });

  it("индекс — в координатах ПОДВИЖНЫХ строк, а не полного списка", async () => {
    vi.useFakeTimers();
    const onReorderPlaylists = vi.fn();
    const { container } = renderSidebar({ onReorderPlaylists });
    layout(container);

    // Тащим «Альфу» (в полном списке индекс 1, среди подвижных — 0) ниже
    // середины «Гаммы». Среди подвижных [a,b,c] она встаёт последней → 2.
    // Если бы индекс считался по полному списку [pin,a,b,c,sub], это было бы 3.
    dragByGrip(rowOf(container, "Альфа"), 2 * ROW_H + 10, 5 * ROW_H - 10);
    act(() => {
      vi.advanceTimersByTime(200); // посадка плашки, затем коммит
    });

    expect(onReorderPlaylists).toHaveBeenCalledWith("a", 2);
    vi.useRealTimers();
  });

  it("подняли и вернули в свой слот — порядок не трогаем", () => {
    vi.useFakeTimers();
    const onReorderPlaylists = vi.fn();
    const { container } = renderSidebar({ onReorderPlaylists });
    layout(container);

    // «Бета» (подвижный индекс 1): рывок в 20px поднимает плашку, но курсор
    // остаётся между серединами соседей — индекс вставки прежний.
    dragByGrip(rowOf(container, "Бета"), 3 * ROW_H + 10, 3 * ROW_H + 30);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onReorderPlaylists).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("Боковая панель: приём трека", () => {
  it("HTML5-мост: трек, брошенный на плейлист, доходит до колбэка", () => {
    const onDropTrack = vi.fn();
    const { container } = renderSidebar({
      onDropTrack,
      externalDrop: {
        accepts: (e) => e.dataTransfer.types.includes("application/x-muza-track"),
        trackId: (e) => JSON.parse(e.dataTransfer.getData("application/x-muza-track")).id,
      },
    });
    const row = rowOf(container, "Альфа");
    const dataTransfer = {
      types: ["application/x-muza-track"],
      dropEffect: "none",
      getData: () => JSON.stringify({ id: "t42" }),
    };
    fireEvent.dragOver(row, { dataTransfer });
    fireEvent.drop(row, { dataTransfer });
    expect(onDropTrack).toHaveBeenCalledWith("a", "t42");
  });

  it("без моста обработчиков перетаскивания в разметке нет (приложение)", () => {
    const onDropTrack = vi.fn();
    const { container } = renderSidebar({ onDropTrack });
    const row = rowOf(container, "Альфа");
    fireEvent.drop(row, { dataTransfer: { types: [], getData: () => "" } });
    expect(onDropTrack).not.toHaveBeenCalled();
  });

  it("на закреплённый и на подписку трек не принимается", () => {
    const { container } = renderSidebar();
    // Зона приёма есть только у подвижных строк: у fixed её нет ВОВСЕ — не
    // «есть, но игнорирует». Смысл закрепа как раз в том, чтобы в него
    // случайно ничего не попало.
    const ids = rows(container).map((r) => r.getAttribute("data-muza-drop"));
    expect(ids).toEqual([null, "sidebar-playlist:a", "sidebar-playlist:b", "sidebar-playlist:c", null]);
  });
});

describe("Боковая панель: площадка", () => {
  it("логотип берётся пропом (в общем пакете .svg импортировать нельзя)", () => {
    const { container } = renderSidebar({ logoSrc: "/glyph.svg" });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/glyph.svg");
  });

  it("плашка «Web» рисуется, когда её передали, и не мешает приложению", () => {
    const { container, rerender } = renderSidebar({ badge: <span data-testid="badge">web</span> });
    expect(container.querySelector('[data-testid="badge"]')).toBeTruthy();
    rerender(
      <DragLayer>
        <Sidebar
          logoSrc="/glyph.svg"
          nav={[]}
          activeNavKey={null}
          onSelectNav={noop}
          playlists={[]}
          favoritesCount={0}
          favoritesActive={false}
          onOpenFavorites={noop}
          onOpenPlaylist={noop}
          onOpenSettings={noop}
        />
      </DragLayer>,
    );
    expect(container.querySelector('[data-testid="badge"]')).toBeNull();
  });

  it("кнопки «?» и «Админка» появляются только с колбэками", () => {
    const { container } = renderSidebar();
    const labels = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels.some((l) => l?.includes("Admin") || l?.includes("Админка"))).toBe(false);
  });
});
