/** Панель очереди — общая для приложения и веба (Э3 веб-паритета).
 *
 *  Главное, что тут защищается, — СЧЁТЧИК ВЫДЕЛЕНИЯ. В меню уходит каталожная
 *  форма списка, а файлы с диска в неё не превращаются: список короче
 *  реального выделения. Поэтому рядом едет `count` с полным числом. Без него
 *  в меню стояло «Выбрано: 2», а убиралось 3 (разбор 2026-08-02) — тест
 *  воспроизводит ровно эту расстановку: два каталожных трека и один с диска.
 *
 *  Второе — правило «умение = наличие обработчика»: веб пока не умеет править
 *  очередь, и кнопок правки у него нет вовсе, а панель работает.
 *
 *  Без LanguageProvider язык = DEFAULT_LANG ("en"). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Track } from "@muza/api-client";
import { DEFAULT_LANG, translate } from "../i18n";
import { QueuePanel, type QueueSelectionTarget } from "./QueuePanel";

afterEach(cleanup);

const noop = () => undefined;

/** Трек очереди. local=true — файл с диска: каталожной формы у него нет. */
interface Row {
  id: string;
  title: string;
  artist: string;
  cover: string | null;
  duration: number;
  local?: boolean;
}

const rows: Row[] = [
  { id: "a", title: "Alpha", artist: "A", cover: null, duration: 100 },
  { id: "b", title: "Beta", artist: "A", cover: null, duration: 100 },
  { id: "c", title: "Gamma", artist: "A", cover: null, duration: 100, local: true },
];

const toCatalog = (r: Row): Track | null =>
  r.local
    ? null
    : ({
        id: r.id,
        artist: r.artist,
        title: r.title,
        album: null,
        durationSec: r.duration,
        coverUrl: null,
        isCached: false,
        sources: [],
        loudness: null,
        localHash: null,
      } as Track);

const menuCtx = { addManyToPlaylist: vi.fn(), likeMany: vi.fn() };

function renderPanel(over: Partial<React.ComponentProps<typeof QueuePanel<Row>>> = {}) {
  const openMenu = vi.fn();
  const utils = render(
    <QueuePanel<Row>
      open
      tracks={rows}
      currentIndex={0}
      playing={false}
      canSave={false}
      onPlayTrack={noop}
      onClose={noop}
      menu={{ openMenu, ctx: { current: menuCtx } }}
      toCatalog={toCatalog}
      {...over}
    />,
  );
  return { ...utils, openMenu };
}

/** Ctrl+клик по названию: событие всплывает до строки, где висит перехват. */
const ctrlClick = (title: string) => fireEvent.click(screen.getByText(title), { ctrlKey: true });

describe("панель очереди", () => {
  it("счётчик выделения — полное число, даже когда каталожная форма короче", () => {
    const { openMenu } = renderPanel({ onRemoveMany: noop });
    ctrlClick("Alpha");
    ctrlClick("Beta");
    ctrlClick("Gamma"); // файл с диска: в каталожный список не попадёт

    fireEvent.contextMenu(screen.getByText("Beta"));

    expect(openMenu).toHaveBeenCalledTimes(1);
    const target = openMenu.mock.calls[0][1] as QueueSelectionTarget;
    expect(target.count).toBe(3); // ← выделено на самом деле
    expect(target.tracks.length).toBe(2); // ← а в меню уехало только каталожное
    expect(target.place).toBe("queue");
  });

  it("«убрать из очереди» работает по ПОЛНОМУ набору выделенного", () => {
    const onRemoveMany = vi.fn();
    const { openMenu } = renderPanel({ onRemoveMany });
    ctrlClick("Alpha");
    ctrlClick("Gamma");
    fireEvent.contextMenu(screen.getByText("Alpha"));

    const target = openMenu.mock.calls[0][1] as QueueSelectionTarget;
    target.ctl.remove?.run();
    expect(onRemoveMany).toHaveBeenCalledWith(["a", "c"]);
  });

  it("ПКМ по невыделенной строке — обычное меню строки, выделение сбрасывается", () => {
    const onRowMenu = vi.fn();
    const { openMenu } = renderPanel({ onRowMenu });
    ctrlClick("Alpha");
    fireEvent.contextMenu(screen.getByText("Beta"));

    expect(openMenu).not.toHaveBeenCalled();
    expect(onRowMenu).toHaveBeenCalledTimes(1);
    expect(onRowMenu.mock.calls[0][0].id).toBe("b");
    expect(onRowMenu.mock.calls[0][1]).toBe(1); // абсолютный индекс в очереди
  });

  it("площадка без контекстного меню: ПКМ не роняет панель и не открывает меню", () => {
    renderPanel({ menu: undefined, toCatalog: undefined });
    ctrlClick("Alpha");
    expect(() => fireEvent.contextMenu(screen.getByText("Alpha"))).not.toThrow();
    // панель массовых действий осталась, но без пунктов, которых площадка не умеет
    expect(screen.queryByLabelText(translate(DEFAULT_LANG, "menu.addToPlaylist"))).toBeNull();
  });

  it("веб не умеет править очередь — крестика и стрелок нет, время на месте", () => {
    const { container } = renderPanel({ onRemove: undefined, onMove: undefined });
    const current = container.querySelector("[data-queue-current]") as HTMLElement;
    fireEvent.mouseEnter(current);
    expect(screen.queryByLabelText(translate(DEFAULT_LANG, "dialogs.queue.remove"))).toBeNull();
    expect(screen.queryAllByText("1:40").length).toBe(rows.length);
  });

  it("приложение умеет: при наведении на строку появляется «убрать»", () => {
    const { container } = renderPanel({ onRemove: noop, onMove: noop });
    const current = container.querySelector("[data-queue-current]") as HTMLElement;
    fireEvent.mouseEnter(current);
    expect(screen.queryByLabelText(translate(DEFAULT_LANG, "dialogs.queue.remove"))).not.toBeNull();
  });

  it("неоткрытой панели в DOM нет вовсе — Tab не попадает в невидимые кнопки", () => {
    const { container } = renderPanel({ open: false });
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });
});

