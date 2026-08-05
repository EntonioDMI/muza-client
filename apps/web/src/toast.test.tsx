/** Сколько живёт тост веба.
 *
 *  Число было зашито в файл (2600), а в приложении то же время уже жило
 *  токеном --dur-toast-hold и его парой TOAST_HOLD в packages/ui/src/lib/
 *  motion.js. Разъезжается такое молча: пилюля выглядит одинаково, а гаснет в
 *  разное время — и заметить это можно только держа два окна рядом.
 *
 *  Проверяем НАБЛЮДАЕМОЕ: видно сообщение или нет (узел тоста не снимается —
 *  он гаснет прозрачностью, иначе пилюля дёрнула бы ширину посреди затухания). */

import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_HOLD } from "@muza/ui";
import { ToastProvider, useToast } from "./toast";

function Shout({ text }: { text: string }) {
  const notify = useToast();
  useEffect(() => {
    notify(text);
  }, [notify, text]);
  return null;
}

const pill = (text: string): HTMLElement => screen.getByText(text);

describe("тост веба", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("гаснет ровно по общему числу шкалы, ни раньше ни позже", () => {
    render(
      <ToastProvider>
        <Shout text="Готово" />
      </ToastProvider>,
    );

    expect(pill("Готово").style.opacity).toBe("1");

    act(() => vi.advanceTimersByTime(TOAST_HOLD - 1));
    expect(pill("Готово").style.opacity).toBe("1"); // ещё своё время не отжил

    act(() => vi.advanceTimersByTime(1));
    expect(pill("Готово").style.opacity).toBe("0");
  });
});
