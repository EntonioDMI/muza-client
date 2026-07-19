/** Движок: граница «звук не завёлся» (аудит 2026-07-17, «повтор трека больше
 *  никогда не останавливается сам»). Прежний контракт молча глотал отказ
 *  el.play(): resume() — совсем без следа (рестарт repeat-one умирал тишиной
 *  под «играющим» баром), play() — тостом без проброса (startAt считал старт
 *  успешным, и авто-скип мёртвых треков с фикса 2026-07-16 не запускался).
 *  Тесты держат контракт: play() пробрасывает отказ вызывающему (тостом и
 *  восстановлением владеет usePlayback), resume() честно отвечает true/false.
 *
 *  Стенд: plain-режим (CORS-проба падает → граф Web Audio не строится) —
 *  jsdom без AudioContext; play/pause/load стабятся на прототипе. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audioEngine";

const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");
const loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load");

let onError: ReturnType<typeof vi.fn<(message: string) => void>>;

const makeEngine = () => {
  onError = vi.fn<(message: string) => void>();
  return new AudioEngine({ onTime: () => {}, onEnded: () => {}, onError });
};

beforeEach(() => {
  // CORS-проба ensureGraph падает → plain-режим (jsdom не умеет AudioContext)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("нет CORS в стенде");
    }),
  );
  // шпионы живут на прототипе и переживают тесты — историю вызовов чистим
  playSpy.mockClear().mockResolvedValue(undefined);
  pauseSpy.mockClear().mockImplementation(() => {});
  loadSpy.mockClear().mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  // слоты вешаются в document.body — прибираем, чтобы нумерация data-muza-slot
  // и события не переживали соседние тесты
  document.querySelectorAll("audio[data-muza-slot]").forEach((el) => el.remove());
});

describe("AudioEngine: отказ старта звука не глотается", () => {
  it("play(): отказ el.play() пробрасывается вызывающему, тост не дублируется", async () => {
    const engine = makeEngine();
    playSpy.mockRejectedValueOnce(new Error("NotSupportedError: источник мёртв"));

    await expect(engine.play("asset://localhost/dead.webm", 1, 0)).rejects.toThrow(/источник мёртв/);
    // Ошибкой владеет вызывающий (startAt: авто-скип/честный стоп) — движок
    // не показывает второй тост поверх его.
    expect(onError).not.toHaveBeenCalled();
  });

  it("resume(): звук реально завёлся → true", async () => {
    const engine = makeEngine();
    await engine.play("asset://localhost/a.webm", 1, 0);

    await expect(engine.resume()).resolves.toBe(true);
  });

  it("resume(): элемент отказал → false, без исключения и без тоста", async () => {
    const engine = makeEngine();
    await engine.play("asset://localhost/a.webm", 1, 0);
    playSpy.mockRejectedValueOnce(new Error("файл выпал из кэша"));

    await expect(engine.resume()).resolves.toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("resume(): пустой слот (нечего возобновлять) → false", async () => {
    const engine = makeEngine();

    await expect(engine.resume()).resolves.toBe(false);
    expect(playSpy).not.toHaveBeenCalled();
  });
});
