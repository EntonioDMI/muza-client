/** БИТЫЙ ПРОФИЛЬ И БИТАЯ ТЕМА НЕ РОНЯЮТ ЭКРАН НАСТРОЕК (аудит 2026-08-03).
 *
 *  Юнит-тесты фильтров (prefs/themes.test.ts, prefs/load.test.ts,
 *  lib/statsBlocks.test.ts) проверяют, что мусор не проезжает. Здесь
 *  проверяется то, ради чего они написаны: сами экраны, которые от этого мусора
 *  падали, — «Кастомизация» (читает prefs.rowShow.cover) и «Статистика»
 *  (итерирует prefs.statsBlocks).
 *
 *  Дыра была замкнутой: тему снимают на том же экране «Кастомизация», который
 *  она роняет, — упавший экран не давал её снять руками вовсе. */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { mergePrefs } from "../../prefs/load";
import { applyTheme, sanitizeTokens } from "../../prefs/themes";
import { DEFAULT_PREFS, type Prefs } from "../../prefs/types";
import { SettingsProvider } from "./settingsContext";
import { CustomizeSub } from "./CustomizeSub";
import { StatsSub } from "./StatsSub";

afterEach(cleanup);

const apiStub = {
  getMarketThemes: () => Promise.resolve([]),
  getMarketPlugins: () => Promise.resolve([]),
} as unknown as MuzaApi;

function renderPane(Pane: () => React.ReactElement, prefs: Prefs) {
  return render(
    <SettingsProvider
      prefs={prefs}
      setPrefs={() => undefined}
      api={apiStub}
      serverSession={false}
      username="tester"
      isAdmin={false}
      onLogout={() => undefined}
      onNotify={() => undefined}
      onOpenHotkeys={() => undefined}
      nowPlaying={null}
      glyphSrc="/glyph.svg"
      caps={new Set()}
      platform={{}}
      openSub={() => undefined}
      closeSub={() => undefined}
      goTo={() => undefined}
    >
      <Pane />
    </SettingsProvider>,
  );
}

/** Ровно то, что приходит из хранилища: разобранный JSON, написанный кем угодно. */
const brokenStored = JSON.parse(
  '{"rowShow": null, "statsBlocks": null, "uiScale": 100000, "hotkeys": null, "barButtons": null, "navItems": null}',
);

describe("экран настроек на битом профиле", () => {
  it("«Кастомизация» рисуется: rowShow приехал null, а читается как объект", () => {
    const prefs = mergePrefs(brokenStored);
    expect(prefs.rowShow).toEqual(DEFAULT_PREFS.rowShow);
    expect(() => renderPane(CustomizeSub, prefs)).not.toThrow();
    expect(document.querySelectorAll("[data-rowtitle]").length).toBeGreaterThan(10);
  });

  it("«Статистика» рисуется: statsBlocks приехал null, блоки взяты по канону", () => {
    const prefs = mergePrefs(brokenStored);
    expect(() => renderPane(StatsSub, prefs)).not.toThrow();
    expect(document.querySelectorAll("[data-rowtitle]").length).toBeGreaterThan(DEFAULT_PREFS.statsBlocks.length);
  });
});

describe("экран настроек после чужой темы", () => {
  it("тема с rowShow: null и запредельным масштабом не роняет «Кастомизацию»", () => {
    const tokens = sanitizeTokens(JSON.parse('{"rowShow": null, "uiScale": 100000, "wSidebar": 999999}'));
    const prefs = applyTheme(tokens, DEFAULT_PREFS);
    // масштаб зажат ползунком, а не уехал в zoom 1000 — экран остался кликабельным
    expect(prefs.uiScale).toBe(125);
    expect(prefs.wSidebar).toBe(340);
    expect(() => renderPane(CustomizeSub, prefs)).not.toThrow();
    expect(document.querySelectorAll("[data-rowtitle]").length).toBeGreaterThan(10);
  });
});
