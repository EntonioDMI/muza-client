import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Dialog } from "./Dialog.jsx";

/** Тесты фокуса написаны ПОД ГОНКУ монтирования (аудит 02.08): приложение
 *  держит <Dialog open={…}> всегда смонтированным и переключает проп, а панель
 *  появляется в DOM только вторым коммитом (mounted включается пассивным
 *  эффектом). Поэтому рендерим ЗАКРЫТЫМ и открываем rerender'ом — как в жизни;
 *  render(<Dialog open />) сразу такую гонку не воспроизводит. */

function Harness({ open, onClose = () => {} }) {
  return (
    <Dialog open={open} title="Заголовок" onClose={onClose} actions={<button>ОК</button>}>
      <input aria-label="поле" />
    </Dialog>
  );
}

describe("Dialog", () => {
  it("уводит фокус внутрь панели при открытии уже смонтированного диалога", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);

    expect(document.activeElement).toBe(screen.getByLabelText("поле"));
    opener.remove();
  });

  it("возвращает фокус на открывший элемент при закрытии", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);
    rerender(<Harness open={false} />);

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  /** ⚠️ ПЕРВЫЙ В ОБХОДЕ — КРЕСТИК ШАПКИ, А НЕ ПОЛЕ (13.08). Крестик появился
   *  вместе с «лицом диалога» и стоит в разметке выше тела, поэтому цикл Tab
   *  замыкается на него. Фокус ПРИ ОТКРЫТИИ по-прежнему уходит в поле — это
   *  разные вещи, и первый тест файла стережёт именно её. */
  it("зацикливает Tab внутри панели — на крестик шапки", () => {
    const { rerender } = render(<Harness open={false} />);
    rerender(<Harness open />);

    const ok = screen.getByRole("button", { name: "ОК" });
    ok.focus();
    fireEvent.keyDown(ok, { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("крестик шапки закрывает диалог", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness open={false} onClose={onClose} />);
    rerender(<Harness open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("showClose={false} убирает крестик — для подтверждений", () => {
    const { rerender } = render(
      <Dialog open={false} title="Заголовок" onClose={() => {}} showClose={false} actions={<button>ОК</button>}>
        <input aria-label="поле" />
      </Dialog>,
    );
    rerender(
      <Dialog open title="Заголовок" onClose={() => {}} showClose={false} actions={<button>ОК</button>}>
        <input aria-label="поле" />
      </Dialog>,
    );

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("не закрывается, когда выделение текста началось в панели, а отпустили мимо", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness open={false} onClose={onClose} />);
    rerender(<Harness open onClose={onClose} />);

    const panel = screen.getByRole("dialog");
    const scrim = panel.parentElement;
    // мышь нажата на тексте В ПАНЕЛИ, отпущена за её краем: click приходит на
    // общего предка — затемнение
    fireEvent.mouseDown(panel);
    fireEvent.click(scrim);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("закрывается по честному клику в затемнение", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness open={false} onClose={onClose} />);
    rerender(<Harness open onClose={onClose} />);

    const scrim = screen.getByRole("dialog").parentElement;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);

    expect(onClose).toHaveBeenCalled();
  });
});