/** УХОД ПАНЕЛИ (2026-08-05). Раньше `if (!open) return null` снимал узел кадром,
 *  и этот же возврат бесплатно чинил две вещи: панель уходила из обхода Tab и
 *  переставала ловить клики. Теперь узел живёт ещё ~180 мс, и обе вещи обязаны
 *  выключаться явно — иначе уходящая панель полсекунды ест клики по плеер-бару
 *  под собой. Анимации в jsdom нет (стилей пакета тут не подключено), проверяем
 *  ровно то, чем управляет компонент: атрибуты, свойства и момент снятия. */
describe("панель очереди — уход", () => {
  const endTransition = (node: Element, propertyName: string) =>
    fireEvent(node, Object.assign(new Event("transitionend", { bubbles: true }), { propertyName }));

  const down = (el: Element) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

  function renderToggling(onClose: () => void = noop) {
    const view = (open: boolean) => (
      <QueuePanel<Row>
        open={open}
        tracks={rows}
        currentIndex={0}
        playing={false}
        canSave={false}
        onPlayTrack={noop}
        onClose={onClose}
        toCatalog={toCatalog}
      />
    );
    const utils = render(view(true));
    return { ...utils, set: (open: boolean) => utils.rerender(view(open)) };
  }

  const panel = () => screen.queryByRole("dialog");

  it("закрытие оставляет узел в дереве: закрытая поза, inert, клики насквозь", () => {
    const { set } = renderToggling();
    const node = panel() as HTMLElement;
    set(false);

    expect(panel()).toBe(node); // тот же узел — переход прерываем, ремаунта нет
    expect(node.dataset.layerState).toBe("closed");
    expect(node.hasAttribute("inert")).toBe(true); // вне Tab и вне хит-теста
    expect(node.style.pointerEvents).toBe("none"); // клик уходит к тому, что под ней
  });

  it("узел снимается по концу прозрачности, а не сразу", () => {
    const { set } = renderToggling();
    const node = panel() as HTMLElement;
    set(false);

    endTransition(node, "transform");
    expect(panel()).toBe(node); // поза доехала, панель ещё гаснет
    endTransition(node, "opacity");
    expect(panel()).toBeNull();
  });

  it("клик мимо во время ухода не закрывает второй раз — слушатель снят вместе с open", () => {
    const onClose = vi.fn();
    const { set } = renderToggling(onClose);
    down(document.body);
    expect(onClose).toHaveBeenCalledTimes(1); // пока открыта — закрывает

    set(false);
    down(document.body);
    expect(onClose).toHaveBeenCalledTimes(1); // уходящая панель клик не трогает
  });

  it("открытие после закрытого старта уводит фокус в панель", () => {
    // Узел появляется НЕ на том коммите, где сменился open (слою нужен кадр
    // «до»): эффект фокуса обязан дождаться самого узла, иначе открытие
    // остаётся без фокуса и Esc из вызывателя перестаёт работать.
    const { set } = renderToggling();
    set(false);
    endTransition(panel() as HTMLElement, "opacity");
    expect(panel()).toBeNull();

    set(true);
    expect(document.activeElement).toBe(panel());
  });
});
