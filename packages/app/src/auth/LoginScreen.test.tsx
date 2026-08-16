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

/** Enter из поля = отправка формы, в которой это поле лежит.
 *
 *  ⚠️ Почему не `fireEvent.keyDown(..., "Enter")`, как было до 15.08: тогда
 *  вокруг полей стоял `<div onKeyDown>`, и нажатие ловил он. Теперь это
 *  настоящая `<form>` — в браузере Enter из текстового поля вызывает неявную
 *  отправку, а **jsdom её не реализует вовсе**. Поэтому здесь шлём то самое
 *  событие, которое браузер послал бы сам; утверждения тестов не изменились. */
function enter(placeholder: string) {
  const form = screen.getByPlaceholderText(placeholder).closest("form");
  if (!form) throw new Error(`поле «${placeholder}» вне формы — неявная отправка по Enter не сработает`);
  fireEvent.submit(form);
}

/** Enter должен работать из ЛЮБОГО поля — как в нативной <form>, а не только
 *  из последнего. */
describe("LoginScreen: Enter = главная кнопка", () => {
  it("вход: Enter из поля пароля логинит", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" glyphSrc="/glyph.svg" />);
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    enter("Пароль");
    expect(api.login).toHaveBeenCalledWith({ username: "sivren", password: "hunter22" });
  });

  it("вход: Enter из поля имени тоже логинит (native-семантика формы)", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" glyphSrc="/glyph.svg" />);
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    enter("Имя пользователя");
    expect(api.login).toHaveBeenCalledTimes(1);
  });

  it("Enter отдаёт сессию наверх — тот же путь, что и клик по кнопке", async () => {
    const onSession = vi.fn();
    render(<LoginScreen api={stubApi()} onSession={onSession} lang="ru" glyphSrc="/glyph.svg" />);
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    enter("Пароль");
    await vi.waitFor(() => expect(onSession).toHaveBeenCalledWith(session));
  });

  it("не-Enter не отправляет", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" glyphSrc="/glyph.svg" />);
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    fireEvent.keyDown(screen.getByPlaceholderText("Пароль"), { key: "a" });
    expect(api.login).not.toHaveBeenCalled();
  });

  it("Enter проходит валидацию: короткий пароль не уходит на сервер", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" glyphSrc="/glyph.svg" />);
    type("Имя пользователя", "s");
    type("Пароль", "1");
    enter("Пароль");
    expect(api.login).not.toHaveBeenCalled();
  });

  it("восстановление: Enter из поля почты шлёт recoveryStart", () => {
    const api = stubApi();
    render(<LoginScreen api={api} onSession={vi.fn()} lang="ru" glyphSrc="/glyph.svg" />);
    fireEvent.click(screen.getByText("Восстановление"));
    type("Email аккаунта", "a@b.co");
    enter("Email аккаунта");
    expect(api.recoveryStart).toHaveBeenCalledWith("a@b.co");
  });
});

/** Веб-раскладка того же экрана: чего в браузере не бывает — того там просто
 *  нет, без серых заглушек. Тесты сторожат именно ОТСУТСТВИЕ, потому что
 *  «отключено, но видно» — самая частая форма деградации этого правила. */
describe("LoginScreen: набор возможностей пропсами (веб)", () => {
  const web = {
    api: stubApi(),
    onSession: vi.fn(),
    lang: "ru" as const,
    glyphSrc: "/glyph.svg",
    showEmailFeatures: false,
    showAnonymous: false,
  };

  it("без почтовых возможностей нет ни вкладки восстановления, ни поля почты", () => {
    render(<LoginScreen {...web} />);
    expect(screen.queryByText("Восстановление")).toBeNull();
    fireEvent.click(screen.getByText("Регистрация"));
    expect(screen.queryByPlaceholderText("Email (не обязательно)")).toBeNull();
  });

  it("без анонимного режима нет кнопки «Продолжить анонимно»", () => {
    render(<LoginScreen {...web} />);
    expect(screen.queryByText("Продолжить анонимно")).toBeNull();
  });

  it("регистрация без почты идёт обычным путём register", async () => {
    const api = stubApi();
    const onSession = vi.fn();
    render(<LoginScreen {...web} api={api} onSession={onSession} />);
    fireEvent.click(screen.getByText("Регистрация"));
    type("Имя пользователя", "sivren");
    type("Пароль", "hunter22");
    enter("Пароль");
    await vi.waitFor(() => expect(onSession).toHaveBeenCalledWith(session));
    expect(api.registerStart).not.toHaveBeenCalled();
  });

  it("без onTelemetry строки согласия нет — выбор нельзя обещать впустую", () => {
    render(<LoginScreen {...web} />);
    fireEvent.click(screen.getByText("Регистрация"));
    expect(screen.queryByText("Отправлять анонимную статистику")).toBeNull();
  });

  it("footerNote заменяет подсказку режима", () => {
    render(<LoginScreen {...web} footerNote="Только в приложении" />);
    expect(screen.getByText("Только в приложении")).toBeTruthy();
    expect(screen.queryByText("Email не нужен. Никакой персональной истории прослушиваний.")).toBeNull();
  });
});

/** Десктопная раскладка: те же пропсы по умолчанию — на экране всё. */
describe("LoginScreen: полный набор (десктоп)", () => {
  it("вкладка восстановления, аноним и строка согласия на месте", () => {
    render(<LoginScreen api={stubApi()} onSession={vi.fn()} lang="ru" glyphSrc="/glyph.svg" onTelemetry={vi.fn()} />);
    expect(screen.getByText("Восстановление")).toBeTruthy();
    expect(screen.getByText("Продолжить анонимно")).toBeTruthy();
    fireEvent.click(screen.getByText("Регистрация"));
    expect(screen.getByPlaceholderText("Email (не обязательно)")).toBeTruthy();
    expect(screen.getAllByText("Отправлять анонимную статистику").length).toBeGreaterThan(0);
  });
});
