import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Tooltip } from "./Tooltip.jsx";

/** IconButton заворачивает в Tooltip каждую кнопку с label, поэтому подсказка —
 *  единственная видимая подпись у кнопок плеера. Пока она всплывала только по
 *  наведению мыши, для табуляции весь транспорт был безымянными кружками
 *  (аудит 02.08).
 *
 *  С 04.08 узел подсказки существует ТОЛЬКО пока она видна (и живёт порталом
 *  в theme-div, чтобы его не резали overflow по дороге) — поэтому тест
 *  проверяет появление/исчезновение узла, а не переключение aria-hidden.
 *  С 05.08 подсказка ещё и ГАСНЕТ, а не пропадает кадром: узел переживает уход
 *  и снимается по концу перехода (lib/useLayerState.js). Отсюда фальшивые
 *  таймеры — иначе ждать пришлось бы по-настоящему. */

describe("Tooltip", () => {
  it("всплывает по фокусу, а не только по наведению мыши, и гаснет по уходу", () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip label="Дальше">
          <button type="button">▶</button>
        </Tooltip>,
      );

      // покой: узла подсказки нет вовсе — скрытая подсказка не стоит ничего
      expect(screen.queryByText("Дальше")).toBeNull();

      const btn = screen.getByRole("button");
      act(() => btn.focus());
      const tip = screen.getByText("Дальше");
      // пузырёк декоративен: у кнопки есть свой aria-label, дублировать нечего
      expect(tip.getAttribute("aria-hidden")).toBe("true");
      expect(tip.dataset.layerState).toBe("open");

      act(() => btn.blur());
      // узел ещё в дереве — он гаснет; позиция при этом сохранена, иначе
      // пузырёк уехал бы гаснуть в левый верхний угол окна
      expect(screen.getByText("Дальше").dataset.layerState).toBe("closed");
      expect(tip.style.visibility).toBe("visible");

      // transitionend в jsdom не приходит — узел снимает страховка хука
      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByText("Дальше")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
