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

  it("закрытая панель не живёт в DOM — Tab не попадает в невидимые кнопки", () => {
    const { container } = renderPanel({ open: false });
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });
});
