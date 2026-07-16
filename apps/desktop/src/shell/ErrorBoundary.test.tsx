import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

// Крашскрин вместо белого экрана + репорт в телеметрию ошибок (кусок A).
// Текст двуязычный и без useT: i18n сам мог быть причиной падения.

afterEach(cleanup);

function Bomb(): never {
  throw new Error("рендер взорвался");
}

describe("ErrorBoundary", () => {
  it("без ошибок просто рендерит детей", () => {
    render(
      <ErrorBoundary onError={() => {}}>
        <div>живой контент</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("живой контент")).toBeTruthy();
  });

  it("падение ребёнка — фолбэк с кнопкой перезапуска, onError получил ошибку", () => {
    const onError = vi.fn();
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary onError={onError}>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("button")).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("рендер взорвался");
    silenced.mockRestore();
  });
});
