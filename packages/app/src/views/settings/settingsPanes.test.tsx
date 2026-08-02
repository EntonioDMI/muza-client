/** ГЛАВНЫЙ ИНВАРИАНТ ЭКРАНА НАСТРОЕК: нет умения — нет ряда, и в поиске его
 *  тоже нет.
 *
 *  Проверяется именно связка, а не два факта по отдельности. Ряд, который
 *  площадка не рисует, но который находится поиском, — это переход в пустоту:
 *  человек ищет «автозапуск», попадает в «Систему» и не находит там ничего.
 *  Так уже было в вебе до волны 4 (около 26 таких рядов), поэтому здесь стоит
 *  сторож: и ряды, и индекс поиска фильтруются ОДНИМ списком умений, а сам
 *  список выводится из портов розетки (settingsCaps).
 *
 *  Второй сторож — settingsCaps: если кто-то заведёт порт и забудет умение,
 *  ряд появится, а поиск его не найдёт (или наоборот). */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import type { PlatformAdapter } from "../../platform";
import { DEFAULT_LANG, translate } from "../../i18n";
import { DEFAULT_PREFS } from "../../prefs/types";
import { SETTINGS_INDEX, searchSettings, type SettingsCapability } from "../../lib/settingsIndex";
import { settingsCaps, SettingsProvider } from "./settingsContext";
import { SystemPane } from "./SystemPane";
import { LibraryPane } from "./LibraryPane";
import { PlaybackPane } from "./PlaybackPane";
import { ExtensionsPane } from "./ExtensionsPane";

afterEach(cleanup);

const T = (key: string) => translate(DEFAULT_LANG, key as Parameters<typeof translate>[1]);

/** Заглушка сервера: панели дёргают его в эффектах, ответ здесь не важен —
 *  важно, что промис не оборванный (иначе тест падает на unhandled rejection). */
const apiStub = {
  getRecsSettings: () => Promise.resolve(null as never),
  getScrobbling: () => Promise.resolve(null as never),
  listSessions: () => Promise.resolve([]),
  getMarketThemes: () => Promise.resolve([]),
  getMarketPlugins: () => Promise.resolve([]),
} as unknown as MuzaApi;

function renderPane(Pane: () => React.ReactElement, caps: readonly SettingsCapability[], platform: PlatformAdapter = {}) {
  return render(
    <SettingsProvider
      prefs={DEFAULT_PREFS}
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
      caps={new Set(caps)}
      platform={platform}
      openSub={() => undefined}
      closeSub={() => undefined}
      goTo={() => undefined}
    >
      <Pane />
    </SettingsProvider>,
  );
}

/** Названия рядов, которые панель РЕАЛЬНО нарисовала (тот же якорь, по
 *  которому потом прокручивает переход из результатов поиска). */
function renderedRowTitles(): Set<string> {
  return new Set([...document.querySelectorAll("[data-rowtitle]")].map((n) => n.getAttribute("data-rowtitle") ?? ""));
}

describe("settingsCaps — умения выводятся из портов", () => {
  it("пустая розетка: только те три умения, что есть у любой площадки", () => {
    expect(settingsCaps({}).sort()).toEqual(["customFont", "sourcePicker", "themeMarket"]);
  });

  it("каждый порт добавляет своё умение", () => {
    const full: PlatformAdapter = {
      localFiles: {} as never,
      storedMedia: {} as never,
      system: { openExternal: async () => undefined, setAutostart: async () => undefined, configureTray: async () => undefined },
      updates: {} as never,
      miniPlayer: {} as never,
      diagnostics: {} as never,
      plugins: {} as never,
      audioDevices: {} as never,
      discordStatus: {} as never,
    };
    const caps = settingsCaps(full);
    for (const cap of ["localFiles", "offlineCache", "autostart", "tray", "updates", "miniPlayer", "diagnostics", "plugins", "audioOutputs", "discord"]) {
      expect(caps).toContain(cap as SettingsCapability);
    }
  });
});

describe("Раздел «Система» — ряды по умениям", () => {
  it("площадка без умений: системных рядов нет вовсе (не серые)", () => {
    renderPane(SystemPane, []);
    const rows = renderedRowTitles();
    expect(rows.has(T("settings.system.autostart.title"))).toBe(false);
    expect(rows.has(T("settings.system.tray.title"))).toBe(false);
    expect(rows.has(T("settings.system.update.title"))).toBe(false);
    expect(rows.has(T("settings.system.miniPlayer.title"))).toBe(false);
    expect(rows.has(T("settings.system.stage0.rowTitle"))).toBe(false);
    // «О программе» есть у всех — это не умение площадки
    expect(rows.has(T("settings.system.version.title"))).toBe(true);
  });

  it("площадка со всеми умениями: ряды на месте", () => {
    renderPane(SystemPane, ["autostart", "tray", "updates", "miniPlayer", "diagnostics"]);
    const rows = renderedRowTitles();
    expect(rows.has(T("settings.system.autostart.title"))).toBe(true);
    expect(rows.has(T("settings.system.tray.title"))).toBe(true);
    expect(rows.has(T("settings.system.update.title"))).toBe(true);
    expect(rows.has(T("settings.system.miniPlayer.title"))).toBe(true);
    expect(rows.has(T("settings.system.stage0.rowTitle"))).toBe(true);
  });

  it("поиск согласен с экраном: чего площадка не нарисовала, того он не находит", () => {
    renderPane(SystemPane, []);
    const rows = renderedRowTitles();
    // Берём ровно те записи индекса, что живут в разделе «Система» и требуют
    // умения, — и убеждаемся, что поиск с пустым набором умений молчит.
    const gated = SETTINGS_INDEX.filter((e) => e.tab === "system" && e.needs);
    expect(gated.length).toBeGreaterThan(0);
    for (const entry of gated) {
      const title = T(entry.titleKey);
      expect(rows.has(title)).toBe(false);
      expect(searchSettings(title, T, [])).toEqual([]);
    }
  });
});

describe("Прочие разделы — ряды по умениям", () => {
  it("«Медиатека»: без места на диске нет ни «Скачанного», ни «Без сети»", () => {
    renderPane(LibraryPane, []);
    const rows = renderedRowTitles();
    expect(rows.has(T("settings.library.cache.title"))).toBe(false);
    expect(rows.has(T("settings.library.offline.title"))).toBe(false);
    // перенос плейлистов и статистика от площадки не зависят
    expect(rows.has(T("settings.library.stats.title"))).toBe(true);
  });

  it("«Воспроизведение»: ряд вывода звука держится на своём умении", () => {
    renderPane(PlaybackPane, []);
    expect(renderedRowTitles().has(T("settings.playback.outputs.rowTitle"))).toBe(false);
    cleanup();
    renderPane(PlaybackPane, ["audioOutputs"]);
    expect(renderedRowTitles().has(T("settings.playback.outputs.rowTitle"))).toBe(true);
  });

  it("«Расширения»: без установки файлом остаётся только витрина оформлений", () => {
    renderPane(ExtensionsPane, ["themeMarket"]);
    const rows = renderedRowTitles();
    expect(rows.has(T("settings.extensions.installFromFile.title"))).toBe(false);
    expect(rows.has(T("settings.extensions.pluginMarket.title"))).toBe(false);
    expect(rows.has(T("settings.extensions.themeMarket.title"))).toBe(true);
    // строка-указатель «визуализатор переехал» — часть блока расширений
    expect(screen.queryByText(T("settings.extensions.visualizerMoved.title"))).toBeNull();
  });
});
