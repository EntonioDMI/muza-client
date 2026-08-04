/** Граница режима правки вида на живой разметке: ВНЕ его вкладка обязана
 *  вести себя ровно как прежде (клик переключает экран), внутри — становиться
 *  хватаемой и переставляемой с клавиатуры.
 *
 *  Проверяется именно эта граница, а не жест: сам жест общий с реордером
 *  плейлистов (useLocalReorder) и покрыт там, а вот «клик перестал уводить на
 *  экран» — ровно та поломка, которой это изменение опаснее всего.
 *
 *  Клавиатура здесь не «плюс к тестам»: без неё перестановка недоступна тому,
 *  кто не берёт мышь, а сломать её незаметно проще всего — обработчик висит на
 *  той же кнопке, что и переход по экрану. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DragLayer } from "./DragLayer";
import { LookEditProvider } from "./lookReorder";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

const noop = () => undefined;

const NAV = [
  { key: "home", icon: "home", label: "Главная" },
  { key: "search", icon: "search", label: "Поиск" },
  { key: "library", icon: "library-big", label: "Медиатека" },
];

function renderSidebar(lookEdit: boolean, handlers: { onSelectNav?: (k: string) => void; onReorderNav?: (k: string[]) => void }) {
  return render(
    <LookEditProvider active={lookEdit}>
      <DragLayer>
        <Sidebar
          logoSrc="/glyph.svg"
          nav={NAV}
          activeNavKey="home"
          onSelectNav={handlers.onSelectNav ?? noop}
          onReorderNav={handlers.onReorderNav}
          playlists={[]}
          favoritesCount={0}
          favoritesActive={false}
          onOpenFavorites={noop}
          onOpenPlaylist={noop}
          onOpenSettings={noop}
        />
      </DragLayer>
    </LookEditProvider>,
  );
}

/** Кнопка вкладки по её подписи. В режиме правки у кнопки появляется
 *  aria-label — ищем по тексту, он есть всегда. */
const tab = (label: string) => screen.getByText(label).closest("button") as HTMLElement;

describe("вкладки сайдбара вне режима правки", () => {
  it("клик по-прежнему переключает экран", () => {
    const onSelectNav = vi.fn();
    renderSidebar(false, { onSelectNav, onReorderNav: vi.fn() });
    fireEvent.click(tab("Поиск"));
    expect(onSelectNav).toHaveBeenCalledWith("search");
  });

  it("стрелка ничего не переставляет", () => {
    const onReorderNav = vi.fn();
    renderSidebar(false, { onReorderNav });
    fireEvent.keyDown(tab("Поиск"), { key: "ArrowDown" });
    expect(onReorderNav).not.toHaveBeenCalled();
  });
});

describe("вкладки сайдбара в режиме правки", () => {
  it("клик НЕ уводит на экран — рука в этом режиме занята другим", () => {
    const onSelectNav = vi.fn();
    renderSidebar(true, { onSelectNav, onReorderNav: vi.fn() });
    fireEvent.click(tab("Поиск"));
    expect(onSelectNav).not.toHaveBeenCalled();
  });

  it("стрелка вниз меняет вкладку местами с соседней", () => {
    const onReorderNav = vi.fn();
    renderSidebar(true, { onReorderNav });
    fireEvent.keyDown(tab("Поиск"), { key: "ArrowDown" });
    expect(onReorderNav).toHaveBeenCalledWith(["home", "library", "search"]);
  });

  it("стрелка вверх у первой вкладки не выбрасывает её из списка", () => {
    const onReorderNav = vi.fn();
    renderSidebar(true, { onReorderNav });
    fireEvent.keyDown(tab("Главная"), { key: "ArrowUp" });
    expect(onReorderNav).not.toHaveBeenCalled();
  });

  it("без обработчика перестановки (веб) режим ничего не меняет", () => {
    const onSelectNav = vi.fn();
    renderSidebar(true, { onSelectNav });
    fireEvent.click(tab("Поиск"));
    expect(onSelectNav).toHaveBeenCalledWith("search");
  });
});
