import { describe, expect, it } from "vitest";
import type { GroupedSearchResult, Track } from "@muza/api-client";
import {
  flattenGroupedResults,
  GROUP_LIMIT_MAX,
  GROUP_LIMIT_STEP,
  loadMoreScope,
  mergeGroupedResults,
  nextGroupLimit,
  pluralVersions,
  variantLabel,
} from "./searchGrouping";

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

describe("nextGroupLimit (T37 — «Загрузить ещё» в grouped-режиме)", () => {
  // ⚠️ Лестница была ЖЁСТКОЙ: [30, 60, 90], и nextGroupLimit(90) === null.
  // Это и прятало кнопку «Загрузить ещё» на широком запросе («фонк»): треки в
  // источниках не кончались — просто на третьем шаге расти было некуда, и
  // выдача упиралась в ~40 треков навсегда. Тест, требовавший ровно этого,
  // переписан осознанно (замеры — docs/notes/2026-07-15-поиск-потолок-пагинации.md).
  it("шаг 30: 30 → 60 → 90 → 120 — за прежним потолком лестница не кончается", () => {
    expect(nextGroupLimit(30)).toBe(60);
    expect(nextGroupLimit(60)).toBe(90);
    expect(nextGroupLimit(90)).toBe(120); // раньше здесь был null — и кнопка исчезала
    expect(nextGroupLimit(120)).toBe(150);
  });

  it("потолок — максимум сервера (SearchQueryDto @Max = SEARCH_MAX_POOL)", () => {
    expect(GROUP_LIMIT_MAX).toBe(300);
    expect(nextGroupLimit(GROUP_LIMIT_MAX - GROUP_LIMIT_STEP)).toBe(GROUP_LIMIT_MAX);
  });

  it("на потолке — null: дальше сервер всё равно клампит пул, кнопку прячем", () => {
    expect(nextGroupLimit(GROUP_LIMIT_MAX)).toBeNull();
    expect(nextGroupLimit(GROUP_LIMIT_MAX + 30)).toBeNull();
  });

  it("значение вне шага не ломает лестницу — просто следующий шаг от него", () => {
    expect(nextGroupLimit(45)).toBe(75);
  });
});

describe("mergeGroupedResults — стабильный порядок «Загрузить ещё»", () => {
  const single = (id: string): GroupedSearchResult => ({ kind: "single", track: track(id) });
  const group = (canonId: string, variantIds: string[] = []): GroupedSearchResult => ({
    kind: "group",
    canonical: track(canonId),
    hasOriginal: true,
    canonicalVariantType: null,
    variants: variantIds.map((id) => ({ track: track(id), variantType: "remix" as const })),
  });
  const keys = (rs: GroupedSearchResult[]) => rs.map((r) => (r.kind === "single" ? r.track.id : r.canonical.id));

  it("сервер пересортировал старые + добавил новые → старый порядок цел, новые в конце", () => {
    const prev = [single("a"), single("b"), single("c")];
    // сервер над бОльшим пулом переранжировал: c поднялся, между ними вклинились новые
    const next = [single("c"), single("x"), single("a"), single("y"), single("b")];
    expect(keys(mergeGroupedResults(prev, next))).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("совпавшая карточка берёт СВЕЖИЕ данные на старом месте (группа подросла вариантами)", () => {
    const prev = [group("g1", ["v1"]), single("s1")];
    const next = [single("s1"), group("g1", ["v1", "v2"])];
    const merged = mergeGroupedResults(prev, next);
    expect(keys(merged)).toEqual(["g1", "s1"]);
    const g = merged[0];
    expect(g.kind === "group" && g.variants.map((v) => v.track.id)).toEqual(["v1", "v2"]);
  });

  it("карточка пропала из next, но её треки нигде не всплыли → остаётся (пользователь её видел)", () => {
    const prev = [single("a"), single("b")];
    const next = [single("a"), single("x")];
    expect(keys(mergeGroupedResults(prev, next))).toEqual(["a", "b", "x"]);
  });

  it("одиночка поглощена группой next → убрана, трек не задваивается", () => {
    const prev = [single("a"), single("v9")];
    const next = [single("a"), group("g1", ["v9"])];
    const merged = mergeGroupedResults(prev, next);
    expect(keys(merged)).toEqual(["a", "g1"]);
    expect(flattenGroupedResults(merged).map((t) => t.id)).toEqual(["a", "g1", "v9"]);
  });

  it("первый «ещё» после пустого прошлого — просто выдача next", () => {
    expect(keys(mergeGroupedResults([], [single("a"), group("g", ["v"])]))).toEqual(["a", "g"]);
  });

  it("ничего нового (источники исчерпаны) → длина не растёт", () => {
    const prev = [single("a"), single("b")];
    const merged = mergeGroupedResults(prev, [single("b"), single("a")]);
    expect(flattenGroupedResults(merged).length).toBe(2);
  });
});

describe("loadMoreScope — куда идёт «Загрузить ещё»", () => {
  // Мгновенный ввод ищет scope=catalog (быстро, без провайдеров), и «Загрузить
  // ещё» повторял ИМЕННО его — то есть листал накопленный каталог и в источники
  // за добавкой не ходил никогда. На широком запросе это тупик: в каталоге по
  // «фонк» pg_trgm отдаёт 11 строк из 1968 (замер 15.07), прирост нулевой —
  // и кнопка пропадала, хотя в источниках треков тысячи.
  it("«где искать: каталог + источники» — «ещё» идёт в источники, а не листает каталог", () => {
    expect(loadMoreScope("all")).toBe("full");
  });

  it("«где искать: только каталог» — выбор пользователя уважаем, в источники не лезем", () => {
    expect(loadMoreScope("catalog")).toBe("catalog");
  });
});
