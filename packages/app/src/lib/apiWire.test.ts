/** Разбор ответов сервера в @muza/api-client: одна битая строка стоит ОДНОЙ
 *  строки, а не всего экрана (правка 2026-08-03).
 *
 *  Раньше каждый элемент списка шёл через строгий `TrackSchema.parse`, и первая
 *  же запись не по схеме роняла весь запрос: поиск, «Любимое», плейлист и
 *  главная показывали пустой экран с текстом ошибки библиотеки проверки вместо
 *  сотни живых треков. Сторожим три вещи: списки собираются мягко, ОДИНОЧНЫЙ
 *  трек остаётся строгим (там битый ответ и есть провал операции), а
 *  `humanError` не пускает в интерфейс текст ошибок не от сервера.
 *
 *  ⚠️ Почему файл лежит в @muza/app, а не рядом с кодом: у пакета контракта нет
 *  своего прогонщика тестов (ни vitest, ни jsdom в зависимостях), а здесь оба
 *  уже есть и зависимость на @muza/api-client прямая. Заводить второй прогонщик
 *  и правку общего lock-файла ради одного файла — дороже, чем эта сноска. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, HttpMuzaApi, humanError } from "@muza/api-client";

const SESSION_KEY = "muza.session.v1";

const seedSession = () =>
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      user: { id: "7", username: "qa", anonymous: false, createdAt: "2026-01-01T00:00:00.000Z" },
      accessToken: "at-1",
      refreshToken: "rt-1",
    }),
  );

/** Проводная строка трека (snake_case сервера), поля перекрываются точечно. */
const wire = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  artist: "A",
  title: "Первый",
  duration_sec: 100,
  cover_url: null,
  is_cached: false,
  sources: ["youtube"],
  loudness: null,
  ...over,
});

/** Строка, которую схема не примет: длительность не число. */
const broken = (id: string) => wire({ id, duration_sec: "неизвестно" });

const reply = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

const api = () => new HttpMuzaApi("http://x/api");

beforeEach(() => {
  localStorage.clear();
  seedSession();
});
afterEach(() => vi.unstubAllGlobals());

describe("списки треков: битая строка выпадает, экран живёт", () => {
  it("поиск: одна битая запись из трёх — две живые на экране, без исключения", async () => {
    vi.stubGlobal("fetch", reply({ query: "q", results: [wire({ id: "a" }), broken("bad"), wire({ id: "c" })] }));

    const found = await api().search("q");

    expect(found.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("сервер перестал слать loudness — трек ОСТАЁТСЯ (в схеме поле nullable, но не optional)", async () => {
    const noLoudness = wire({ id: "a" });
    delete (noLoudness as Record<string, unknown>).loudness;
    vi.stubGlobal("fetch", reply([noLoudness]));

    const favorites = await api().getFavorites();

    expect(favorites.map((t) => t.id)).toEqual(["a"]);
    expect(favorites[0].loudness).toBeNull();
  });

  it("плейлист: битый трек выпадает, сам плейлист открывается", async () => {
    vi.stubGlobal(
      "fetch",
      reply({ id: "pl1", name: "Мой микс", tracks: [broken("bad"), wire({ id: "ok" })], is_owner: true }),
    );

    const detail = await api().getPlaylist("pl1");

    expect(detail.name).toBe("Мой микс");
    expect(detail.tracks.map((t) => t.id)).toEqual(["ok"]);
  });

  it("история: битая строка «трек + время» выпадает, соседние остаются", async () => {
    vi.stubGlobal(
      "fetch",
      reply([
        { track: broken("bad"), played_at: "2026-08-01T10:00:00.000Z", completed: true },
        { track: wire({ id: "ok" }), played_at: "2026-08-01T11:00:00.000Z", completed: false },
      ]),
    );

    const rows = await api().getHistory(10);

    expect(rows.map((r) => r.track.id)).toEqual(["ok"]);
  });

  it("главная: битая строка не уносит всю полку", async () => {
    vi.stubGlobal("fetch", reply({ sections: [{ key: "recent", title: "Недавнее", tracks: [broken("bad"), wire({ id: "ok" })] }] }));

    const sections = await api().getHome();

    expect(sections[0].tracks.map((t) => t.id)).toEqual(["ok"]);
  });
});

describe("группированная выдача", () => {
  it("битый вариант внутри группы выпадает — группа остаётся", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        query: "q",
        results: [
          {
            kind: "group",
            canonical: wire({ id: "canon" }),
            has_original: true,
            canonical_variant_type: null,
            variants: [
              { track: broken("bad"), variant_type: "remix" },
              { track: wire({ id: "v-ok" }), variant_type: "remix" },
            ],
          },
        ],
      }),
    );

    const cards = await api().searchGrouped("q");

    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("group");
    if (cards[0].kind === "group") expect(cards[0].variants.map((v) => v.track.id)).toEqual(["v-ok"]);
  });

  it("битый канон — выпадает только эта карточка, соседняя видна", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        query: "q",
        results: [
          { kind: "group", canonical: broken("bad"), has_original: true, canonical_variant_type: null, variants: [] },
          { kind: "single", track: wire({ id: "ok" }) },
        ],
      }),
    );

    const cards = await api().searchGrouped("q");

    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("single");
  });
});

