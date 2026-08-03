/** Сторож на живую жалобу владельца 03.08: «когда я открываю устройство
 *  вывода, у меня весь экран улетает вверх».
 *
 *  Причина была не в вёрстке меню, а в обычном `element.focus()`: по умолчанию
 *  он прокручивает ближайшего прокручиваемого предка к элементу. Панель у нас
 *  плавающая и уже стоит где надо — прокручивалось ВСЁ приложение под ней.
 *
 *  Коварство: баг приехал ВМЕСТЕ с починкой. До 03.08 фокус в меню не входил
 *  вовсе (гонка монтирования), поэтому и прокрутки не было; починили
 *  клавиатуру — получили уезжающий экран. Тест закрывает обе стороны сразу:
 *  фокус обязан войти И обязан войти без прокрутки.
 *
 *  jsdom прокрутку не считает, поэтому проверяем именно аргумент вызова — это
 *  единственное, что здесь вообще наблюдаемо, и ровно оно и было пропущено. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Menu } from "./Menu.jsx";
import { Dialog } from "./Dialog.jsx";

afterEach(cleanup);

/** Ловит КАЖДЫЙ focus() на элементах поддерева и запоминает его аргумент. */
function spyFocus() {
  const calls = [];
  const orig = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function patched(opts) {
    calls.push({ el: this, opts });
    return orig.call(this, opts);
  };
  return {
    calls,
    restore() {
      HTMLElement.prototype.focus = orig;
    },
  };
}

describe("фокус в плавающем слое не прокручивает страницу", () => {
  it("меню: фокус входит в первый пункт И без прокрутки", () => {
    const spy = spyFocus();
    try {
      const { rerender } = render(<Menu open={false} items={[{ label: "Системный вывод" }]} onClose={() => {}} />);
      rerender(<Menu open items={[{ label: "Системный вывод" }]} onClose={() => {}} />);

      const item = screen.getByRole("menuitem", { name: /Системный вывод/ });
      // Обе стороны сразу: фокус ВОШЁЛ (иначе клавиатура мертва)…
      expect(document.activeElement).toBe(item);
      // …и вошёл БЕЗ прокрутки (иначе экран уезжает).
      const call = spy.calls.find((c) => c.el === item);
      expect(call, "focus по пункту меню не вызывался").toBeTruthy();
      expect(call.opts).toEqual({ preventScroll: true });
    } finally {
      spy.restore();
    }
  });

  it("меню: ходьба стрелками тоже не прокручивает", () => {
    const spy = spyFocus();
    try {
      const items = [{ label: "Первый" }, { label: "Второй" }];
      const { rerender } = render(<Menu open={false} items={items} onClose={() => {}} />);
      rerender(<Menu open items={items} onClose={() => {}} />);

      fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
      const second = screen.getByRole("menuitem", { name: /Второй/ });
      const call = spy.calls.find((c) => c.el === second);
      expect(call, "стрелка не перевела фокус").toBeTruthy();
      expect(call.opts).toEqual({ preventScroll: true });
    } finally {
      spy.restore();
    }
  });

  it("диалог: фокус входит внутрь без прокрутки", () => {
    const spy = spyFocus();
    try {
      const { rerender } = render(
        <Dialog open={false} title="Переименовать" onClose={() => {}}>
          <button type="button">Готово</button>
        </Dialog>,
      );
      rerender(
        <Dialog open title="Переименовать" onClose={() => {}}>
          <button type="button">Готово</button>
        </Dialog>,
      );

      const inside = spy.calls.filter((c) => c.el !== document.body);
      expect(inside.length, "фокус в диалог не вошёл").toBeGreaterThan(0);
      for (const c of inside) expect(c.opts).toEqual({ preventScroll: true });
    } finally {
      spy.restore();
    }
  });
});
