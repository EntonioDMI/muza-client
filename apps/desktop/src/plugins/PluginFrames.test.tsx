/** T44-fix: security review (Important #1) — PluginFrames раньше рендерила
 *  все `enabled` плагины БЕЗ фильтра по watchdog-статусу: `enabled.map(...)`
 *  монтировала <iframe> для крашнутого плагина точно так же, как для живого.
 *  Проверяем на уровне DOM (не только логики host.ts в host.test.ts), что
 *  crashed-плагин не получает <iframe>, а здоровый — получает. */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginManifest } from "@muza/core";
import { PluginFrames } from "./PluginFrames";
import type { UsePlugins } from "./usePlugins";
import type { InstalledPluginInfo } from "./types";

afterEach(cleanup);

function plugin(id: string): InstalledPluginInfo {
  const manifest: PluginManifest = {
    id,
    name: id,
    version: "1.0.0",
    api_version: 1,
    description: "тестовый плагин",
    author: "test",
    entry: "index.js",
    permissions: [],
  };
  return { id, version: "1.0.0", enabled: true, manifest, granted: [], grantedAt: "0" };
}

function fakePlugins(overrides: Partial<UsePlugins>): UsePlugins {
  return {
    installed: [],
    enabled: [],
    refresh: async () => {},
    barButtons: [],
    navTabs: [],
    pluginBarKeys: [],
    pluginNavKeys: [],
    menuItems: () => [],
    panels: [],
    overlays: [],
    injectedCss: [],
    barButtonRuntime: () => ({ state: undefined, badge: undefined, status: undefined }),
    isCrashed: () => false,
    activeTab: null,
    activePanel: null,
    activeOverlay: null,
    openTab: () => {},
    openTabByKey: () => {},
    closeTab: () => {},
    openPanel: () => {},
    closePanel: () => {},
    openOverlay: () => {},
    closeOverlay: () => {},
    notifySlot: () => {},
    ...overrides,
  };
}

describe("PluginFrames — watchdog teardown", () => {
  it("crashed-плагин не монтирует <iframe>, здоровый — монтирует", () => {
    const plugins = fakePlugins({
      enabled: [plugin("healthy-one"), plugin("hang-test")],
      isCrashed: (id) => id === "hang-test",
    });
    const { container } = render(<PluginFrames plugins={plugins} />);
    const titles = [...container.querySelectorAll("iframe")].map((f) => f.title);

    expect(titles).toContain("plugin-healthy-one");
    expect(titles).not.toContain("plugin-hang-test");
  });

  it("все живые (не crashed) плагины монтируются как обычно", () => {
    const plugins = fakePlugins({ enabled: [plugin("a"), plugin("b")], isCrashed: () => false });
    const { container } = render(<PluginFrames plugins={plugins} />);
    const titles = [...container.querySelectorAll("iframe")].map((f) => f.title);

    expect(titles).toEqual(expect.arrayContaining(["plugin-a", "plugin-b"]));
  });
});
