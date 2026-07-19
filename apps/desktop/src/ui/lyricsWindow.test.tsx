import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Lyrics } from "@muza/ui";

/** Окно вокруг активной строки (@muza/ui → media/Lyrics.jsx). Своего раннера у
 *  ДС нет — тест живёт у потребителя, как slidingIndicator.test.tsx рядом.
 *
 *  Жалоба владельца (15.07): «в панели показывает максимум три строчки за раз,
 *  очень много пустого пространства». Пустота была НЕ концом текста: строки за
 *  окном получали opacity:0, но оставались в потоке и держали своё место.
 *
 *  jsdom не считает layout, поэтому саму пустоту здесь замерить нельзя (это
 *  только живым окном — см. docs/notes/2026-07-15-текст-в-панели-без-окна.md).
 *  Проверяем причину пустоты: инлайновые стили, которыми строка прячется, и
 *  границу — что караоке (полный экран, разрежённость = замысел) не тронуто. */

afterEach(cleanup);

// Автоследование зовёт wrap.scrollTo — в jsdom его нет вовсе. Соседний
// LyricsMeaning.test.tsx на это не натыкался: у него activeIndex=-1, а на
// несинхронном тексте центрирование не запускается.
const realScrollTo = Element.prototype.scrollTo;
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});
afterAll(() => {
  Element.prototype.scrollTo = realScrollTo;
});

const LINES = Array.from({ length: 9 }, (_, i) => ({ t: i, text: `строка ${i}` }));
const line = (i: number) => screen.getByText(`строка ${i}`);
const opacities = () => LINES.map((l) => screen.getByText(l.text).style.opacity);

describe("Lyrics, режим panel: виден весь текст", () => {
  it("показывает ВСЕ строки, а не окно из трёх вокруг активной", () => {
    render(<Lyrics lines={LINES} activeIndex={4} />);

    expect(opacities()).not.toContain("0");
  });

  it("дальняя строка остаётся кликабельной и сикает по клику", () => {
    const onSeek = vi.fn();
    render(<Lyrics lines={LINES} activeIndex={4} onSeek={onSeek} />);

    expect(line(8).style.pointerEvents).toBe("auto");
    fireEvent.click(line(8));

    expect(onSeek).toHaveBeenCalledWith(8);
  });

  it("не затемняет дальние строки дважды: --text-3 уже 0.38α, множителя нет", () => {
    render(<Lyrics lines={LINES} activeIndex={4} />);

    // opacity 0.5 поверх --text-3 дало бы 0.19α — 1.8:1 к фону панели, призрак.
    expect(line(8).style.color).toBe("var(--text-3)");
    expect(line(8).style.opacity).toBe("1");
  });

  it("активная строка ведёт: акцент, непрозрачность 1 и единственный scale(1)", () => {
    render(<Lyrics lines={LINES} activeIndex={4} />);

    expect(line(4).style.color).toBe("var(--accent-text)");
    expect(line(4).style.opacity).toBe("1");
    expect(line(4).style.transform).toBe("scale(1)");
    // лесенка по d выродилась бы (одна строка 0.9, все прочие 0.8) — один шаг
    const rest = LINES.filter((_, i) => i !== 4).map((l) => screen.getByText(l.text).style.transform);
    expect(new Set(rest)).toEqual(new Set(["scale(0.9)"]));
  });

  it("ручной скролл меняет только следование за активной, но не видимость", () => {
    const { rerender } = render(<Lyrics lines={LINES} activeIndex={4} autoScroll />);
    const following = opacities();

    rerender(<Lyrics lines={LINES} activeIndex={4} autoScroll={false} />);

    expect(opacities()).toEqual(following);
  });

  it("без activeIndex (веб на plain-тексте) не схлопывается в две строки", () => {
    // activeIndex по умолчанию 0 → synced → раньше всё с d>1 пряталось
    render(<Lyrics lines={LINES.map(({ text }) => ({ text }))} />);

    expect(opacities()).not.toContain("0");
  });
});

describe("Lyrics: краевая отбивка synced-текста — не стена пустоты (жалоба 19.07)", () => {
  // jsdom не считает layout, но инлайновую height спейсера читает: 50% высоты
  // сверху и снизу давали полэкрана пустоты над первой строкой и под последней.
  it("panel synced: две отбивки, и они больше НЕ 50% высоты", () => {
    render(<Lyrics lines={LINES} activeIndex={4} />);

    const pads = screen.getAllByTestId("lyrics-edge-pad");
    expect(pads).toHaveLength(2); // сверху и снизу
    for (const p of pads) expect(p.style.height).not.toBe("50%");
  });

  it("karaoke synced: отбивка 22% (верхняя треть), а не центр", () => {
    render(<Lyrics lines={LINES} activeIndex={4} mode="karaoke" />);

    const pads = screen.getAllByTestId("lyrics-edge-pad");
    expect(pads.length).toBeGreaterThan(0);
    for (const p of pads) expect(p.style.height).toBe("22%");
  });

  it("plain-текст (activeIndex -1): краевых отбивок нет вовсе", () => {
    render(<Lyrics lines={LINES} activeIndex={-1} />);

    expect(screen.queryAllByTestId("lyrics-edge-pad")).toHaveLength(0);
  });
});

describe("Lyrics, режим karaoke: окно на месте (границу не трогали)", () => {
  it("прячет строки за окном radius 2 и держит лесенку прозрачности", () => {
    render(<Lyrics lines={LINES} activeIndex={4} mode="karaoke" />);

    expect(opacities()).toEqual(["0", "0", "0.5", "0.7", "1", "0.7", "0.5", "0", "0"]);
    expect(line(0).style.pointerEvents).toBe("none");
  });

  it("держит масштабную линзу 100/90/80", () => {
    render(<Lyrics lines={LINES} activeIndex={4} mode="karaoke" />);

    expect(line(4).style.transform).toBe("scale(1)");
    expect(line(3).style.transform).toBe("scale(0.9)");
    expect(line(2).style.transform).toBe("scale(0.8)");
  });

  it("ручной скролл по-прежнему раскрывает весь текст на 0.6", () => {
    render(<Lyrics lines={LINES} activeIndex={4} mode="karaoke" autoScroll={false} />);

    expect(line(0).style.opacity).toBe("0.6");
    expect(line(0).style.pointerEvents).toBe("auto");
  });
});
