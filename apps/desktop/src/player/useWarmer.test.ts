/** Карта пропсов строк прогрева (useWarmer.warmRow) — аудит 2026-08-03.
 *
 *  Записи в ней нужны ради СТАБИЛЬНОСТИ ссылок: у каждой строки трека свои
 *  ref/onMouseEnter/onPointerDown, и если отдавать новые объекты на каждый
 *  рендер, React передёргивал бы наблюдение IntersectionObserver у всего
 *  списка. Но клались они на КАЖДЫЙ когда-либо отрендеренный id и не убирались
 *  никогда — за долгую сессию прокрутки поиска и медиатеки это тысячи записей
 *  по три замыкания в каждой. Тесты держат оба края: стабильность живой строки
 *  и потолок карты.
 *
 *  Стенд: сам прогрев не запускается (заявки подают только обработчики), а
 *  IntersectionObserver в jsdom отсутствует — заглушка-пустышка. */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzaApi } from "@muza/api-client";
import { DEFAULT_PREFS } from "../types";
import { useWarmer } from "./useWarmer";

vi.mock("../lib/engine", () => ({
  engineAvailable: () => true,
  engineWarm: vi.fn(async () => ({ cached: true })),
}));

/** Движок аудио мокается целиком: здесь проверяется, что сигнал предгрева
 *  ПОДАЁТСЯ, а что он строит — дело audioEngine.test.ts. */
const { noteUserGesture } = vi.hoisted(() => ({ noteUserGesture: vi.fn() }));
vi.mock("./audioEngine", () => ({ noteUserGesture }));

const api = { getTrackSources: vi.fn(async () => []) } as unknown as MuzaApi;

beforeEach(() => {
  noteUserGesture.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const mount = () => renderHook(() => useWarmer({ api, prefs: DEFAULT_PREFS }));

describe("useWarmer: пропсы строк", () => {
  it("один и тот же id отдаёт ОДИН и тот же объект пропсов", () => {
    const { result } = mount();

    expect(result.current.warmRow("t1")).toBe(result.current.warmRow("t1"));
  });

  it("карта не растёт без границ: давно не показывавшиеся строки вытесняются", () => {
    const { result } = mount();
    const first = result.current.warmRow("t1");

    // Прокрутка длинной сессии: сотни треков поиска и медиатеки, ни один из
    // них не виден сейчас (ref никто не привязывал).
    for (let i = 0; i < 600; i++) result.current.warmRow(`scroll-${i}`);

    expect(result.current.warmRow("t1")).not.toBe(first);
  });

  it("недавние строки вытеснение не задевает — стабильность там, где она нужна", () => {
    const { result } = mount();
    for (let i = 0; i < 600; i++) result.current.warmRow(`scroll-${i}`);

    const recent = result.current.warmRow("scroll-599");

    expect(result.current.warmRow("scroll-599")).toBe(recent);
  });
});

/** Сигнал предгрева графа Web Audio (2026-08-06). Строка трека — самый ценный
 *  жест (за ним почти наверняка клик), но не единственный путь к звуку: кнопка
 *  play в баре, клик по обложке, восстановленный трек — всё это мимо warmRow.
 *  Держим оба конца: строку и страховку на окне. */
describe("useWarmer: предгрев графа по первому жесту", () => {
  it("pointerdown по строке подаёт сигнал предгрева", () => {
    const { result } = mount();

    result.current.warmRow("t1").onPointerDown();

    expect(noteUserGesture).toHaveBeenCalled();
  });

  it("страховка: первый pointerdown где угодно в окне тоже подаёт сигнал", () => {
    mount();

    window.dispatchEvent(new Event("pointerdown"));

    expect(noteUserGesture).toHaveBeenCalled();
  });
});
