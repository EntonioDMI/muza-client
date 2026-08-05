/** РАЗНОРАЗМЕРНАЯ ЛЕНТА: БЛОК НЕ ПРЫГАЕТ ПОД МИКРОДВИЖЕНИЯМИ.
 *
 *  Прямая регрессия на жалобу владельца (2026-08-05), дословно: «беру „Сводку“
 *  или „Лайки“, которые под или над „Топ треков“, и при микродвижении мыши блок
 *  „Топ треков“ буквально прыгает. Если мышка останавливается на нём — перестаёт.
 *  Двигается — прыгает снова и снова».
 *
 *  ПОЧЕМУ ПРЫГАЛО. Решатель отвечал на вопрос «точка захвата НАХОДИТСЯ в чужой
 *  ячейке», хотя дока обещала «ВОШЛА». Разница видна только на разных размерах:
 *  после обмена вытесненный высокий блок снова накрывает курсор, условие
 *  срабатывает опять — и так по кругу. Арифметика ленты статистики: «Лайки»
 *  высотой 150 против «Топ треков» высотой 420 — после обмена большой блок
 *  накрывает курсор на 242 пикселях из 420, то есть на 58% своей площади.
 *  Сторож пары (REORDER_UNDO_MIN) лечил симптом и по дистанции: рука едет —
 *  порог проходится — обмен назад разрешён. Отсюда и «стоит — не прыгает».
 *
 *  ЧТО ПРОВЕРЯЕМ. Память о входе (enteredId) перевзводится после КАЖДОЙ
 *  перестановки тем, что оказалось под курсором с новой геометрией. Значит
 *  повторный обмен требует настоящего ВЫХОДА руки и повторного ВХОДА.
 *
 *  Раскладку подделываем через getBoundingClientRect и считаем ОТ МЕСТА УЗЛА
 *  СРЕДИ БРАТЬЕВ (в jsdom своей раскладки нет). Координаты, приколоченные к
 *  элементу, не заметили бы как раз того, что мы проверяем, — что после
 *  перестановки геометрия читается заново. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { HOLD_MS, gridHitIndex, gridInsertionIndex } from "./dragEngine";
import { useLocalReorder } from "./useLocalReorder";

/** Высоты как в ленте статистики: один блок втрое выше соседей. */
const H: Record<string, number> = { big: 420, small: 150, tail: 150 };
const GAP = 20;
const IDS = ["big", "small", "tail"];

const realRect = Element.prototype.getBoundingClientRect;
const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const parent = this.parentElement;
    if (!parent) return zero;
    const kids = Array.prototype.slice.call(parent.children) as Element[];
    const i = kids.indexOf(this);
    if (i < 0) return zero;
    // Все блоки во всю ширину — как «Топ треков» с flex: 1 1 100%: каждый
    // всегда один в строке, поэтому любая перестановка двигает всю ленту.
    let top = 0;
    for (let k = 0; k < i; k++) top += (H[kids[k].getAttribute("data-testid") ?? ""] ?? 100) + GAP;
    const h = H[this.getAttribute("data-testid") ?? ""] ?? 100;
    return { top, bottom: top + h, left: 0, right: 600, width: 600, height: h, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  cleanup();
  vi.useRealTimers();
});

function Belt({ onOrder }: { onOrder?: (o: readonly string[]) => void }) {
  const r = useLocalReorder({
    ids: IDS,
    resolveTo: (rects, from, x, y) => gridInsertionIndex(rects, from, x, y),
    hitTest: gridHitIndex,
    onCommit: () => undefined,
  });
  onOrder?.(r.order);
  return (
    <div data-testid="belt">
      {r.order.map((id) => (
        <div key={id} data-testid={id} ref={r.itemRef(id)} {...r.grip(id)} />
      ))}
    </div>
  );
}

