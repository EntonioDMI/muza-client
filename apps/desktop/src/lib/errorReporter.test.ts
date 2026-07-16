import { describe, expect, it, vi } from "vitest";
import { createErrorReporter, stackHashOf } from "./errorReporter";

// Захват ошибок, которые пользователи не репортят (админ-панель, кусок A).
// Буфер с дедупом по stackHash; сервер хранит только message+хэш (анонимно),
// поэтому клиент шлёт хэш стека, а не сам стек.

describe("stackHashOf", () => {
  it("детерминированный 16-символьный hex", () => {
    const h = stackHashOf("boom", "at main.tsx:1:1");
    expect(h).toBe(stackHashOf("boom", "at main.tsx:1:1"));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("разный стек — разный хэш", () => {
    expect(stackHashOf("boom", "at a.ts:1")).not.toBe(stackHashOf("boom", "at b.ts:2"));
  });
});

describe("errorReporter — буфер с дедупом", () => {
  it("window error попадает в буфер с kind=error", () => {
    const rep = createErrorReporter();
    const uninstall = rep.install(window);

    window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: { stack: "at x.ts:1" } }));

    const batch = rep.take();
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ kind: "error", message: "boom", count: 1 });
    expect(batch[0].stackHash).toMatch(/^[0-9a-f]{16}$/);
    uninstall();
  });

  it("повтор той же ошибки — count растёт, запись одна", () => {
    const rep = createErrorReporter();
    const uninstall = rep.install(window);

    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: { stack: "at x.ts:1" } }));
    }

    const batch = rep.take();
    expect(batch).toHaveLength(1);
    expect(batch[0].count).toBe(3);
    uninstall();
  });

  it("unhandledrejection попадает с kind=unhandledrejection", () => {
    const rep = createErrorReporter();
    const uninstall = rep.install(window);

    const ev = new Event("unhandledrejection") as Event & { reason?: unknown };
    ev.reason = new Error("отвал промиса");
    window.dispatchEvent(ev);

    const batch = rep.take();
    expect(batch).toHaveLength(1);
    expect(batch[0].kind).toBe("unhandledrejection");
    expect(batch[0].message).toContain("отвал промиса");
    uninstall();
  });

  it("uninstall снимает слушатели", () => {
    const rep = createErrorReporter();
    rep.install(window)();

    window.dispatchEvent(new ErrorEvent("error", { message: "after uninstall" }));

    expect(rep.size()).toBe(0);
  });

  it("reportReactError кладёт kind=react и дёргает urgent-колбэк", () => {
    const rep = createErrorReporter();
    const urgent = vi.fn();
    rep.onUrgent(urgent);

    rep.reportReactError(new Error("рендер умер"));

    expect(urgent).toHaveBeenCalledTimes(1);
    const batch = rep.take();
    expect(batch[0]).toMatchObject({ kind: "react", count: 1 });
    expect(batch[0].message).toContain("рендер умер");
  });

  it("обычный capture urgent-колбэк НЕ дёргает", () => {
    const rep = createErrorReporter();
    const urgent = vi.fn();
    rep.onUrgent(urgent);

    rep.capture("error", "тихая ошибка");

    expect(urgent).not.toHaveBeenCalled();
  });

  it("take дренирует до max, остаток ждёт следующего окна", () => {
    const rep = createErrorReporter();
    rep.capture("error", "a", "s1");
    rep.capture("error", "b", "s2");
    rep.capture("error", "c", "s3");

    expect(rep.take(2)).toHaveLength(2);
    expect(rep.size()).toBe(1);
    expect(rep.take()).toHaveLength(1);
    expect(rep.take()).toHaveLength(0);
  });

  it("потолок различных ошибок: сверх лимита новые молча игнорируются", () => {
    const rep = createErrorReporter({ maxDistinct: 2 });
    rep.capture("error", "a", "s1");
    rep.capture("error", "b", "s2");
    rep.capture("error", "c", "s3");

    expect(rep.size()).toBe(2);
    // повтор уже учтённой — по-прежнему инкрементится
    rep.capture("error", "a", "s1");
    expect(rep.take().find((e) => e.message === "a")?.count).toBe(2);
  });

  it("message обрезается до 2000 (DTO-потолок сервера)", () => {
    const rep = createErrorReporter();
    rep.capture("error", "x".repeat(3000));

    expect(rep.take()[0].message.length).toBeLessThanOrEqual(2000);
  });

  it("clear выбрасывает буфер (телеметрию выключили — ничего не копим)", () => {
    const rep = createErrorReporter();
    rep.capture("error", "a");
    rep.clear();

    expect(rep.size()).toBe(0);
  });
});