describe("одиночный трек — по-прежнему строго", () => {
  it("битый ответ на «открыть трек» — это провал самой операции, а не тихий null", async () => {
    vi.stubGlobal("fetch", reply(broken("bad")));

    await expect(api().getTrack("bad")).rejects.toBeTruthy();
  });
});

describe("humanError — что вообще можно показать человеку", () => {
  it("ошибка сервера идёт на экран как есть", () => {
    expect(humanError(new ApiError(409, "Имя занято"), "запас")).toBe("Имя занято");
  });

  it("ошибка разбора схемы на экран НЕ идёт — там простыня JSON", () => {
    const zodish = new Error('[\n  {\n    "code": "invalid_type",\n    "path": ["durationSec"]\n  }\n]');
    expect(humanError(zodish, "запас")).toBe("запас");
  });

  it("сбой сети (TypeError) — тоже язык разработчика", () => {
    expect(humanError(new TypeError("Failed to fetch"), "запас")).toBe("запас");
  });

  it("пустое сообщение сервера — показывать нечего, берём заготовку вьюхи", () => {
    expect(humanError(new ApiError(500, "  "), "запас")).toBe("запас");
  });
});

describe("сессия в хранилище", () => {
  it("запись не по схеме — не только null, но и СТЁРТА (иначе живёт вечно)", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: { id: 7 }, accessToken: "at" }));
    vi.stubGlobal("fetch", vi.fn());

    await expect(api().restoreSession()).resolves.toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  // ⚠️ ПАРНЫЙ сторож к тесту выше, и он важнее его. Стирание не по схеме
  // завели 03.08 — до этого мёртвая запись лежала вечно. Но у такой правки
  // есть цена: стоит схеме стать хоть на волос строже того, что мы САМИ
  // пишем в хранилище, и обновление молча разлогинит всех до единого,
  // причём необратимо — запись уже стёрта. Поэтому здесь лежит ровно та
  // форма, которую кладёт persist после входа, и она обязана выживать.
  it("живая сессия ПЕРЕЖИВАЕТ восстановление и остаётся в хранилище", async () => {
    const live = {
      user: { id: "42", username: "sivren", anonymous: false, createdAt: "2026-07-01T10:00:00.000Z" },
      accessToken: "at",
      refreshToken: "rt",
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(live));
    vi.stubGlobal("fetch", vi.fn());

    await expect(api().restoreSession()).resolves.toEqual(live);
    expect(localStorage.getItem(SESSION_KEY)).toBe(JSON.stringify(live));
  });

  it("анонимная сессия без refresh-токена тоже переживает", async () => {
    const anon = {
      user: { id: "7", username: null, anonymous: true, createdAt: "2026-07-01T10:00:00.000Z" },
      accessToken: "at",
      refreshToken: null,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(anon));
    vi.stubGlobal("fetch", vi.fn());

    await expect(api().restoreSession()).resolves.toEqual(anon);
    expect(localStorage.getItem(SESSION_KEY)).toBe(JSON.stringify(anon));
  });
});
