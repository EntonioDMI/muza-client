import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PlayerTrack } from "../player/types";
import { QueuePanel } from "./QueuePanel";
import { TestMenuProvider } from "./menuTestUtils";

// Регресс 2026-07-19 (жалоба владельца: «при открытии очереди с большим списком
// весь интерфейс съезжает вверх»). Причина — scrollIntoView и focus() без
// preventScroll прокручивают ВСЕХ скроллируемых предков, а не только свой
// список. Корень приложения — overflow:hidden: программно он скроллится, но
// вернуть его нечем (полосы нет), поэтому сдвиг залипал. Панель обязана
// скроллить строго свой контейнер. Без LanguageProvider → DEFAULT_LANG="en".

afterEach(() => cleanup());

const track = (id: string): PlayerTrack => ({
  id,
  kind: "catalog",
  title: `Track ${id}`,
  artist: "Artist",
  album: "",
  duration: 180,
  cover: null,
  explicit: false,
  loudness: null,
});

const noop = () => undefined;

function renderQueue(currentIndex: number) {
  const tracks = Array.from({ length: 30 }, (_, i) => track(`t${i}`));
  return render(
    <TestMenuProvider>
      <QueuePanel
        open
        tracks={tracks}
        currentIndex={currentIndex}
        playing={false}
        canSave={false}
        onPlayTrack={noop}
        onClose={noop}
        onRemove={noop}
        onMove={noop}
        onClearUpNext={noop}
        onSaveAsPlaylist={noop}
      />
    </TestMenuProvider>,
  );
}

describe("QueuePanel — скроллы панели не ломают интерфейс", () => {
  it("не зовёт scrollIntoView: он прокручивает предков, включая корень приложения", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderQueue(20);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("фокус в панель — с preventScroll, иначе браузер подкручивает предков", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    renderQueue(20);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  // overflow-y:auto переводит overflow-x из visible в auto — без явного hidden
  // снизу списка вылезала лишняя горизонтальная полоса.
  it("список не скроллится по горизонтали", () => {
    Element.prototype.scrollIntoView = vi.fn();

    renderQueue(20);

    const current = document.querySelector("[data-queue-current]") as HTMLElement;
    const list = current.parentElement as HTMLElement;
    expect(list.style.overflowY).toBe("auto"); // якорь: взят именно скролл-контейнер
    expect(list.style.overflowX).toBe("hidden");
  });
});

// Закрытие по клику на пустое место (2026-07-20): точечный pointerdown-слушатель
// вместо backdrop'а — плеер-бар на zIndex 40 НИЖЕ панели, слой съел бы его клики.
describe("QueuePanel — закрытие по клику вне", () => {
  function renderWithOutside(onClose: () => void) {
    const tracks = Array.from({ length: 5 }, (_, i) => track(`t${i}`));
    return render(
      <TestMenuProvider>
        <div>
          <button type="button" data-testid="outside">
            мимо
          </button>
          <span data-queue-toggle>
            <button type="button" data-testid="toggle">
              очередь
            </button>
          </span>
          <QueuePanel
            open
            tracks={tracks}
            currentIndex={0}
            playing={false}
            canSave={false}
            onPlayTrack={noop}
            onClose={onClose}
            onRemove={noop}
            onMove={noop}
            onClearUpNext={noop}
            onSaveAsPlaylist={noop}
          />
        </div>
      </TestMenuProvider>,
    );
  }

  const down = (el: Element) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

  it("pointerdown вне панели закрывает", () => {
    const onClose = vi.fn();
    const { getByTestId } = renderWithOutside(onClose);
    down(getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("по кнопке-переключателю НЕ закрывает — иначе toggle схлопнулся бы в мигание", () => {
    const onClose = vi.fn();
    const { getByTestId } = renderWithOutside(onClose);
    down(getByTestId("toggle"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("внутри панели не закрывает", () => {
    const onClose = vi.fn();
    const { getByText } = renderWithOutside(onClose);
    down(getByText("Track t2"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
