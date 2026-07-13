import { describe, expect, it } from "vitest";
import type { GroupedSearchResult, Track } from "@muza/api-client";
import { flattenGroupedResults, GROUP_LIMIT_STEPS, nextGroupLimit, pluralVersions, variantLabel } from "./searchGrouping";

function track(id: string): Track {
  return {
    id,
    artist: `Artist ${id}`,
    title: `Title ${id}`,
    durationSec: 180,
    coverUrl: null,
    isCached: false,
    sources: ["youtube"],
    loudness: null,
    localHash: null,
  };
}

describe("variantLabel (T37)", () => {
  it("отдаёт человеческую подпись для всех 12 типов словаря сервера", () => {
    expect(variantLabel("remix")).toBe("Ремикс");
    expect(variantLabel("sped_up")).toBe("Спидап");
    expect(variantLabel("slowed")).toBe("Замедленная");
    expect(variantLabel("mashup")).toBe("Мэшап");
    expect(variantLabel("cover")).toBe("Кавер");
    expect(variantLabel("live")).toBe("Live");
    expect(variantLabel("acoustic")).toBe("Acoustic");
    expect(variantLabel("instrumental")).toBe("Instrumental");
    expect(variantLabel("karaoke")).toBe("Караоке");
    expect(variantLabel("8d")).toBe("8D Audio");
    expect(variantLabel("bass_boosted")).toBe("Бас-буст");
    expect(variantLabel("tiktok")).toBe("TikTok-версия");
  });

  it("null → null (canonicalVariantType у обычной группы с оригиналом)", () => {
    expect(variantLabel(null)).toBeNull();
  });
});

describe("pluralVersions (T37)", () => {
  it("1 → версия, 2-4 → версии, 5-20 → версий (включая 11-14 исключение)", () => {
    expect(pluralVersions(1)).toBe("версия");
    expect(pluralVersions(21)).toBe("версия");
    expect(pluralVersions(2)).toBe("версии");
    expect(pluralVersions(3)).toBe("версии");
    expect(pluralVersions(4)).toBe("версии");
    expect(pluralVersions(5)).toBe("версий");
    expect(pluralVersions(11)).toBe("версий");
    expect(pluralVersions(12)).toBe("версий");
    expect(pluralVersions(14)).toBe("версий");
    expect(pluralVersions(0)).toBe("версий");
  });
});

describe("flattenGroupedResults (T37)", () => {
  it("single — один трек в порядке следования", () => {
    const results: GroupedSearchResult[] = [{ kind: "single", track: track("s1") }];
    expect(flattenGroupedResults(results).map((t) => t.id)).toEqual(["s1"]);
  });

  it("group — канон, затем варианты в их порядке", () => {
    const results: GroupedSearchResult[] = [
      {
        kind: "group",
        canonical: track("canon"),
        hasOriginal: true,
        canonicalVariantType: null,
        variants: [
          { track: track("v1"), variantType: "remix" },
          { track: track("v2"), variantType: "sped_up" },
        ],
      },
    ];
    expect(flattenGroupedResults(results).map((t) => t.id)).toEqual(["canon", "v1", "v2"]);
  });

  it("смешанная выдача (группы + singles) — общий порядок карточек сохраняется", () => {
    const results: GroupedSearchResult[] = [
      { kind: "single", track: track("s1") },
      {
        kind: "group",
        canonical: track("canon"),
        hasOriginal: true,
        canonicalVariantType: null,
        variants: [{ track: track("v1"), variantType: "remix" }],
      },
      { kind: "single", track: track("s2") },
    ];
    expect(flattenGroupedResults(results).map((t) => t.id)).toEqual(["s1", "canon", "v1", "s2"]);
  });

  it("пустая выдача → пустой список", () => {
    expect(flattenGroupedResults([])).toEqual([]);
  });
});

describe("nextGroupLimit / GROUP_LIMIT_STEPS (T37 — «Загрузить ещё» в grouped-режиме)", () => {
  it("лестница — 30 → 60 → 90, как лимиты сервера (SearchQueryDto: min 10, max 90)", () => {
    expect(GROUP_LIMIT_STEPS).toEqual([30, 60, 90]);
  });

  it("30 → 60, 60 → 90", () => {
    expect(nextGroupLimit(30)).toBe(60);
    expect(nextGroupLimit(60)).toBe(90);
  });

  it("90 → null (максимум сервера — дальше расти некуда, кнопка прячется)", () => {
    expect(nextGroupLimit(90)).toBeNull();
  });

  it("значение вне лестницы → null (защита от рассинхрона состояния)", () => {
    expect(nextGroupLimit(45)).toBeNull();
  });
});
