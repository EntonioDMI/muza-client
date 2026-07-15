import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MuzaApi, Session } from "@muza/api-client";
import { LoginScreen } from "./LoginScreen";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const session: Session = {
  user: { id: "u1", username: "sivren", anonymous: false, createdAt: "2026-07-15T00:00:00Z" },
  accessToken: "at",
  refreshToken: "rt",
};

/** Заглушка API: только методы, которые дёргает submit в каждом режиме. */
function stubApi(over: Partial<MuzaApi> = {}): MuzaApi {
  return {
    login: vi.fn(async () => session),
    register: vi.fn(async () => session),
    registerStart: vi.fn(async () => ({ pendingId: "p1", email: "a@b.co" })),
    recoveryStart: vi.fn(async () => undefined),
    ...over,
  } as unknown as MuzaApi;
}

function type(placeholder: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

/** Enter должен работать из ЛЮБОГО поля — как в нативной <form>, а не только
 *  из последнего. Обёртка с onKeyDown стоит вокруг всех полей (LoginScreen.tsx). */
describe("LoginScreen: Enter = главная кнопка", () => {
  it("вход: Enter из поля пароля логинит", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" />);
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    fireEvent.keyDown(screen.getByPlaceholderText("Пароль"), { key: "Enter" });
    expect(api.login).toHaveBeenCalledWith({ username: "sivren", password: "hunter22" });
  });

  it("вход: Enter из поля имени тоже логинит (native-семантика формы)", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" />);
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    fireEvent.keyDown(screen.getByPlaceholderText("Имя пользователя"), { key: "Enter" });
    expect(api.login).toHaveBeenCalledTimes(1);
  });

  it("Enter отдаёт сессию наверх — тот же путь, что и клик по кнопке", async () => {
    const onSession = vi.fn();
    render(<LoginScreen api={stubApi()} onSession={onSession} lang="ru" />);
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    fireEvent.keyDown(screen.getByPlaceholderText("Пароль"), { key: "Enter" });
    await vi.waitFor(() => expect(onSession).toHaveBeenCalledWith(session));
  });

  it("не-Enter не отправляет", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" />);
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    fireEvent.keyDown(screen.getByPlaceholderText("Пароль"), { key: "a" });
    expect(api.login).not.toHaveBeenCalled();
  });

  it("Enter проходит валидацию: короткий пароль не уходит на сервер", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" />);
    type("Имя пользователя", "s");
    type("Пароль", "1");
    fireEvent.keyDown(screen.getByPlaceholderText("Пароль"), { key: "Enter" });
    expect(api.login).not.toHaveBeenCalled();
  });

  it("восстановление: Enter из поля почты шлёт recoveryStart", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" />);
    fireEvent.click(screen.getByText("Восстановление"));
    type("Email аккаунта", "a@b.co");
    fireEvent.keyDown(screen.getByPlaceholderText("Email аккаунта"), { key: "Enter" });
    expect(api.recoveryStart).toHaveBeenCalledWith("a@b.co");
  });
});
