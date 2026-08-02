/** Э7 веб-паритета: инварианты общих экранов «Сейчас играет», полноэкранного
 *  режима и визуализатора — то, что легко сломать переносом.
 *
 *  Тестов ровно два вида:
 *  1) «Приложение не изменилось» — без необязательных пропов (крестик, ПКМ)
 *     DOM обязан остаться прежним, десктопным. Это цена переезда: экран стал
 *     общим, и любой веб-проп, протёкший в значение по умолчанию, сдвинет
 *     приложение.
 *  2) «Кадры не жгутся впустую» — жалоба владельца 02.08 (караоке роняет ФПС в
 *     играх): при закрытом оверлее ни одного requestAnimationFrame быть не
 *     должно. Проверяем на самом визуализаторе и на оверлее целиком.
 *
 *  Тесты без LanguageProvider — английский фолбэк (DEFAULT_LANG="en"), как в
 *  тестах приложения. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ListeningMode } from "./ListeningMode";
import { NowPlayingPanel } from "./NowPlayingPanel";
import { Visualizer } from "./Visualizer";

afterEach(cleanup);

// jsdom не реализует Element.scrollTo, а Lyrics ДС центрирует активную строку
// им же. Заглушка ставится один раз на файл: проверяем не прокрутку, а DOM и
// кадры, и падать из-за пробела jsdom тесты не должны.
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

const track = {
  id: "t1",
  title: "Тестовый трек",
  artist: "Автор",
  album: "",
  cover: null,
  duration: 200,
};

const lines = [
  { t: 0, text: "Первая строка" },
  { t: 5, text: "Вторая строка" },
];

const noop = () => {};

/** jsdom не умеет canvas: getContext возвращает null, и цикл рисования выходит
 *  раньше, чем успевает запросить кадр. Подменяем минимальным контекстом —
 *  дальше clearRect визуализатор без анализатора не идёт. */
function stubCanvas() {
  const ctx = { clearRect: vi.fn() } as unknown as CanvasRenderingContext2D;
  const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  return () => spy.mockRestore();
}

describe("NowPlayingPanel — общий экран не сдвигает приложение", () => {
  it("без onClose шапка остаётся голым заголовком (у приложения крестика нет)", () => {
    const { container, queryByLabelText } = render(
      <NowPlayingPanel track={track} lyrics={lines} liked={false} onLike={noop} activeLine={0} onSeekLine={noop} />,
    );
    expect(queryByLabelText("Close panel")).toBeNull();
    // первый ребёнок панели — сам заголовок, а не строка-обёртка с кнопкой
    const first = container.querySelector("aside")!.firstElementChild!;
    expect(first.tagName).toBe("SPAN");
    expect(first.textContent).toBe("Now Playing");
  });

  it("с onClose появляется крестик и работает", () => {
    const onClose = vi.fn();
    const { getByLabelText } = render(
      <NowPlayingPanel
        track={track}
        lyrics={lines}
        liked={false}
        onLike={noop}
        activeLine={0}
        onSeekLine={noop}
        onClose={onClose}
      />,
    );
    fireEvent.click(getByLabelText("Close panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("без трека панель не исчезает — показывает пустое состояние", () => {
    const { getByText, container } = render(
      <NowPlayingPanel track={null} lyrics={[]} liked={false} onLike={noop} activeLine={-1} onSeekLine={noop} />,
    );
    expect(container.querySelector("aside")).toBeTruthy();
    expect(getByText("Nothing playing")).toBeTruthy();
  });

  it("нет текста — честная плашка, а не пустое полотно", () => {
    const { getByText, rerender } = render(
      <NowPlayingPanel track={track} lyrics={[]} liked={false} onLike={noop} activeLine={-1} onSeekLine={noop} lyricsLoading />,
    );
    expect(getByText("Looking for lyrics…")).toBeTruthy();
    rerender(
      <NowPlayingPanel track={track} lyrics={[]} liked={false} onLike={noop} activeLine={-1} onSeekLine={noop} />,
    );
    expect(getByText("Lyrics not found")).toBeTruthy();
  });
});

describe("Визуализатор — кадры только когда он на сцене", () => {
  it("active=false: ни одного запрошенного кадра", () => {
    const restore = stubCanvas();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    try {
      render(<Visualizer mode="bars" active={false} getAnalyser={() => null} />);
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
      restore();
    }
  });

  it("active=true: цикл заведён, а на размонтировании погашен", () => {
    const restore = stubCanvas();
    // кадр не выполняем — иначе draw() зарядит следующий и тест зациклится
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42 as unknown as number);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      const { unmount } = render(<Visualizer mode="bars" active getAnalyser={() => null} />);
      expect(raf).toHaveBeenCalled();
      unmount();
      expect(cancel).toHaveBeenCalledWith(42);
    } finally {
      cancel.mockRestore();
      raf.mockRestore();
      restore();
    }
  });
});

describe("ListeningMode — закрытый оверлей ничего не жжёт", () => {
  it("open=false с включённым визуализатором и качанием: кадры не запрашиваются", () => {
    const restore = stubCanvas();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    try {
      render(
        <ListeningMode
          open={false}
          track={track}
          lyrics={lines}
          playing={false}
          pos={0}
          activeLine={0}
          onTogglePlay={noop}
          onPrev={noop}
          onNext={noop}
          onSeek={noop}
          onSeekLine={noop}
          onClose={noop}
          visualizer="bars"
          getAnalyser={() => null}
          bassShake
          anims
        />,
      );
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
      restore();
    }
  });

  it("без обработчика ПКМ (веб) оверлей рисуется и не падает", () => {
    const { getByTestId } = render(
      <ListeningMode
        open
        track={track}
        lyrics={lines}
        playing={false}
        pos={0}
        activeLine={0}
        onTogglePlay={noop}
        onPrev={noop}
        onNext={noop}
        onSeek={noop}
        onSeekLine={noop}
        onClose={noop}
      />,
    );
    const wrap = getByTestId("lm-lyrics");
    expect(wrap.style.opacity).toBe("1");
    // ПКМ по полотну без обработчика — просто ничего не делает
    fireEvent.contextMenu(wrap);
  });
});
