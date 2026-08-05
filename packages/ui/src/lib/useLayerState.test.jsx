import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useLayerState } from "./useLayerState.js";

/** Хук держит жизненный цикл плавающего слоя, а не его вид: проверяем ровно то,
 *  за что он отвечает — когда узел появляется, когда меняет data-layer-state и
 *  по какому событию исчезает. Сама анимация в jsdom не идёт (стилей нет), и это
 *  не мешает: транзишен снаружи, хук лишь ждёт его конца.
 *
 *  Открываем ПЕРЕКЛЮЧЕНИЕМ ПРОПА, как в жизни: провайдеры меню и диалога держат
 *  один смонтированный слой на всё приложение (см. шапку Dialog.test.jsx). */

function Layer({ open }) {
  const { mounted, layerProps } = useLayerState(open);
  if (!mounted) return null;
  return (
    <div data-testid="layer" className="muza-layer" {...layerProps}>
      слой
    </div>
  );
}

/** transitionend руками: конструктора TransitionEvent в jsdom нет, а без него
 *  fireEvent не донесёт propertyName — то самое поле, по которому хук отличает
 *  конец УХОДА от конца любого другого перехода внутри слоя. */
function endTransition(node, propertyName) {
  const e = new Event("transitionend", { bubbles: true });
  e.propertyName = propertyName;
  fireEvent(node, e);
}

describe("useLayerState", () => {
  it("монтирует узел по open и доводит его до открытого состояния", () => {
    const { rerender } = render(<Layer open={false} />);
    expect(screen.queryByTestId("layer")).toBeNull();

    rerender(<Layer open />);
    expect(screen.getByTestId("layer").dataset.layerState).toBe("open");
  });

  it("при закрытии оставляет узел в дереве и переводит его в закрытую позу", () => {
    const { rerender } = render(<Layer open={false} />);
    rerender(<Layer open />);
    rerender(<Layer open={false} />);

    const node = screen.getByTestId("layer");
    expect(node.dataset.layerState).toBe("closed");
    // inert — только на уходе: слой ещё виден, но кликать по нему уже нечего
    expect(node.hasAttribute("inert")).toBe(true);
  });

  it("снимает узел по прозрачности, а не по первому же доехавшему свойству", () => {
    const { rerender } = render(<Layer open={false} />);
    rerender(<Layer open />);
    rerender(<Layer open={false} />);

    const node = screen.getByTestId("layer");
    endTransition(node, "transform");
    expect(screen.queryByTestId("layer")).toBe(node); // поза доехала, слой жив

    endTransition(node, "opacity");
    expect(screen.queryByTestId("layer")).toBeNull();
  });

  it("снимает узел по фолбэк-таймеру, когда transitionend не приходит вовсе", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<Layer open={false} />);
      rerender(<Layer open />);
      rerender(<Layer open={false} />);
      expect(screen.getByTestId("layer")).toBeTruthy();

      // Живой длительности в jsdom не видно — работает слепая константа 400 мс.
      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByTestId("layer")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("повторное открытие посреди ухода возвращает ТОТ ЖЕ узел, без ремаунта", () => {
    const { rerender } = render(<Layer open={false} />);
    rerender(<Layer open />);
    const node = screen.getByTestId("layer");

    rerender(<Layer open={false} />);
    expect(node.dataset.layerState).toBe("closed");

    rerender(<Layer open />);
    // Ремаунт означал бы старт перехода от закрытой позы — то есть телепорт
    // полуоткрытой панели в закрытую, ровно та беда, ради которой хук и завели.
    expect(screen.getByTestId("layer")).toBe(node);
    expect(node.dataset.layerState).toBe("open");
    expect(node.hasAttribute("inert")).toBe(false);
  });
});
