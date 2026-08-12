import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tile } from "./Tile.jsx";

/** jsdom не считает :hover — цвета под курсором проверяет разбор каскада в
 *  src/interactions.test.js. Здесь проверяется другая половина договора: плитка
 *  подключена к каналам, ничего не красит сама и не держит состояния наведения. */

const tile = (container) => container.firstElementChild;
/** Обёртка play-пилюли — единственный узел с правым нижним якорем (левый
 *  верхний занят галочкой выделения). */
const pill = (container) =>
  [...container.querySelectorAll("div")].find((d) => d.style.right === "8px" && d.style.bottom === "8px");

describe("Tile: подсветка ушла в CSS", () => {
  it("подключена к каналу и не красится сама", () => {
    const { container } = render(<Tile title="A" onClick={() => {}} />);
    expect(tile(container).className.split(" ")).toEqual(expect.arrayContaining(["muza-press", "muza-tile"]));
    expect(tile(container).style.background).toBe("var(--tile-bg)");
  });

  it("декоративная плитка не жмётся, но канал у неё есть", () => {
    // Жать нечего — .muza-press не нужен; подсветку фона плитка держит всегда.
    const { container } = render(<Tile title="A" />);
    expect(tile(container).className).toBe("muza-tile");
  });

  it("выделение сильнее наведения — его плитка решает сама", () => {
    const { container } = render(<Tile title="A" selected onClick={() => {}} />);
    expect(tile(container).style.background).toBe("var(--surface-4)");
  });

  it("переход НЕ инлайновый — иначе .muza-press:active не даст несимметричности", () => {
    const { container } = render(<Tile title="A" onClick={() => {}} />);
    expect(tile(container).style.transition).toBe("");
  });

  it("play-пилюля проявляется каналом, а у играющей плитки стоит показанной", () => {
    const { container, rerender } = render(<Tile title="A" onClick={() => {}} />);
    expect(pill(container).style.opacity).toBe("var(--tile-pill)");
    expect(pill(container).style.transform).toBe("var(--tile-pill-y)");
    rerender(<Tile title="A" playing onClick={() => {}} />);
    // «Что сейчас звучит» — ответ, а не аффорданс: он не гаснет без курсора.
    expect(pill(container).style.opacity).toBe("1");
    expect(pill(container).style.transform).toBe("translateY(0)");
  });

  it("проход курсора и уход фокуса не трогают разметку", () => {
    const { container } = render(<Tile title="A" onClick={() => {}} />);
    const html = container.innerHTML;
    fireEvent.mouseEnter(tile(container));
    fireEvent.focus(tile(container));
    fireEvent.blur(tile(container));
    fireEvent.mouseLeave(tile(container));
    expect(container.innerHTML).toBe(html);
  });
});

/** ЖИРНОГО В НАЗВАНИИ ПЛИТКИ НЕТ — и это не вкусовщина, а замер.
 *
 *  Жалоба владельца 12.08: «на карточках текст всё ещё немножко размывается».
 *  Снимок живого окна 1× с увеличением без сглаживания: одна и та же строка на
 *  15px весами 400 и 600 — у 600 просветы в «a», «s», «в» затекают, строка
 *  читается мыльной; дробная координата плитки в сетке при этом не значит
 *  ничего (проверено отдельно теми же снимками). Название и без веса выделено
 *  цветом --text-1 на фоне серых подписей.
 *
 *  ⚠️ Первый заход правки 12.08 попал только в «Любимое» — свою плитку
 *  LibraryView, — и два соседних кафеля стояли разными весами. Сторож держит
 *  именно этот случай: название плитки ДС набрано ТЕКСТОВЫМ весом. */
describe("Tile: название набрано текстовым весом, а не заголовочным", () => {
  it("вес названия — --fw-text", () => {
    const { container } = render(<Tile title="Название" subtitle="подпись" />);
    const title = [...container.querySelectorAll("div")].find((d) => d.textContent === "Название");
    expect(title.style.fontWeight).toBe("var(--fw-text)");
  });
});
