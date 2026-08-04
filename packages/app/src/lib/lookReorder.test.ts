/** Чистая арифметика перестановки элементов в режиме правки вида (Ctrl+E):
 *  что порядок ВИДИМЫХ не двигает выключенных, что лента Главной переживает
 *  незнакомые полки сервера, и что раскладка карточек настроек не теряет
 *  разделы, которых нет на этой площадке.
 *
 *  Сам жест (pointer, сдвиг соседей, доводка) здесь не проверяется — он общий
 *  с реордером плейлистов и живёт в useLocalReorder. */

import { describe, expect, it } from "vitest";
import { applyVisibleOrder } from "./dragEngine";
import { normalizeHomeSections, orderHomeSections } from "./homeSections";
import { normalizeSettingsCards } from "../views/settings/settingsCards";
import { SETTINGS_TAB_KEYS } from "../views/settings/SettingsNav";

describe("applyVisibleOrder — выключенные остаются на своих местах", () => {
  const all = [
    { key: "home", on: true },
    { key: "search", on: false },
    { key: "library", on: true },
    { key: "stats", on: true },
  ];

  it("переставляет только видимые слоты", () => {
    // видимые: home, library, stats → человек поставил stats первым
    const next = applyVisibleOrder(all, (n) => n.key, ["stats", "home", "library"]);
    expect(next.map((n) => n.key)).toEqual(["stats", "search", "home", "library"]);
  });

  it("выключенный не уезжает в конец", () => {
    const next = applyVisibleOrder(all, (n) => n.key, ["library", "home", "stats"]);
    // search как был вторым, так вторым и остался
    expect(next[1].key).toBe("search");
  });

  it("ключ, исчезнувший из списка под жестом, игнорируется", () => {
    const next = applyVisibleOrder(all, (n) => n.key, ["stats", "ghost", "home", "library"]);
    expect(next.map((n) => n.key)).toEqual(["stats", "search", "home", "library"]);
  });
});

describe("полки Главной", () => {
  const feed = [{ key: "for_you" }, { key: "trending" }, { key: "new" }, { key: "because:nirvana" }];

  it("без сохранённого порядка — канон: витрины сверху, «Для тебя» ниже", () => {
    expect(orderHomeSections(feed, []).map((s) => s.key)).toEqual([
      "trending",
      "new",
      "for_you",
      "because:nirvana",
    ]);
  });

  it("сохранённый порядок главнее канона", () => {
    const saved = ["for_you", "because:nirvana", "trending", "new"];
    expect(orderHomeSections(feed, saved).map((s) => s.key)).toEqual(saved);
  });

  it("незнакомая полка сервера не теряется — встаёт по канону после своих", () => {
    const withNew = [...feed, { key: "editorial" }];
    const out = orderHomeSections(withNew, ["for_you", "trending"]).map((s) => s.key);
    expect(out.slice(0, 2)).toEqual(["for_you", "trending"]);
    expect(out).toContain("editorial");
    // канон незнакомых: «new» (ранг 1) раньше «потому что» (3) и прочего (4)
    expect(out.slice(2)).toEqual(["new", "because:nirvana", "editorial"]);
  });

  it("мусор в профиле не роняет нормализацию", () => {
    expect(normalizeHomeSections(null)).toEqual([]);
    expect(normalizeHomeSections(["a", "a", 7, "", "b"])).toEqual(["a", "b"]);
  });
});

describe("карточки разделов настроек", () => {
  it("пусто — канонический порядок в одну колонку", () => {
    const cards = normalizeSettingsCards([]);
    expect(cards.map((c) => c.key)).toEqual([...SETTINGS_TAB_KEYS]);
    expect(cards.every((c) => c.span === 1)).toBe(true);
  });

  it("незнакомое выбрасывает, недостающее дописывает в конец", () => {
    const cards = normalizeSettingsCards([{ key: "system", span: 2 }, { key: "ghost", span: 1 }]);
    expect(cards[0]).toEqual({ key: "system", span: 2, rows: 1 });
    expect(cards.map((c) => c.key)).not.toContain("ghost");
    expect(cards).toHaveLength(SETTINGS_TAB_KEYS.length);
  });

  it("ширина зажимается в 1..2 — чужой профиль не растянет карточку на пол-окна", () => {
    const cards = normalizeSettingsCards([
      { key: "account", span: 99 },
      { key: "appearance", span: -3 },
      { key: "playback", span: Number.NaN },
    ]);
    expect(cards.slice(0, 3).map((c) => c.span)).toEqual([2, 1, 1]);
  });

  it("высота зажимается в 1..2 и по умолчанию 1 — старый профиль без неё валиден", () => {
    const cards = normalizeSettingsCards([
      { key: "account", span: 1, rows: 9 },
      { key: "appearance", span: 1, rows: 0 },
      // профиль, записанный до появления высоты: поля нет вовсе
      { key: "playback", span: 1 },
    ]);
    expect(cards.slice(0, 3).map((c) => c.rows)).toEqual([2, 1, 1]);
  });
});
