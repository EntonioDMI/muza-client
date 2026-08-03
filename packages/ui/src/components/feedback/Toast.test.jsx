import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Toast } from "./Toast.jsx";

/** Сценарий из аудита 02.08: удалил трек, тост «Отменить» погас через 6 секунд,
 *  жмёшь Tab и Enter — и вслепую откатываешь удаление (или запускаешь установку
 *  обновления). Прозрачность и pointer-events фокусируемость не отменяют. */

describe("Toast", () => {
  it("пока сообщение видно, кнопка действия работает", () => {
    const onAction = vi.fn();
    render(<Toast open message="Трек удалён" actionLabel="Отменить" onAction={onAction} />);

    const btn = screen.getByRole("button", { name: "Отменить" });
    expect(btn.tabIndex).toBe(0);
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalled();
  });

  it("погасший тост уносит кнопку из обхода Tab и из дерева доступности", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <Toast open message="Трек удалён" actionLabel="Отменить" onAction={onAction} />,
    );
    rerender(<Toast open={false} message="Трек удалён" actionLabel="Отменить" onAction={onAction} />);

    expect(screen.queryByRole("button", { name: "Отменить" })).toBeNull();
    const btn = screen.getByText("Отменить");
    expect(btn.tabIndex).toBe(-1);
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
  });
});
