/** Судьба порядка и таймеров, когда экран закрывают посреди жеста.
 *
 *  ИСТОРИЯ. Оба таймера висели на window.setTimeout и никем не снимались при
 *  размонтировании: таймер УДЕРЖАНИЯ (HOLD_MS) поднимал плашку в дереве,
 *  которого уже нет, а таймер ПОСАДКИ отправлял порядок на сервер после ухода.
 *  Посадку чинили, снимая таймер и коммитя сразу (2026-08-03).
 *
 *  ЧТО ИЗМЕНИЛОСЬ 2026-08-04. Посадки как ФАЗЫ КОММИТА больше нет вовсе:
 *  порядок меняется живьём, и к моменту отпускания на экране уже стоит
 *  конечный результат — ждать нечего, коммит уходит прямо в pointerup. Полёт
 *  плашки к слоту остался, но он чисто зрительный и ничего не задерживает.
 *  Поэтому тест ниже проверяет ровно это: коммит УЖЕ случился к моменту ухода,
 *  а размонтирование не добавляет и не повторяет ничего. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { HOLD_MS } from "./dragEngine";
import { useLocalReorder } from "./useLocalReorder";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const IDS = ["a", "b", "c"];

function List({ onCommit }: { onCommit: (id: string, to: number) => void }) {
  // resolveTo зафиксирован: геометрии в jsdom нет, а проверяем мы не её, а
  // судьбу порядка и таймеров — «куда встанет» задаём прямо.
  const r = useLocalReorder({ ids: IDS, resolveTo: () => 2, onCommit });
  return (
    <div>
      {r.order.map((id) => (
        <div key={id} data-testid={id} ref={r.itemRef(id)} {...r.grip(id)} />
      ))}
    </div>
  );
}

const press = (el: Element) => fireEvent.pointerDown(el, { button: 0, clientX: 0, clientY: 0 });

describe("useLocalReorder — уход с экрана посреди жеста", () => {
  it("порядок уходит на сервер в момент отпускания, а не по таймеру посадки", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const view = render(<List onCommit={onCommit} />);

    press(view.getByTestId("a"));
    vi.advanceTimersByTime(HOLD_MS); // держал — плашка поднялась
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40 }); // потащил — цель определилась
    fireEvent.pointerUp(window);

    expect(onCommit).toHaveBeenCalledWith("a", 2);

    view.unmount(); // ушёл, пока плашка ещё долетала до слота
    vi.runAllTimers();
    // хвоста нет: полёт — косметика, повторять коммит ему нечем
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("ушёл, не отпустив кнопку, — подъём не срабатывает после размонтирования", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const view = render(<List onCommit={onCommit} />);

    press(view.getByTestId("a"));
    view.unmount(); // удержание ещё идёт

    vi.runAllTimers();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape отменил перестановку, следом уход — сервер не трогаем", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const view = render(<List onCommit={onCommit} />);

    press(view.getByTestId("a"));
    vi.advanceTimersByTime(HOLD_MS);
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40 });
    fireEvent.keyDown(window, { key: "Escape" }); // возврат на исходное место

    view.unmount();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape помечает событие взятым — режим правки вида по нему не выходит", () => {
    vi.useFakeTimers();
    const view = render(<List onCommit={() => undefined} />);

    press(view.getByTestId("a"));
    vi.advanceTimersByTime(HOLD_MS);
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40 });

    const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
  });

  it("без живого жеста Escape НЕ трогаем — он принадлежит тому, кто его ждёт", () => {
    render(<List onCommit={() => undefined} />);
    const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
  });
});
