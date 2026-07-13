import { beforeEach, describe, expect, it } from "vitest";
import { resumeStore } from "./resumeStore";
import type { PlayerTrack } from "../player/types";

const track = (id: string): PlayerTrack => ({
  id,
  kind: "catalog",
  title: `Track ${id}`,
  artist: "Artist",
  album: "",
  duration: 200,
  cover: "",
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
