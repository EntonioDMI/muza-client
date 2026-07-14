import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  createHistory,
  currentEntry,
  goBack,
  goForward,
  pushHistory,
  type HistoryState,
} from "./historyStack";

describe("historyStack: создание", () => {
  it("createHistory — один экран, index 0, назад/вперёд недоступны", () => {
    const s = createHistory({ view: "home" });
    expect(currentEntry(s)).toEqual({ view: "home" });
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(false);
  });
});

describe("historyStack: обычные переходы (push)", () => {
  it("push добавляет запись и двигает index в конец", () => {
    let s: HistoryState<string> = createHistory({ view: "home" });
    s = pushHistory(s, { view: "search" });
    expect(currentEntry(s)).toEqual({ view: "search" });
    expect(canGoBack(s)).toBe(true);
    expect(canGoForward(s)).toBe(false);
  });

  it("дедуп: push той же записи подряд — без-оп (та же ссылка на state)", () => {
    const s: HistoryState<string> = createHistory({ view: "home" });
    const after = pushHistory(s, { view: "home" });
    expect(after).toBe(s); // ссылочное равенство — не создали новую запись
    expect(s.entries.length).toBe(1);
  });

  it("дедуп сравнивает и payload: home→playlist(A)→playlist(A) не плодит записи", () => {
    let s: HistoryState<string> = createHistory({ view: "home" });
    s = pushHistory(s, { view: "playlist", payload: { playlistId: "A" } });
    const after = pushHistory(s, { view: "playlist", payload: { playlistId: "A" } });
    expect(after).toBe(s);
  });

  it("playlist(A)→playlist(B) — разные payload, НЕ дедупятся", () => {
    let s: HistoryState<string> = createHistory({ view: "home" });
    s = pushHistory(s, { view: "playlist", payload: { playlistId: "A" } });
    s = pushHistory(s, { view: "playlist", payload: { playlistId: "B" } });
    expect(s.entries.length).toBe(3);
    expect(currentEntry(s).payload?.playlistId).toBe("B");
  });

  it("push после goBack срезает forward-хвост", () => {
    let s: HistoryState<string> = createHistory({ view: "home" });
    s = pushHistory(s, { view: "search" });
    s = pushHistory(s, { view: "library" });
    s = goBack(s); // на search, library — в forward-хвосте
    s = pushHistory(s, { view: "stats" }); // новый переход из середины
    expect(s.entries.map((e) => e.view)).toEqual(["home", "search", "stats"]);
    expect(canGoForward(s)).toBe(false);
  });

  it("cap: переполнение обрезает голову стека, index остаётся на последней", () => {
    let s: HistoryState<string> = createHistory({ view: "v0" });
    for (let i = 1; i <= 10; i++) s = pushHistory(s, { view: `v${i}` }, 5);
    expect(s.entries.length).toBe(5);
    expect(s.index).toBe(4);
    expect(currentEntry(s).view).toBe("v10");
    expect(s.entries.map((e) => e.view)).toEqual(["v6", "v7", "v8", "v9", "v10"]);
  });
});

describe("historyStack: назад/вперёд (без пуша)", () => {
  it("goBack/goForward двигают index, не создавая новых записей", () => {
    let s: HistoryState<string> = createHistory({ view: "home" });
    s = pushHistory(s, { view: "search" });
    s = pushHistory(s, { view: "library" });
    expect(s.entries.length).toBe(3);
    s = goBack(s);
    expect(currentEntry(s).view).toBe("search");
    s = goBack(s);
    expect(currentEntry(s).view).toBe("home");
    expect(s.entries.length).toBe(3); // ничего не добавилось
    s = goForward(s);
    expect(currentEntry(s).view).toBe("search");
  });

  it("goBack на границе (index 0) — без-оп", () => {
    const s: HistoryState<string> = createHistory({ view: "home" });
    const after = goBack(s);
    expect(after).toBe(s);
  });

  it("goForward на границе (конец стека) — без-оп", () => {
    let s: HistoryState<string> = createHistory({ view: "home" });
    s = pushHistory(s, { view: "search" });
    const after = goForward(s);
    expect(after).toBe(s);
  });

  it("назад в playlist возвращает ТОТ ЖЕ payload (id плейлиста)", () => {
    let s: HistoryState<string> = createHistory({ view: "home" });
    s = pushHistory(s, { view: "playlist", payload: { playlistId: "p42" } });
    s = pushHistory(s, { view: "library" });
    s = goBack(s);
    expect(currentEntry(s)).toEqual({ view: "playlist", payload: { playlistId: "p42" } });
  });
});
