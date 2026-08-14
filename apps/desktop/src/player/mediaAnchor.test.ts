/** Сторож механизма, а не симптома (регрессия 10.08 → 14.08).
 *
 *  Симптом «медиаклавиша не работает» из jsdom не виден вовсе: системную
 *  сессию заводит Windows, а не мы. Проверять надо ровно то ОДНО условие, из-за
 *  которого сессии не стало: пока трек играет, в документе обязан быть живой,
 *  НЕ заглушённый медиаэлемент. Отсюда и набор проверок — свойства элемента
 *  (тишина в сэмплах, а не в `muted`/`volume`) и жизненный цикл (пауза сессию
 *  сохраняет, конец трека — отпускает).
 *
 *  Замер, доказывающий связь этих свойств с реальной сессией Windows, — в
 *  шапке mediaAnchor.ts; повторить его тестом нельзя, поэтому он записан
 *  числами там. */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createMediaAnchor, silentWavBytes, silentWavUrl } from "./mediaAnchor";

let play: MockInstance<() => Promise<void>>;
let pause: MockInstance<() => void>;

beforeEach(() => {
  // jsdom не умеет создавать blob-ссылки — подменяем. Сам факт «источник
  // blob:, а не data:» проверяется отдельным тестом ниже: в CSP приложения у
  // media-src разрешён только blob.
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:muza/тишина");
  // jsdom объявляет play/pause «не реализовано» и роняет тест. Подменяем их,
  // но так, чтобы `paused` вёл себя как в браузере: на нём стоит вся логика
  // «уже держим — второй раз не дёргаем».
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLAudioElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    return Promise.resolve();
  });
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLAudioElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("якорь медиасессии", () => {
  it("hold() заводит играющий элемент — без него системной сессии не бывает", () => {
    const anchor = createMediaAnchor();
    expect(anchor.element).toBeNull();

    anchor.hold();

    expect(anchor.element).not.toBeNull();
    expect(play).toHaveBeenCalledTimes(1);
    expect(anchor.element?.paused).toBe(false);
  });

  it("элемент зациклен и НЕ заглушён: беззвучный по флагам audio focus не получает", () => {
    const anchor = createMediaAnchor();
    anchor.hold();

    expect(anchor.element?.loop).toBe(true);
    expect(anchor.element?.muted).toBe(false);
    expect(anchor.element?.volume).toBe(1);
  });

  it("повторный hold() не дёргает play() — иначе рендер плеера (4 раза в секунду) бил бы по элементу", () => {
    const anchor = createMediaAnchor();
    anchor.hold();
    anchor.hold();
    anchor.hold();

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("suspend() ставит на паузу, но элемент ЖИВ: система должна оставить карточку с кнопкой «play»", () => {
    const anchor = createMediaAnchor();
    anchor.hold();

    anchor.suspend();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(anchor.element).not.toBeNull();
    expect(anchor.element?.getAttribute("src")).toBe("blob:muza/тишина");
  });

  it("hold() после suspend() снова запускает — «play» с клавиатуры обязан возвращать звук", () => {
    const anchor = createMediaAnchor();
    anchor.hold();
    anchor.suspend();

    anchor.hold();

    expect(play).toHaveBeenCalledTimes(2);
  });

  it("suspend() без единого воспроизведения элемент не создаёт — не отбираем клавиши у чужого плеера просто так", () => {
    const anchor = createMediaAnchor();

    anchor.suspend();

    expect(anchor.element).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("release() отпускает сессию: пауза + пустой src (рекомендованный способ убрать карточку)", () => {
    const anchor = createMediaAnchor();
    anchor.hold();
    const el = anchor.element;

    anchor.release();

    expect(pause).toHaveBeenCalled();
    expect(el?.getAttribute("src")).toBe("");
    expect(anchor.element).toBeNull();
  });

  it("release() без якоря — не падает", () => {
    expect(() => createMediaAnchor().release()).not.toThrow();
  });

  it("отказ автозапуска не роняет приложение — плеер играет, просто без системных клавиш", async () => {
    play.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    const anchor = createMediaAnchor();

    expect(() => anchor.hold()).not.toThrow();
    await Promise.resolve();
  });
});

describe("тишина для якоря", () => {
  it("это WAV длиной 5 секунд: короче — хромиум даёт «ducking» вместо полного фокуса", () => {
    const bytes = silentWavBytes();
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe("WAVE");
    const channels = view.getUint16(22, true);
    const rate = view.getUint32(24, true);
    const bits = view.getUint16(34, true);
    const dataSize = view.getUint32(40, true);
    expect(dataSize / (rate * channels * (bits / 8))).toBe(5);
  });

  it("тишина лежит в САМИХ сэмплах (в 8-битном PCM это 128, а не 0)", () => {
    expect(silentWavBytes(1).subarray(44).every((b) => b === 128)).toBe(true);
  });

  it("источник — blob:, а не data:: в CSP приложения media-src разрешает только blob", () => {
    const blobCtor = vi.spyOn(URL, "createObjectURL");

    const url = silentWavUrl(1);

    expect(url.startsWith("blob:")).toBe(true);
    expect(blobCtor.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect((blobCtor.mock.calls[0]?.[0] as Blob).type).toBe("audio/wav");
  });
});
