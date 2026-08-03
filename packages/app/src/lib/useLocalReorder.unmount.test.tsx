/** Таймеры жеста переставания не переживают экран (правка 2026-08-03).
 *
 *  Оба таймера висели на window.setTimeout и никем не снимались при
 *  размонтировании:
 *  — таймер УДЕРЖАНИЯ (HOLD_MS): ушёл со страницы, не отпустив кнопку, — и
 *    через 280 мс плашка «поднималась» в дереве, которого уже нет;
 *  — таймер ПОСАДКИ (SETTLE_MS): отпустил плашку и в те же 180 мс ушёл на
 *    другой экран — отправка на сервер уходила уже после ухода.
 *
 *  Что решено (см. комментарий в useLocalReorder.ts): задержка посадки —
 *  зрительная, а порядок пользователь задал по-настоящему. Поэтому при
 *  размонтировании таймер снимается, а коммит делается СРАЗУ — порядок не
 *  теряется и хвост в никуда не остаётся. Незавершённое удержание не значит
 *  ничего и гасится молча. */

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
  // судьбу таймеров — «куда встанет» задаём прямо.
  const r = useLocalReorder({ ids: IDS, resolveTo: () => 2, onCommit });
  return (
    <div>
      {IDS.map((id) => (
        <div key={id} data-testid={id} ref={r.itemRef(id)} {...r.grip(id)} />
      ))}
    </div>
  );
}

const press = (el: Element) => fireEvent.pointerDown(el, { button: 0, clientX: 0, clientY: 0 });

describe("useLocalReorder — уход с экрана посреди жеста", () => {
  it("отпустил плашку и сразу ушёл — порядок доезжает до сервера, а не теряется", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const view = render(<List onCommit={onCommit} />);

    press(view.getByTestId("a"));
    vi.advanceTimersByTime(HOLD_MS); // держал — плашка поднялась
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40 }); // потащил — цель определилась
    fireEvent.pointerUp(window); // отпустил — пошла посадка
    expect(onCommit).not.toHaveBeenCalled();

    view.unmount(); // ушёл раньше, чем посадка досчитала

    expect(onCommit).toHaveBeenCalledWith("a", 2);
    // и никакого хвоста: досчёт снятого таймера ничего не повторяет
    vi.runAllTimers();
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
});
