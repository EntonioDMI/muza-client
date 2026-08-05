/** Память плеера между запусками (жалоба владельца 05.08: «не сохраняется
 *  громкость и некоторые другие элементы»).
 *
 *  Два места, где ошибка здесь стоит дорого. Первое — ЧТЕНИЕ: значение из
 *  ключа уезжает прямо в движок звука, и `speed: null` или `repeat: "loud"`
 *  ломают воспроизведение молча, без единого сообщения. Второе — ЗАПИСЬ: она
 *  идёт с частотой движения мыши по слайдеру, и потерянная склейка означает
 *  60–120 записей в секунду, то есть ровно ту жалобу на производительность,
 *  ради которой в durableState заводили окно склейки. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYER_STATE, loadPlayerState, PLAYER_STATE_KEY, savePlayerState } from "./playerState";
import type { RepeatMode } from "../prefs/types";

/** Окно склейки записи (COALESCE_MS в playerState.ts). Числом, а не импортом:
 *  тест обязан краснеть, если окно молча раздвинут. */
const COALESCE_MS = 250;

const stored = (): Record<string, unknown> | null => {
  const raw = localStorage.getItem(PLAYER_STATE_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  // Сбрасывает память модуля на дефолты: она живёт на уровне модуля и иначе
  // переезжала бы из теста в тест.
  loadPlayerState();
});

afterEach(() => {
  // Отложенную запись гасим честным уходом окна: живой таймер прошлого теста
  // писал бы в хранилище посреди следующего.
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  localStorage.clear();
});

describe("loadPlayerState", () => {
  it("пустое хранилище → дефолты (те же, с которых плеер стартовал раньше)", () => {
    expect(loadPlayerState()).toEqual(DEFAULT_PLAYER_STATE);
  });

  it("битый JSON не роняет запуск", () => {
    localStorage.setItem(PLAYER_STATE_KEY, "{не json");
    expect(loadPlayerState()).toEqual(DEFAULT_PLAYER_STATE);
  });

  it("не-объект в ключе (массив, строка, null) — тоже дефолты", () => {
    for (const raw of ["[1,2,3]", '"64"', "null"]) {
      localStorage.setItem(PLAYER_STATE_KEY, raw);
      expect(loadPlayerState()).toEqual(DEFAULT_PLAYER_STATE);
    }
  });

  it("значение чужого вида не проезжает: поле берёт дефолт", () => {
    localStorage.setItem(
      PLAYER_STATE_KEY,
      JSON.stringify({ volume: "громко", muted: 1, shuffle: "да", speed: null, repeat: "loud" }),
    );
    expect(loadPlayerState()).toEqual(DEFAULT_PLAYER_STATE);
  });

  it("числа клампятся по границам: 500 → 100, −20 → 0", () => {
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({ volume: 500, volumeBeforeMute: -20, speed: 99 }));
    const s = loadPlayerState();
    expect(s.volume).toBe(100);
    expect(s.volumeBeforeMute).toBe(0);
    expect(s.speed).toBe(4);
  });

  it("режим повтора — только три известные строки", () => {
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({ repeat: "one" }));
    expect(loadPlayerState().repeat).toBe("one");
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({ repeat: "ONE" }));
    expect(loadPlayerState().repeat).toBe("off");
  });

  it("сохранённое возвращается целиком", () => {
    savePlayerState({ volume: 12, volumeBeforeMute: 77, muted: true, shuffle: true, repeat: "all", speed: 1.5 });
    window.dispatchEvent(new Event("pagehide"));
    expect(loadPlayerState()).toEqual({
      volume: 12,
      volumeBeforeMute: 77,
      muted: true,
      shuffle: true,
      repeat: "all",
      speed: 1.5,
    });
  });
});

describe("savePlayerState", () => {
  it("сто движений слайдера склеиваются в ОДНУ запись, и это свежайшее значение", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    for (let i = 0; i < 100; i++) savePlayerState({ volume: i });
    // Окно ещё открыто — на диск не ушло ничего.
    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(COALESCE_MS);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(stored()?.volume).toBe(99);
    setItem.mockRestore();
  });

  it("окно склейки — не debounce: непрерывная протяжка всё равно доезжает", () => {
    // Движения идут чаще, чем окно: при debounce таймер перезапускался бы
    // каждый раз и не сработал бы НИ РАЗУ до конца протяжки.
    for (let i = 0; i < 10; i++) {
      savePlayerState({ volume: i });
      vi.advanceTimersByTime(COALESCE_MS - 50);
    }
    expect(stored()?.volume).toBeTypeOf("number");
  });

  it("уход окна (pagehide) дописывает не дожидаясь таймера", () => {
    savePlayerState({ volume: 30 });
    expect(localStorage.getItem(PLAYER_STATE_KEY)).toBeNull(); // ещё только в памяти

    window.dispatchEvent(new Event("pagehide"));

    expect(stored()?.volume).toBe(30);
  });

  it("окно скрыли — тоже пишем: закрытия WebView может и не случиться", () => {
    savePlayerState({ shuffle: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });

    document.dispatchEvent(new Event("visibilitychange"));

    expect(stored()?.shuffle).toBe(true);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("незнакомые поля хранилища переживают запись (инвариант площадок)", () => {
    // Клиент другой версии положил сюда своё поле. Запись «только своими»
    // стирала бы его при каждом заходе с другой площадки.
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({ volume: 20, sleepUntil: 7 }));
    loadPlayerState();

    savePlayerState({ volume: 55 });
    window.dispatchEvent(new Event("pagehide"));

    expect(stored()).toEqual({ ...DEFAULT_PLAYER_STATE, volume: 55, sleepUntil: 7 });
  });

  it("мусор в patch не портит память: значение остаётся прежним", () => {
    savePlayerState({ volume: 40, repeat: "all" });
    savePlayerState({ volume: Number.NaN, repeat: "loud" as RepeatMode, speed: "быстро" as unknown as number });
    window.dispatchEvent(new Event("pagehide"));
    const s = loadPlayerState();
    expect(s.volume).toBe(40);
    expect(s.repeat).toBe("all");
    expect(s.speed).toBe(DEFAULT_PLAYER_STATE.speed);
  });
});
