/** ЖИВОЙ ПОРЯДОК И ПРОКРУТКА ПОД ЖЕСТОМ (переписка движка 2026-08-04).
 *
 *  Оба теста ниже — прямые регрессии на жалобы владельца:
 *
 *   1. «Соседи подстраиваются только через секунду» — порядок менялся ТОЛЬКО
 *      после отпускания, а до него соседи изображали будущую раскладку
 *      трансформами по снимку. Теперь порядок настоящий и виден сразу.
 *   2. «Когда я листаю вверх, позиция мышки не учитывается должным образом» —
 *      прямоугольники снимались один раз на подъёме, и прокрутка делала их
 *      ложью: содержимое уехало, снимок остался. Теперь геометрия
 *      перемеряется на каждое событие прокрутки, даже если курсор стоит.
 *
 *  Раскладку подделываем через getBoundingClientRect, считая её ОТ МЕСТА УЗЛА
 *  СРЕДИ БРАТЬЕВ: в jsdom своей раскладки нет, а зафиксированные за элементом
 *  координаты не заметили бы как раз того, что мы проверяем, — что после
 *  перестановки геометрия читается заново. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { HOLD_MS, insertionIndex } from "./dragEngine";
import { useLocalReorder } from "./useLocalReorder";

const H = 40;
/** На сколько «прокручен» экран: вычитается из координат, как в браузере. */
let scrolled = 0;
const realRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  scrolled = 0;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const parent = this.parentElement;
    const i = parent ? Array.prototype.indexOf.call(parent.children, this) : 0;
    const top = i * H - scrolled;
    return { top, bottom: top + H, left: 0, right: 200, width: 200, height: H, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
  cleanup();
  vi.useRealTimers();
});

const IDS = ["a", "b", "c"];

function List({ onOrder }: { onOrder?: (o: readonly string[]) => void }) {
  const r = useLocalReorder({
    ids: IDS,
    resolveTo: (rects, from, _x, y) => insertionIndex(rects, from, y),
    onCommit: () => undefined,
  });
  onOrder?.(r.order);
  return (
    <div data-testid="list">
      {r.order.map((id) => (
        <div key={id} data-testid={id} ref={r.itemRef(id)} {...r.grip(id)} />
      ))}
    </div>
  );
}

/** Порядок узлов В DOM — то, что человек реально видит. */
const shown = (view: ReturnType<typeof render>): string[] =>
  Array.from(view.getByTestId("list").children).map((el) => el.getAttribute("data-testid") ?? "");

describe("useLocalReorder — предпросмотр порядка", () => {
  it("порядок меняется ПОД ПАЛЬЦЕМ, а не после отпускания", () => {
    vi.useFakeTimers();
    const view = render(<List />);
    expect(shown(view)).toEqual(["a", "b", "c"]);

    // взяли «a» (0..40) и повели ниже середины «c» (100)
    fireEvent.pointerDown(view.getByTestId("a"), { button: 0, clientX: 0, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 0, clientY: 110 });
    });

    // кнопку ещё держат — а порядок уже настоящий
    expect(shown(view)).toEqual(["b", "c", "a"]);
  });

  it("прокрутка под неподвижным курсором сдвигает элемент — снимка больше нет", () => {
    vi.useFakeTimers();
    const view = render(<List />);

    // взяли «a» и НЕ ведём: курсор стоит на y=10
    fireEvent.pointerDown(view.getByTestId("a"), { button: 0, clientX: 0, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS); // подъём по удержанию
    });
    expect(shown(view)).toEqual(["a", "b", "c"]);

    // Экран пролистали на две строки вниз: содержимое уехало вверх, курсор —
    // нет. Слоты при прокрутке сдвигаются ЖЁСТКО по дельте window.scrollY
    // (замер DOM убивал бы летящие анимации — см. scrolled в движке), поэтому
    // тест двигает и настоящий scrollY, и мок раскладки.
    act(() => {
      scrolled = 80;
      Object.defineProperty(window, "scrollY", { value: 80, configurable: true, writable: true });
      window.dispatchEvent(new Event("scroll"));
    });

    // Точка захвата (курсор y=10) после прокрутки оказалась ниже середины «b»
    // (−20+8=−12), но выше середины «c» (20+8=28) — плашка встала между ними.
    expect(shown(view)).toEqual(["b", "a", "c"]);
  });

  it("СТОРОЖ ПАРЫ: тот же сосед не пилит обмен туда-сюда под микродвижениями", () => {
    // Сценарий владельца (третья приёмка): «Лайки» на широкий «Топ треков» в
    // ленте с переносом строк — после обмена широкий блок снова накрывает
    // точку захвата, и «вошёл в чужую ячейку» срабатывает в обе стороны.
    // Геометрию ленты в jsdom не собрать — эмулируем её resolveTo, который
    // ВСЕГДА зовёт обмен с соседом (как накрывающий широкий блок).
    vi.useFakeTimers();
    const orders: string[][] = [];
    const PingPong = () => {
      const r = useLocalReorder({
        ids: IDS,
        resolveTo: (_rects, from) => (from === 0 ? 1 : 0),
        onCommit: () => undefined,
      });
      orders.push([...r.order]);
      return (
        <div data-testid="list">
          {r.order.map((id) => (
            <div key={id} data-testid={`pp-${id}`} ref={r.itemRef(id)} {...r.grip(id)} />
          ))}
        </div>
      );
    };
    const view = render(<PingPong />);
    fireEvent.pointerDown(view.getByTestId("pp-a"), { button: 0, clientX: 0, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 0, clientY: 14 }); // первый обмен — честный
    });
    const after = orders[orders.length - 1];
    expect(after).toEqual(["b", "a", "c"]);

    // микродвижения на месте: такты идут, resolveTo требует обмен назад —
    // сторож пары молчит, порядок стоит
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(200);
      });
      act(() => {
        fireEvent.pointerMove(window, { clientX: i % 2 === 0 ? 2 : -2, clientY: 14 + (i % 2) });
      });
    }
    expect(orders[orders.length - 1]).toEqual(["b", "a", "c"]);

    // осознанный увод руки (≥ 24px) — обмен назад разрешён
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 0, clientY: 44 });
    });
    expect(orders[orders.length - 1]).toEqual(["a", "b", "c"]);
  });

  it("ПАУЗА: перестановки не чаще одной за такт — микродвижения не дают каскада", () => {
    // Жалоба владельца 04.08: «алгоритм делает расчёты, а микродвижения
    // курсора дополняют эффект — всё начинает очень быстро перемещаться».
    // Пока прошлая перестановка доигрывается, новая не решается; замысел
    // добирается отложенным пересчётом, когда такт истёк.
    vi.useFakeTimers();
    const view = render(<List />);

    fireEvent.pointerDown(view.getByTestId("a"), { button: 0, clientX: 0, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 0, clientY: 110 }); // первый ход — сразу
    });
    expect(shown(view)).toEqual(["b", "c", "a"]);

    // тут же дёрнули обратно вверх — внутри такта порядок НЕ меняется
    act(() => {
      fireEvent.pointerMove(window, { clientX: 0, clientY: 30 });
    });
    expect(shown(view)).toEqual(["b", "c", "a"]);

    // такт истёк — отложенный пересчёт добирает последний замысел сам,
    // без нового движения мыши
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(shown(view)).toEqual(["b", "a", "c"]);
  });
});
