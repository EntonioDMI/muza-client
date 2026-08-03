import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Menu } from "../components/feedback/Menu.jsx";
import { Dialog } from "../components/feedback/Dialog.jsx";
import { Select } from "../components/core/Select.jsx";

/** ══ СТОРОЖ: ПЛАВАЮЩИЙ СЛОЙ НЕ ЖИВЁТ ВНУТРИ СТЕКЛЯННОГО ПРЕДКА ═══════════
 *
 *  ЧТО ЛОВИМ. Меню, диалоги и выпадашки — position: fixed. По спецификации
 *  предок с backdrop-filter (а стекло — это он и есть), filter, transform,
 *  perspective, will-change или contain: paint становится для fixed-потомка
 *  СОДЕРЖАЩИМ БЛОКОМ: слой отсчитывается от предка, а не от окна.
 *
 *  ЖИВОЙ СЛУЧАЙ (владелец, 03.08). Меню «Устройство вывода» рисуется прямо
 *  внутри полосы плеера, у которой backdrop-filter стоял всегда. CSS говорил
 *  top: 633px, на экране меню было на 1429 — ровно на высоту отступа полосы
 *  ниже, целиком за краем окна. Со стороны это «кнопка не открывает ничего».
 *  Волна «больше стекла» расширила беду на сайдбар, «Сейчас играет» и рельс
 *  настроек — то есть на выпадашки настроек, меню плейлиста и палитру.
 *
 *  ПОЧЕМУ ПРОВЕРКА СТРУКТУРНАЯ. jsdom не считает раскладку и не знает про
 *  содержащие блоки — сравнивать координаты бессмысленно, тест был бы зелёным
 *  на сломанном коде. Поэтому проверяем ПРИЧИНУ, а не следствие: узел слоя
 *  обязан лежать вне поддерева вызывателя. На коде до правки каждый из этих
 *  тестов падал. */

/** Стеклянная зона-вызыватель: ровно то, чем являются сайдбар, полоса плеера и
 *  рельс настроек. Внутри — плавающий слой. */
function Glass({ children }) {
  return (
    <div data-testid="стекло" style={{ backdropFilter: "blur(28px)" }}>
      {children}
    </div>
  );
}

/** Корень темы приложения: цель портала. */
function Root({ children }) {
  return (
    <div data-muza-layer-root="" data-testid="корень">
      {children}
    </div>
  );
}

const inGlass = (node) => screen.getByTestId("стекло").contains(node);

describe("плавающие слои порталятся из-под стекла", () => {
  it("меню уходит из стеклянного предка в корень темы", () => {
    const Harness = ({ open }) => (
      <Root>
        <Glass>
          <Menu open={open} x={10} y={10} items={[{ label: "Играть", onClick: () => {} }]} onClose={() => {}} />
        </Glass>
      </Root>
    );
    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);

    const item = screen.getByRole("menuitem", { name: "Играть" });
    expect(inGlass(item), "меню осталось внутри стеклянной зоны").toBe(false);
    expect(screen.getByTestId("корень").contains(item)).toBe(true);
  });

  it("диалог уходит из стеклянного предка в корень темы", () => {
    const Harness = ({ open }) => (
      <Root>
        <Glass>
          <Dialog open={open} title="Проверка" onClose={() => {}}>
            <p>тело</p>
          </Dialog>
        </Glass>
      </Root>
    );
    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);

    const dialog = screen.getByRole("dialog", { name: "Проверка" });
    expect(inGlass(dialog), "диалог остался внутри стеклянной зоны").toBe(false);
  });

  it("выпадашка уходит из стеклянного предка, а её поле остаётся на месте", () => {
    render(
      <Root>
        <Glass>
          <Select items={[{ key: "a", label: "Первый" }]} value="a" ariaLabel="Выбор" onChange={() => {}} />
        </Glass>
      </Root>,
    );
    const trigger = screen.getByRole("button", { name: "Выбор" });
    // Поле — часть разметки вызывателя и обязано остаться внутри зоны:
    // портал уносит ТОЛЬКО плавающий слой, иначе поле уехало бы из раскладки.
    expect(inGlass(trigger)).toBe(true);

    fireEvent.click(trigger);
    const list = screen.getByRole("listbox", { name: "Выбор" });
    expect(inGlass(list), "выпадашка осталась внутри стеклянной зоны").toBe(false);
  });

  it("без корня темы слой всё равно рендерится (тесты, чужой потребитель @muza/ui)", () => {
    // Фолбэк на document.body: токены будут дефолтные, но слой не пропадёт и не
    // уедет — «нет разметки приложения» не должно ронять компонент.
    const Harness = ({ open }) => (
      <Menu open={open} x={0} y={0} items={[{ label: "Одинокое", onClick: () => {} }]} onClose={() => {}} />
    );
    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);
    expect(screen.getByRole("menuitem", { name: "Одинокое" })).toBeTruthy();
  });
});

describe("портал не ломает клавиатуру", () => {
  it("фокус входит в меню и возвращается на открывший элемент", () => {
    // Портал меняет место узла в DOM, но НЕ в React-дереве, поэтому возврат
    // фокуса и всплытие событий обязаны работать как раньше.
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const Harness = ({ open }) => (
      <Root>
        <Glass>
          <Menu open={open} x={10} y={10} items={[{ label: "Играть", onClick: () => {} }]} onClose={() => {}} />
        </Glass>
      </Root>
    );
    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Играть" }));

    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
