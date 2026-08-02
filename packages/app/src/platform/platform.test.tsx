/** Розетка платформы: проверяем ГЛАВНОЕ обещание — общий код, написанный
 *  один раз, живёт и там, где умение есть, и там, где его нет, БЕЗ развилок
 *  «а мы сейчас в браузере?». Поэтому каждый тест прогоняется в двух мирах:
 *  вилка с портом (приложение) и вилка без порта (браузер). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { PlatformProvider, useAltFileDrag, usePlatform, type PlatformAdapter } from "./index";

// Авто-очистки нет (vitest globals в пакете выключены) — иначе строки
// предыдущих тестов остаются в документе и getByTestId находит их пачкой.
afterEach(cleanup);

/** Мини-строка списка: ровно тот вызов, который делают экраны. */
function Row({ onError = () => {} }: { onError?: (m: string) => void }) {
  const altFileDrag = useAltFileDrag();
  return (
    <div
      data-testid="row"
      onDragStart={(e) => {
        if (altFileDrag(e, (d) => d.exportTrackFile({ id: "42", artist: "A", title: "T" }), onError)) return;
        // Ветка «умения нет»: гасим системное перетаскивание сами — иначе оно
        // убило бы внутренний перенос через pointercancel.
        e.preventDefault();
      }}
    />
  );
}

function dragStart(alt: boolean) {
  const node = screen.getByTestId("row");
  // jsdom не умеет DragEvent — синтезируем: React читает altKey и
  // defaultPrevented с самого события.
  const ev = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "altKey", { value: alt });
  node.dispatchEvent(ev);
  return ev;
}

function withDragOut(exportTrackFile: () => Promise<string>) {
  const startFileDrag = vi.fn(async () => {});
  const adapter: PlatformAdapter = { dragOut: { exportTrackFile, startFileDrag } };
  return { adapter, startFileDrag };
}

describe("розетка платформы", () => {
  it("без вилки не умеет ничего (и не падает)", () => {
    function Probe() {
      const platform = usePlatform();
      return <span data-testid="probe">{platform.dragOut ? "есть" : "нет"}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("нет");
  });

  it("умение есть: Alt+перетаскивание готовит файл и отдаёт его системе", async () => {
    const { adapter, startFileDrag } = withDragOut(async () => "C:/tmp/A - T.mp3");
    render(
      <PlatformProvider adapter={adapter}>
        <Row />
      </PlatformProvider>,
    );
    const ev = dragStart(true);
    // Системное перетаскивание страницы отменено — вместо него пойдёт файл
    expect(ev.defaultPrevented).toBe(true);
    await waitFor(() => expect(startFileDrag).toHaveBeenCalledWith("C:/tmp/A - T.mp3"));
  });

  it("умения нет (браузер): перетаскивание файла не начинается, ошибок нет", () => {
    const onError = vi.fn();
    render(
      <PlatformProvider adapter={{}}>
        <Row onError={onError} />
      </PlatformProvider>,
    );
    dragStart(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("без Alt порт не трогается вовсе — это обычный перенос в плейлист", () => {
    const exportTrackFile = vi.fn(async () => "C:/tmp/A - T.mp3");
    const { adapter } = withDragOut(exportTrackFile);
    render(
      <PlatformProvider adapter={adapter}>
        <Row />
      </PlatformProvider>,
    );
    dragStart(false);
    expect(exportTrackFile).not.toHaveBeenCalled();
  });

  it("файл не подготовился — человеческое сообщение уходит вызывающему", async () => {
    const onError = vi.fn();
    const { adapter, startFileDrag } = withDragOut(async () => {
      throw new Error("Трека нет на устройстве");
    });
    render(
      <PlatformProvider adapter={adapter}>
        <Row onError={onError} />
      </PlatformProvider>,
    );
    dragStart(true);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Трека нет на устройстве"));
    expect(startFileDrag).not.toHaveBeenCalled();
  });
});
