import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrackRow } from "./TrackRow.jsx";

/** ЗАЧЕМ ЭТОТ ТЕСТ. jsdom не считает :hover и :focus-within — проверить ЦВЕТ
 *  под курсором здесь нельзя в принципе (правила каскада проверяет
 *  src/interactions.test.js по тексту таблицы). Зато можно проверить ровно то,
 *  что легко сломать правкой компонента: строка подключена к каналам, состояние
 *  наведения из React ушло, а лениво монтируемые аффордансы взводятся и мышью,
 *  и клавиатурой. */

const row = (container) => container.firstElementChild;

describe("TrackRow: подсветка ушла в CSS", () => {
  it("строка подключена к каналам и не красится сама", () => {
    const { container } = render(<TrackRow index={1} title="Alpha" artist="A" duration="3:20" />);
    const el = row(container);
    expect(el.className.split(" ")).toEqual(expect.arrayContaining(["muza-press", "muza-row", "muza-row--track"]));
    expect(el.style.background).toBe("var(--row-bg)");
  });

  it("«играет сейчас» и выделение — АТРИБУТЫ, а не готовый цвет", () => {
    // Кто из них сильнее, решает порядок правил в interactions.css: компонент
    // сообщает факты, а не побеждает в споре за них.
    const { container, rerender } = render(<TrackRow index={1} title="A" active />);
    expect(row(container).getAttribute("data-active")).toBe("true");
    expect(row(container).getAttribute("data-selected")).toBeNull();
    rerender(<TrackRow index={1} title="A" active selected />);
    expect(row(container).getAttribute("data-selected")).toBe("true");
    expect(row(container).style.background).toBe("var(--row-bg)");
  });

  it("переход строки НЕ инлайновый — иначе .muza-press:active не даст несимметричности", () => {
    // Инлайн-стиль сильнее любого авторского правила: пока transition жил
    // здесь, нажатие и отпускание шли одной длительностью, хотя класс умел
    // разные. Возврат transition в style — самая незаметная из возможных
    // регрессий, поэтому она проверяется буквально.
    const { container } = render(<TrackRow index={1} title="A" onPlay={() => {}} />);
    expect(row(container).style.transition).toBe("");
  });

  it("проход курсора по прогретой строке не трогает разметку", () => {
    const { container } = render(<TrackRow index={7} title="A" onMore={() => {}} onLike={() => {}} />);
    fireEvent.pointerEnter(row(container)); // взвели: аффордансы смонтировались
    const html = container.innerHTML;
    fireEvent.pointerEnter(row(container));
    fireEvent.pointerLeave(row(container));
    fireEvent.mouseOut(row(container));
    // Ни ухода курсора, ни повторного входа React больше не видит: подсветка
    // и гашение аффордансов — целиком дело каскада.
    expect(container.innerHTML).toBe(html);
  });
});

describe("TrackRow: кружок-номер", () => {
  it("цифра и play живут ОБА, гасят друг друга каналом", () => {
    // Пока содержимое монтировалось по наведению, фейд к нему не применялся в
    // принципе: у только что вставленного узла нет предыдущего значения.
    const { container } = render(<TrackRow index={42} title="A" onPlay={() => {}} />);
    const layers = container.querySelectorAll('[aria-hidden="true"]');
    const idle = [...layers].find((l) => l.textContent === "42");
    const play = [...layers].find((l) => l.querySelector("svg"));
    expect(idle, "слой с цифрой не найден").toBeTruthy();
    expect(play, "слой с иконкой play не найден").toBeTruthy();
    expect(idle.style.opacity).toBe("calc(1 - var(--row-aff))");
    expect(play.style.opacity).toBe("var(--row-aff)");
  });

  it("играющий трек показывает эквалайзер, а под курсором — паузу", () => {
    const { container } = render(<TrackRow index={3} title="A" active playing onPlay={() => {}} pauseLabel="Пауза" />);
    // Слой покоя больше не показывает номер — он показывает «звучит».
    expect(container.textContent).not.toContain("3");
    expect(screen.getByRole("button", { name: "Пауза" })).toBeTruthy();
  });
});

describe("TrackRow: аффордансы", () => {
  it("слот аффорданса стоит на месте ДО первого касания — строка не дёргается", () => {
    // Ширина слота — единственное, что защищает правый кластер от прыжка при
    // появлении кнопок; поэтому обёртка смонтирована всегда, а кнопка нет.
    const { container } = render(<TrackRow index={1} title="A" onMore={() => {}} onLike={() => {}} />);
    expect(container.querySelectorAll("button").length).toBe(1); // только кружок-номер
    const slots = [...container.querySelectorAll("span")].filter((s) => s.style.width === "36px");
    expect(slots.length).toBe(2);
    expect(slots[0].style.opacity).toBe("var(--row-aff)");
    expect(slots[0].style.pointerEvents).toBe("var(--row-aff-pe)");
  });

  it("клавиатура взводит строку наравне с мышью", () => {
    const { container } = render(<TrackRow index={1} title="A" moreLabel="Ещё" onMore={() => {}} onLike={() => {}} />);
    expect(screen.queryByRole("button", { name: "Ещё" })).toBeNull();
    fireEvent.focus(container.querySelector("button")); // таб дошёл до кружка-номера
    expect(screen.getByRole("button", { name: "Ещё" })).toBeTruthy();
  });

  it("взведённая строка не гаснет обратно — иначе вернулась бы вторая перерисовка", () => {
    const { container } = render(<TrackRow index={1} title="A" moreLabel="Ещё" onMore={() => {}} onLike={() => {}} />);
    fireEvent.pointerEnter(row(container));
    fireEvent.pointerLeave(row(container));
    expect(screen.getByRole("button", { name: "Ещё" })).toBeTruthy();
  });

  it("лайкнутый трек виден без наведения: это факт, а не аффорданс", () => {
    const { container } = render(<TrackRow index={1} title="A" liked likeLabel="Лайк" onLike={() => {}} />);
    const btn = screen.getByRole("button", { name: "Лайк" });
    expect(btn).toBeTruthy();
    const slot = [...container.querySelectorAll("span")].find((s) => s.style.width === "36px");
    expect(slot.style.opacity).toBe("1");
  });

  it("правый кластер не запускает трек", () => {
    const onPlay = vi.fn();
    const onLike = vi.fn();
    render(<TrackRow index={1} title="A" liked likeLabel="Лайк" onPlay={onPlay} onLike={onLike} />);
    fireEvent.click(screen.getByRole("button", { name: "Лайк" }));
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });
});
