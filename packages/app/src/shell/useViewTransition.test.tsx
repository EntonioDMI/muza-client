/** ПЕРЕХОД МЕЖДУ ЭКРАНАМИ: уходящий обязан дожить до конца своего затухания.
 *
 *  Регрессия на жалобу владельца 05.08 («переходы стали хуже»). До этого хука
 *  смена экрана меняла `view`, React ремонтировал поддерево — и старое
 *  содержимое исчезало КАДРОМ: анимировался только вход нового, то есть переход
 *  состоял ровно из половины.
 *
 *  ⚠️ Длительность здесь берётся ФОЛБЭКОМ (120 мс): в jsdom раскладки нет,
 *  readDurationMs честно возвращает ноль. Проверяем МАШИНУ фаз, а не числа —
 *  числа живут в токенах и проверяются пиксельно в живом окне. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useViewTransition } from "./useViewTransition";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Тот же фолбэк, что в хуке: узла с длительностью в jsdom нет. */
const OUT_MS = 120;

describe("useViewTransition", () => {
  it("на старте нарисовано ровно то, что выбрано", () => {
    const { result } = renderHook(() => useViewTransition("home"));
    expect(result.current.rendered).toBe("home");
    expect(result.current.phase).toBe("in");
  });

  it("смена экрана НЕ снимает старый сразу — он уходит", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useViewTransition(v), {
      initialProps: { v: "home" },
    });

    rerender({ v: "library" });
    // Ключевое: нарисован ПРЕЖНИЙ экран — ему и есть что анимировать.
    expect(result.current.rendered, "старый экран обязан дожить до конца ухода").toBe("home");
    expect(result.current.phase).toBe("out");

    act(() => {
      vi.advanceTimersByTime(OUT_MS);
    });
    expect(result.current.rendered).toBe("library");
    expect(result.current.phase).toBe("in");
  });

  it("быстрые переключения приземляются на ПОСЛЕДНЕМ выборе, а не на промежуточном", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useViewTransition(v), {
      initialProps: { v: "home" },
    });

    // Человек щёлкает по сайдбару три раза подряд, быстрее одного ухода.
    rerender({ v: "library" });
    act(() => {
      vi.advanceTimersByTime(OUT_MS / 3);
    });
    rerender({ v: "stats" });
    act(() => {
      vi.advanceTimersByTime(OUT_MS / 3);
    });
    rerender({ v: "search" });

    act(() => {
      vi.advanceTimersByTime(OUT_MS * 2);
    });

    // Промежуточные экраны не должны мелькнуть и тем более остаться.
    expect(result.current.rendered, "приземлиться обязаны на том, что выбрали последним").toBe("search");
    expect(result.current.phase).toBe("in");
  });

  it("возврат на тот же экран посреди ухода не оставляет его в фазе ухода", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useViewTransition(v), {
      initialProps: { v: "home" },
    });

    rerender({ v: "library" });
    expect(result.current.phase).toBe("out");
    // Передумал и вернулся — экран тот же, уходить некуда.
    rerender({ v: "home" });
    act(() => {
      vi.advanceTimersByTime(OUT_MS * 2);
    });
    expect(result.current.rendered).toBe("home");
    expect(result.current.phase, "застрять в 'out' навсегда — самый дорогой отказ этой машины").toBe("in");
  });

  it("размонтирование снимает таймер — setState на снятом хуке не случится", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender, unmount } = renderHook(({ v }) => useViewTransition(v), {
      initialProps: { v: "home" },
    });
    rerender({ v: "library" });
    unmount();
    act(() => {
      vi.advanceTimersByTime(OUT_MS * 3);
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