/** Счётчик НАСТОЯЩИХ перестановок.
 *
 *  ⚠️ Проверять итоговый порядок НЕДОСТАТОЧНО, и это ловушка, на которую я уже
 *  наступил: тридцать микродвижений при осцилляции дают тридцать обменов, а
 *  чётное их число возвращает ленту ровно туда, откуда она вышла — итог
 *  совпадает с ожидаемым, и тест зеленеет на полностью сломанном движке.
 *  Прыжки — это ЧАСТОТА, а не конечное состояние, и мерить надо её. */
function makeCounter() {
  let last: string | null = null;
  let changes = 0;
  return {
    onOrder(o: readonly string[]) {
      const key = o.join(">");
      if (last !== null && key !== last) changes++;
      last = key;
    },
    get changes() {
      return changes;
    },
    reset() {
      changes = 0;
    },
  };
}

const shown = (view: ReturnType<typeof render>): string[] =>
  Array.from(view.getByTestId("belt").children).map((el) => el.getAttribute("data-testid") ?? "");

/** Поднять «small»: он лежит вторым, то есть на 440..590. */
function liftSmall(view: ReturnType<typeof render>) {
  fireEvent.pointerDown(view.getByTestId("small"), { button: 0, clientX: 300, clientY: 500 });
  act(() => {
    vi.advanceTimersByTime(HOLD_MS);
  });
}

/** Провести курсор и дать паузе между перестановками истечь. */
function moveTo(y: number, x = 300) {
  act(() => {
    fireEvent.pointerMove(window, { clientX: x, clientY: y });
  });
  act(() => {
    vi.advanceTimersByTime(200); // REORDER_LOCK_MS = 180
  });
}

describe("разноразмерная лента: вход, а не нахождение", () => {
  it("курсор остался внутри вытесненного блока — второй перестановки НЕТ", () => {
    vi.useFakeTimers();
    const c = makeCounter();
    const view = render(<Belt onOrder={c.onOrder} />);
    expect(shown(view)).toEqual(["big", "small", "tail"]);

    liftSmall(view);
    // Ведём точку захвата внутрь «big» (0..420) — это ВХОД, обмен обязан быть.
    moveTo(300);
    expect(shown(view)).toEqual(["small", "big", "tail"]);

    // Теперь «big» лежит на 170..590 и СНОВА накрывает курсор (y=300). Прежний
    // решатель ответил бы «находится внутри чужой ячейки» и поменял обратно.
    // Тридцать микродвижений — ровно то, что владелец делает рукой.
    c.reset();
    for (let i = 0; i < 30; i++) moveTo(300 + (i % 2 === 0 ? 3 : -3));

    // Меряем ЧАСТОТУ, а не итог: см. makeCounter. Ноль — и ни одной пересборки.
    expect(c.changes, "на микродвижениях лента обязана стоять неподвижно").toBe(0);
    expect(shown(view)).toEqual(["small", "big", "tail"]);
  });

  it("осознанный выход и повторный вход обмен РАЗРЕШАЮТ — жест не залипает", () => {
    vi.useFakeTimers();
    const view = render(<Belt />);
    liftSmall(view);
    moveTo(300);
    expect(shown(view)).toEqual(["small", "big", "tail"]);

    // Увели курсор на свою же плашку (0..150) — там чужой ячейки нет, память
    // взводится.
    moveTo(70);
    expect(shown(view), "выход из чужой ячейки сам по себе ничего не переставляет").toEqual(["small", "big", "tail"]);

    // И вернули обратно в «big» — это новый вход, обмен обязан сработать.
    moveTo(300);
    expect(shown(view)).toEqual(["big", "small", "tail"]);
  });

  it("зазор между блоками входом не считается", () => {
    vi.useFakeTimers();
    const view = render(<Belt />);
    liftSmall(view);
    // 425..430 — щель между «big» (кончился на 420) и «small» (начнётся с 440),
    // плюс гистерезис по краям. Ни в какой ячейке курсор не находится.
    moveTo(428);
    expect(shown(view)).toEqual(["big", "small", "tail"]);
  });
});
