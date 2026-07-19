import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PlayerTrack } from "../player/types";
import { QueuePanel } from "./QueuePanel";

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
    />,
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
