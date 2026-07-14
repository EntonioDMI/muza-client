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

describe("variantLabel (T37, i18n T-media)", () => {
  it("EN (дефолт, без lang) — человеческая подпись для всех 12 типов словаря сервера", () => {
    expect(variantLabel("remix")).toBe("Remix");
    expect(variantLabel("sped_up")).toBe("Sped up");
    expect(variantLabel("slowed")).toBe("Slowed");
    expect(variantLabel("mashup")).toBe("Mashup");
    expect(variantLabel("cover")).toBe("Cover");
    expect(variantLabel("live")).toBe("Live");
    expect(variantLabel("acoustic")).toBe("Acoustic");
    expect(variantLabel("instrumental")).toBe("Instrumental");
    expect(variantLabel("karaoke")).toBe("Karaoke");
    expect(variantLabel("8d")).toBe("8D Audio");
    expect(variantLabel("bass_boosted")).toBe("Bass boosted");
    expect(variantLabel("tiktok")).toBe("TikTok version");
  });

  it("RU (lang явно) — те же 12 типов", () => {
    expect(variantLabel("remix", "ru")).toBe("Ремикс");
    expect(variantLabel("sped_up", "ru")).toBe("Спидап");
    expect(variantLabel("slowed", "ru")).toBe("Замедленная");
    expect(variantLabel("mashup", "ru")).toBe("Мэшап");
    expect(variantLabel("cover", "ru")).toBe("Кавер");
    expect(variantLabel("karaoke", "ru")).toBe("Караоке");
    expect(variantLabel("bass_boosted", "ru")).toBe("Бас-буст");
    expect(variantLabel("tiktok", "ru")).toBe("TikTok-версия");
  });

  it("null → null (canonicalVariantType у обычной группы с оригиналом)", () => {
    expect(variantLabel(null)).toBeNull();
  });
});

describe("pluralVersions (T37, i18n T-media)", () => {
  it("RU: 1 → версия, 2-4 → версии, 5-20 → версий (включая 11-14 исключение)", () => {
    expect(pluralVersions(1, "ru")).toBe("версия");
    expect(pluralVersions(21, "ru")).toBe("версия");
    expect(pluralVersions(2, "ru")).toBe("версии");
    expect(pluralVersions(3, "ru")).toBe("версии");
    expect(pluralVersions(4, "ru")).toBe("версии");
    expect(pluralVersions(5, "ru")).toBe("версий");
    expect(pluralVersions(11, "ru")).toBe("версий");
    expect(pluralVersions(12, "ru")).toBe("версий");
    expect(pluralVersions(14, "ru")).toBe("версий");
    expect(pluralVersions(0, "ru")).toBe("версий");
  });

  it("EN (дефолт, без lang): 1 → version, иначе — versions", () => {
    expect(pluralVersions(1)).toBe("version");
    expect(pluralVersions(2)).toBe("versions");
    expect(pluralVersions(0)).toBe("versions");
    expect(pluralVersions(21)).toBe("versions"); // EN не знает RU-исключения на 11-14/21
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
