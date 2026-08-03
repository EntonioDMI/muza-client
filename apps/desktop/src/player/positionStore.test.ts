/** Хранилище позиции: договор двух подписок.
 *
 *  Смысл разделения — в шапке positionStore.ts: точное значение доступно
 *  всегда, а «раз в секунду» бывает только у ПОДПИСКИ, и только там, где
 *  потребитель и сам округляет (системный медиа-оверлей, мини-плеер, событие
 *  плагинам). Здесь сторожим границу: секундная подписка не имеет права
 *  пропустить смену целой секунды (иначе часы мини-плеера встанут) и не имеет
 *  права будить чаще (иначе экономии нет вовсе). */

import { describe, expect, it, vi } from "vitest";
import { createPositionStore } from "./positionStore";

describe("positionStore", () => {
  it("get() отдаёт точное значение, getSecond() — целые секунды", () => {
    const store = createPositionStore(3.75);
    expect(store.get()).toBe(3.75);
    expect(store.getSecond()).toBe(3);

    store.set(12.5);
    expect(store.get()).toBe(12.5);
    expect(store.getSecond()).toBe(12);
  });

  it("тиковая подписка — на каждое изменение, секундная — только на смену секунды", () => {
    const store = createPositionStore(12);
    const ticks = vi.fn();
    const seconds = vi.fn();
    store.subscribe(ticks);
    store.subscribeSecond(seconds);

    store.set(12.25);
    store.set(12.5);
    store.set(12.75);
    expect(ticks).toHaveBeenCalledTimes(3);
    expect(seconds).not.toHaveBeenCalled();

    store.set(13);
    expect(ticks).toHaveBeenCalledTimes(4);
    expect(seconds).toHaveBeenCalledTimes(1);
  });

  it("прыжок назад (сик к началу) — тоже смена секунды", () => {
    const store = createPositionStore(120);
    const seconds = vi.fn();
    store.subscribeSecond(seconds);

    store.set(0);

    expect(seconds).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(0);
  });

  it("тот же timeupdate дважды (пауза) никого не будит", () => {
    const store = createPositionStore(0);
    const ticks = vi.fn();
    store.subscribe(ticks);

    store.set(9.5);
    store.set(9.5);
    store.set(9.5);

    expect(ticks).toHaveBeenCalledTimes(1);
  });

  it("отписка снимает потребителя", () => {
    const store = createPositionStore(0);
    const ticks = vi.fn();
    const off = store.subscribe(ticks);

    store.set(1);
    off();
    store.set(2);

    expect(ticks).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(2); // значение живёт независимо от подписчиков
  });
});
