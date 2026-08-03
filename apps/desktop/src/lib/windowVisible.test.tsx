/** Сигнал «видно ли окно» (03.08). Сторожим ровно то, из-за чего он вообще
 *  заведён: страница в WebView2 про свёрнутое окно не знает, поэтому источник
 *  правды — событие из Rust, и ошибаться этот модуль обязан ТОЛЬКО в сторону
 *  «видно» (замершая анимация у видимого окна хуже лишних кадров).
 *
 *  Модуль держит состояние и подписку на уровне модуля — между тестами его
 *  надо поднимать заново, отсюда resetModules + динамический импорт. */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

type Emit = (payload: unknown) => void;

/** Свежий модуль + «рука» на нативном событии: возвращённый emit зовёт того же
 *  обработчика, которого модуль отдал в listen. */
async function freshModule() {
  vi.resetModules();
  const mod = await import("./windowVisible");
  const emit: Emit = (payload) => {
    const handler = listenMock.mock.calls.at(-1)?.[1] as ((e: { payload: unknown }) => void) | undefined;
    if (!handler) throw new Error("подписки нет — событие некому доставить");
    act(() => handler({ payload }));
  };
  return { useWindowVisible: mod.useWindowVisible, emit };
}

beforeEach(() => {
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWindowVisible", () => {
  it("до первого события — true: пока система молчит, мы рисуем", async () => {
    const { useWindowVisible } = await freshModule();
    const { result } = renderHook(() => useWindowVisible());
    expect(result.current).toBe(true);
  });

  it("подписывается на то же имя события, что шлёт Rust", async () => {
    const { useWindowVisible } = await freshModule();
    renderHook(() => useWindowVisible());
    expect(listenMock).toHaveBeenCalledWith("muza-window-visible", expect.any(Function));
  });

  it("false гасит, true возвращает обратно", async () => {
    const { useWindowVisible, emit } = await freshModule();
    const { result } = renderHook(() => useWindowVisible());

    emit(false);
    expect(result.current).toBe(false);

    emit(true);
    expect(result.current).toBe(true);
  });

  it("нагрузка не boolean трактуется как «видно» (гасим только по явному false)", async () => {
    const { useWindowVisible, emit } = await freshModule();
    const { result } = renderHook(() => useWindowVisible());

    emit(undefined);
    expect(result.current).toBe(true);
    emit(null);
    expect(result.current).toBe(true);
  });

  it("отказ подписки не роняет экран — остаёмся в true", async () => {
    listenMock.mockRejectedValue(new Error("Tauri тут нет"));
    const { useWindowVisible } = await freshModule();
    const { result } = renderHook(() => useWindowVisible());
    // дать отказу доехать до обработчика
    await act(async () => undefined);
    expect(result.current).toBe(true);
  });

  it("синхронный бросок listen тоже не роняет экран", async () => {
    listenMock.mockImplementation(() => {
      throw new Error("нет __TAURI_INTERNALS__");
    });
    const { useWindowVisible } = await freshModule();
    const { result } = renderHook(() => useWindowVisible());
    expect(result.current).toBe(true);
  });

  it("подписка ОДНА на всех потребителей и снимается с уходом последнего", async () => {
    const off = vi.fn();
    listenMock.mockResolvedValue(off);
    const { useWindowVisible } = await freshModule();

    const a = renderHook(() => useWindowVisible());
    const b = renderHook(() => useWindowVisible());
    await act(async () => undefined);
    expect(listenMock).toHaveBeenCalledTimes(1);

    a.unmount();
    expect(off).not.toHaveBeenCalled(); // второй ещё смотрит
    b.unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("все потребители видят одно состояние", async () => {
    const { useWindowVisible, emit } = await freshModule();
    const a = renderHook(() => useWindowVisible());
    const b = renderHook(() => useWindowVisible());

    emit(false);
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);
  });

  it("после ухода последнего потребителя состояние возвращается в «видно»", async () => {
    const { useWindowVisible, emit } = await freshModule();
    const first = renderHook(() => useWindowVisible());
    await act(async () => undefined);
    emit(false);
    expect(first.result.current).toBe(false);
    first.unmount();

    // Событие приходит только на СМЕНУ состояния: застрявший false заморозил
    // бы анимации у видимого окна до следующей смены.
    const second = renderHook(() => useWindowVisible());
    expect(second.result.current).toBe(true);
  });
});
