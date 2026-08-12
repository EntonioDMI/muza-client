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

/** Дороже кадров догона здесь ДЕКОДИРОВАНИЕ: <video> декодируется, пока
 *  элемент не на паузе, даже если картинку физически некому показать. В
 *  приложении «некому» наступает при свёрнутом или накрытом окне, а сам
 *  документ об этом не узнаёт (WebView2 не шлёт visibilitychange) — поэтому
 *  сигнал приходит пропом от хозяина. */
describe("NowPlayingPanel — видео замолкает, когда окна не видно", () => {
  const videoProps = {
    track,
    lyrics: lines,
    liked: false,
    onLike: noop,
    activeLine: 0,
    onSeekLine: noop,
    videoUrl: "https://example.invalid/a.mp4",
    pos: 10,
    speed: 1,
  };

  it("окна не видно: кадр снят с декодера (pause), цикл догона не заведён", () => {
    // jsdom не реализует play/pause у HTMLMediaElement — подменяем, иначе
    // элемент бросит «not implemented» ещё до проверок
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      const view = render(<NowPlayingPanel {...videoProps} playing windowVisible={false} />);
      expect(pause).toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(raf).not.toHaveBeenCalled();

      view.rerender(<NowPlayingPanel {...videoProps} playing windowVisible />);
      expect(play).toHaveBeenCalled();
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("по умолчанию (веб пропа не передаёт) видео играет как раньше", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      render(<NowPlayingPanel {...videoProps} playing />);
      expect(play).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  /** ПЕРЕХОД «ВИДЕО → ТЕКСТ» ДЕРЖИТСЯ НА ТРЁХ ЧИСЛАХ, И ОНИ ОБЯЗАНЫ СХОДИТЬСЯ.
   *
   *  Жалоба владельца 12.08: «переход между видео и текстом совсем не плавный,
   *  к тому же текст наложен прямо на пересечение». Замер живого окна (снимок
   *  1×, колонка без текста) показал обрыв яркости 40.0 → 34.7 за ОДНУ строку
   *  на нижней кромке блока при фоновом спаде 1.5 единицы на строку: у кромки
   *  ещё шло растворение кадра и работал блюр, а строкой ниже не было ни того,
   *  ни другого.
   *
   *  Лечится не «более плавной кривой», а пустым хвостом: маска кадра приходит
   *  к нулю РАНЬШЕ низа блока, туда же опускается блюр, и в этот же хвост
   *  поднимается текст. Разъедутся числа — вернётся ступенька либо текст
   *  поверх живого кадра. Тест сверяет именно СВЯЗЬ чисел, а не их значения:
   *  двигать переход можно, ломать договор — нет. */
  it("растворение кадра, низ блюра и подъём текста сведены в одну точку", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      const { getByTestId } = render(<NowPlayingPanel {...videoProps} playing />);
      const box = getByTestId("np-video");
      const video = box.querySelector("video")!;
      const blur = box.querySelector("div")!;

      // где маска кадра доходит до нуля
      const fadeEnd = /transparent (\d+)%/.exec(video.style.maskImage)?.[1];
      expect(fadeEnd).toBeTruthy();
      const конецКадра = Number(fadeEnd);

      // низ блюр-слоя стоит ровно там же
      expect(blur.style.bottom).toBe(`${100 - конецКадра}%`);

      // ...и его собственная маска гаснет на ОБОИХ концах: незатухший нижний
      // конец и рисовал измеренную ступеньку
      // (jsdom выбрасывает `to bottom` как значение по умолчанию — не ищем его)
      expect(blur.style.maskImage).toMatch(/^linear-gradient\((to bottom, )?transparent 0%/);
      expect(blur.style.maskImage).toMatch(/transparent 100%\)$/);

      // текст поднят В хвост, но не глубже него (проценты вертикальных полей
      // CSS считает от ШИРИНЫ, а кадр шире панели на два --pad-zone — значит
      // строгого неравенства процентов достаточно, см. комментарий в панели)
      const подъём = Number(/-(\d+)%/.exec(box.style.marginBottom)?.[1]);
      expect(подъём).toBeGreaterThan(0);
      expect(подъём).toBeLessThan(100 - конецКадра);
    } finally {
      vi.restoreAllMocks();
    }
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

  it("звук стоит: досчитав тишину, цикл гаснет САМ, без размонтирования", () => {
    const restore = stubCanvas();
    let frame: FrameRequestCallback | null = null;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
      frame = fn;
      return 7 as unknown as number;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    try {
      // playing=false + анализатора нет = картинке неоткуда меняться
      render(<Visualizer mode="bars" active playing={false} getAnalyser={() => null} />);
      expect(raf).toHaveBeenCalledTimes(1); // первый кадр — засечь тишину

      now.mockReturnValue(1_500); // полсекунды тишины — рано, хвост ещё мог идти
      frame!(0);
      expect(cancel).not.toHaveBeenCalled();

      now.mockReturnValue(3_000); // две секунды: держать цикл больше не за что
      frame!(0);
      expect(cancel).toHaveBeenCalledWith(7);
    } finally {
      now.mockRestore();
      cancel.mockRestore();
      raf.mockRestore();
      restore();
    }
  });

  it("play после тишины будит цикл обратно (конверты гейна при этом целы)", () => {
    const restore = stubCanvas();
    let frame: FrameRequestCallback | null = null;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
      frame = fn;
      return 7 as unknown as number;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    try {
      const view = render(<Visualizer mode="bars" active playing={false} getAnalyser={() => null} />);
      now.mockReturnValue(3_000);
      frame!(0);
      expect(cancel).toHaveBeenCalledWith(7);
      raf.mockClear();

      view.rerender(<Visualizer mode="bars" active playing getAnalyser={() => null} />);
      expect(raf).toHaveBeenCalled(); // разбудили, не пересоздав эффект
    } finally {
      now.mockRestore();
      cancel.mockRestore();
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

  /** Дыра, которую закрыли 02.08: прежний тест выше проверял закрытый оверлей
   *  на ПАУЗЕ, а музыка при закрытом караоке как раз играет. Прогресс-бар
   *  оверлея (Slider с rate>0) знал только про playing и крутил собственный
   *  цикл кадров, переписывая transform'ы узлов под visibility:hidden. */
  it("open=false, но МУЗЫКА ИДЁТ: кадры всё равно не запрашиваются", () => {
    const restore = stubCanvas();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    try {
      render(
        <ListeningMode
          open={false}
          track={track}
          lyrics={lines}
          playing
          pos={12}
          speed={1}
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

  it("open=true при играющей музыке — кадры, наоборот, идут (гейт не залип)", () => {
    const restore = stubCanvas();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      render(
        <ListeningMode
          open
          track={track}
          lyrics={lines}
          playing
          pos={12}
          speed={1}
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
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      restore();
    }
  });

  /** Размывать подложке нечего: ниже по стопке только задник, уже размытый на
   *  --blur-scenery, и непрозрачный корень. Полноэкранный backdrop-filter при
   *  этом пересчитывался каждый кадр, потому что предок каждый кадр меняет
   *  transform (качание при басах) — снят 02.08. */
  it("подложка оверлея не несёт backdrop-filter", () => {
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
    const root = getByTestId("listening-mode");
    // именно затемняющая плёнка сцены, а не стеклянные плашки контролов —
    // у тех размывать есть что, и они не полноэкранные
    const scrim = [...root.querySelectorAll<HTMLElement>("div")].find(
      (d) => d.style.background === "var(--glass-deep)",
    );
    expect(scrim).toBeTruthy();
    // через getPropertyValue, а не через камель-свойства: webkitBackdropFilter
    // в типе CSSStyleDeclaration не объявлено, а вендорный префикс на плёнке
    // стоял вторым — проверять надо оба написания
    expect(scrim!.style.getPropertyValue("backdrop-filter")).toBe("");
    expect(scrim!.style.getPropertyValue("-webkit-backdrop-filter")).toBe("");
  });

  /** Второй гейт тех же трёх циклов — «окна не видно» (03.08). Окно бывает
   *  свёрнуто или накрыто чужим окном целиком, и тогда рисовать вообще некому.
   *  Проверять это через document.hidden в приложении БЕСПОЛЕЗНО: WebView2 не
   *  сообщает странице о свёрнутом окне (замер 03.08 — 171 кадр/с у свёрнутого
   *  окна при visibilityState="visible"), поэтому сигнал приходит нативным
   *  событием и заводится сюда пропом. Каждый цикл проверяем ПООТДЕЛЬНОСТИ:
   *  один общий тест не отличил бы «погасли все три» от «погас один». */
  const openProps = {
    open: true,
    track,
    lyrics: lines,
    pos: 12,
    speed: 1,
    activeLine: 0,
    onTogglePlay: noop,
    onPrev: noop,
    onNext: noop,
    onSeek: noop,
    onSeekLine: noop,
    onClose: noop,
  };

  it("визуализатор: окна не видно — ни одного кадра, вернулось — кадры снова идут", () => {
    const restore = stubCanvas();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      // качание выключено, музыка на паузе (rate у Slider = 0) — кадры может
      // просить только визуализатор
      const view = render(
        <ListeningMode {...openProps} playing={false} visualizer="bars" getAnalyser={() => null} windowVisible={false} />,
      );
      expect(raf).not.toHaveBeenCalled();

      view.rerender(
        <ListeningMode {...openProps} playing={false} visualizer="bars" getAnalyser={() => null} windowVisible />,
      );
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      restore();
    }
  });

  it("качание при басах: окна не видно — кадров нет, вернулось — есть", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      // визуализатора нет, музыка на паузе — кадры может просить только качание
      const view = render(
        <ListeningMode {...openProps} playing={false} bassShake anims getAnalyser={() => null} windowVisible={false} />,
      );
      expect(raf).not.toHaveBeenCalled();

      view.rerender(
        <ListeningMode {...openProps} playing={false} bassShake anims getAnalyser={() => null} windowVisible />,
      );
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("прогресс-бар оверлея: окна не видно — кадров нет даже при играющей музыке", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      // ни визуализатора, ни качания — кадры может просить только Slider
      const view = render(<ListeningMode {...openProps} playing windowVisible={false} />);
      expect(raf).not.toHaveBeenCalled();

      view.rerender(<ListeningMode {...openProps} playing windowVisible />);
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("окно ВИДНО, но не в фокусе — гейта нет: владелец запретил гасить видимое", () => {
    // Страховка от «оптимизации», которую легко дописать следующим шагом:
    // окно на втором мониторе человек ВИДИТ, замершая там анимация заметна.
    // Единственный вход выключателя — windowVisible, и по умолчанию он true.
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      render(<ListeningMode {...openProps} playing />);
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
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
