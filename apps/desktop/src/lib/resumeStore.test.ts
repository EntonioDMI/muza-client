import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resumeStore } from "./resumeStore";
import type { PlayerTrack } from "../player/types";

const track = (id: string): PlayerTrack => ({
  id,
  kind: "catalog",
  title: `Track ${id}`,
  artist: "Artist",
  album: "",
  duration: 200,
  cover: "https://i.ytimg.com/vi/x/hqdefault.jpg",
  explicit: false,
  loudness: null,
});

beforeEach(() => {
  localStorage.clear();
});

describe("resumeStore: позиция трека (get/save/clear)", () => {
  it("без сохранений get возвращает 0", () => {
    expect(resumeStore.get("t1")).toBe(0);
  });

  it("save/get круглый трип, clear убирает", () => {
    resumeStore.save("t1", 42.9);
    expect(resumeStore.get("t1")).toBe(42); // Math.floor
    resumeStore.clear("t1");
    expect(resumeStore.get("t1")).toBe(0);
  });
});

describe("resumeStore: последний активный трек (saveLast/getLast) — T2", () => {
  it("без сохранений getLast возвращает null", () => {
    expect(resumeStore.getLast()).toBeNull();
  });

  it("saveLast/getLast круглый трип сохраняет полный трек", () => {
    const t = track("t42");
    resumeStore.saveLast(t);
    expect(resumeStore.getLast()).toEqual(t);
  });

  it("saveLast перезаписывает предыдущий последний трек (не копится история)", () => {
    resumeStore.saveLast(track("t1"));
    resumeStore.saveLast(track("t2"));
    expect(resumeStore.getLast()?.id).toBe("t2");
  });

  it("битый JSON в localStorage — getLast не падает, возвращает null", () => {
    localStorage.setItem("muza.resume.last.v1", "{не json");
    expect(resumeStore.getLast()).toBeNull();
  });

  it("объект без id/kind — getLast отбрасывает как невалидный", () => {
    localStorage.setItem("muza.resume.last.v1", JSON.stringify({ title: "мусор" }));
    expect(resumeStore.getLast()).toBeNull();
  });
});

/** Запись сюда кладёт СТАРЫЙ клиент, а читает НОВЫЙ: localStorage переживает
 *  обновление. Установки v0.1.1 держат тут демо-треки Stage 1 — без отбраковки
 *  макет пережил бы собственное удаление и всплыл бы в плеер-баре у всех, кто
 *  обновится. */
describe("resumeStore: миграция записей старого клиента", () => {
  it("демо-трек v0.1.1 отбрасывается — макет не воскресает после обновления", () => {
    localStorage.setItem(
      "muza.resume.last.v1",
      JSON.stringify({
        id: "t1",
        kind: "demo",
        title: "Кометы над городом",
        artist: "Северный ветер",
        album: "Полночь",
        duration: 212,
        cover: "/assets/cover-1.a1b2c3.png",
        explicit: false,
        loudness: null,
      }),
    );
    expect(resumeStore.getLast()).toBeNull();
  });

  it("неизвестный kind отбрасывается (модель могла уехать вперёд)", () => {
    localStorage.setItem("muza.resume.last.v1", JSON.stringify({ ...track("t9"), kind: "podcast" }));
    expect(resumeStore.getLast()).toBeNull();
  });

  it("запись без обязательных полей отбрасывается", () => {
    localStorage.setItem("muza.resume.last.v1", JSON.stringify({ id: "t9", kind: "catalog" }));
    expect(resumeStore.getLast()).toBeNull();
  });

  it("обложка-путь бандла зануляется: после удаления ассета ссылка мертва", () => {
    localStorage.setItem(
      "muza.resume.last.v1",
      JSON.stringify({ ...track("t9"), cover: "/assets/cover-8.9f8e7d.png" }),
    );
    expect(resumeStore.getLast()?.cover).toBeNull();
  });

  it("обложка с абсолютным URL сохраняется как есть", () => {
    const t = track("t9");
    resumeStore.saveLast(t);
    expect(resumeStore.getLast()?.cover).toBe(t.cover);
  });

  it("локальный трек (kind=local, без обложки) переживает круглый трип", () => {
    const t: PlayerTrack = { ...track("local:abc"), kind: "local", cover: null, localHash: "abc" };
    resumeStore.saveLast(t);
    expect(resumeStore.getLast()).toEqual(t);
  });
});

/** Троттлинг записи (FLUSH_MS) нужен: onTime тикает ~4 Гц, писать в
 *  localStorage на каждый тик нельзя. Но выхода по закрытию окна у него не
 *  было (аудит 2026-08-03) — последний неотправленный интервал терялся, и
 *  «продолжить с места» возвращало человека на несколько секунд назад. */
describe("resumeStore: сброс на диск при уходе страницы", () => {
  const KEY = "muza.resume.v1";
  const stored = (): Record<string, number> => JSON.parse(localStorage.getItem(KEY) ?? "{}");

  beforeEach(() => {
    // Хвост предыдущих кейсов: их save() завёл РЕАЛЬНЫЙ таймер, который
    // фейковым часам уже не подчинится — гасим его честным сбросом ДО подмены.
    window.dispatchEvent(new Event("pagehide"));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("закрытие окна (pagehide) пишет накопленное, не дожидаясь таймера", () => {
    resumeStore.save("rs-close", 42);
    expect(stored()["rs-close"]).toBeUndefined(); // ещё только в памяти — троттлинг

    window.dispatchEvent(new Event("pagehide"));

    expect(stored()["rs-close"]).toBe(42);
  });

  it("окно скрыли — тоже пишем: закрытия WebView может и не случиться", () => {
    resumeStore.save("rs-hide", 77);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });

    document.dispatchEvent(new Event("visibilitychange"));

    expect(stored()["rs-hide"]).toBe(77);
  });

  it("обычный троттленный сброс по таймеру не сломан", () => {
    resumeStore.save("rs-timer", 13);
    expect(stored()["rs-timer"]).toBeUndefined();

    vi.advanceTimersByTime(4_000);

    expect(stored()["rs-timer"]).toBe(13);
  });
});
