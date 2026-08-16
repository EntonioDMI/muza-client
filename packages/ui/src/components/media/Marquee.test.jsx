import { describe, expect, it, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Marquee } from "./Marquee.jsx";

/** Переполнение в jsdom не считается само: scrollWidth/clientWidth там всегда
 *  нули. Подменяем их так же, как это делает браузер, — иначе проверять
 *  «едет только переполненное» было бы не на чем. */
function mockWidths({ content, box }) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return this.dataset.role === "box" ? box : content;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return box;
    },
  });
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  };
});

describe("бегущая строка", () => {
  it("текст помещается — не едет даже под курсором", () => {
    mockWidths({ content: 100, box: 200 });
    render(<Marquee text="Короткое название" />);

    const text = screen.getByText("Короткое название");
    fireEvent.pointerEnter(text.parentElement);

    expect(text.className).not.toContain("muza-marquee-run");
  });

  it("не поместился и под курсором — едет", () => {
    mockWidths({ content: 400, box: 200 });
    render(<Marquee text="Очень длинное название трека, которое не влезает" />);

    const text = screen.getByText(/Очень длинное/);
    fireEvent.pointerEnter(text.parentElement);

    expect(text.className).toContain("muza-marquee-run");
  });

  // Главное правило: в списке на сотню строк постоянное движение превратило бы
  // экран в табло аэропорта.
  it("не поместился, но курсора нет — стоит и обрезан многоточием", () => {
    mockWidths({ content: 400, box: 200 });
    render(<Marquee text="Очень длинное название трека, которое не влезает" />);

    const text = screen.getByText(/Очень длинное/);

    expect(text.className ?? "").not.toContain("muza-marquee-run");
    expect(text.style.textOverflow).toBe("ellipsis");
  });

  it("курсор ушёл — останавливается и многоточие возвращается", () => {
    mockWidths({ content: 400, box: 200 });
    render(<Marquee text="Очень длинное название трека, которое не влезает" />);

    const text = screen.getByText(/Очень длинное/);
    fireEvent.pointerEnter(text.parentElement);
    fireEvent.pointerLeave(text.parentElement);

    expect(text.className ?? "").not.toContain("muza-marquee-run");
    expect(text.style.textOverflow).toBe("ellipsis");
  });

  // Скорость постоянна, а не длительность: иначе длинное название едет
  // торопливо, короткое — ползёт, и одинаковыми они не выглядят никогда.
  it("чем длиннее хвост, тем дольше цикл", () => {
    mockWidths({ content: 400, box: 200 });
    const short = render(<Marquee text="хвост 200" />);
    fireEvent.pointerEnter(screen.getByText("хвост 200").parentElement);
    const shortDur = screen.getByText("хвост 200").style.getPropertyValue("--muza-marquee-dur");
    short.unmount();

    mockWidths({ content: 600, box: 200 });
    render(<Marquee text="хвост 400" />);
    fireEvent.pointerEnter(screen.getByText("хвост 400").parentElement);
    const longDur = screen.getByText("хвост 400").style.getPropertyValue("--muza-marquee-dur");

    expect(parseInt(longDur, 10)).toBeGreaterThan(parseInt(shortDur, 10));
  });
});
