/** API-модуль Muza.UI (эпик W8, T44): императивные UI-вызовы. toast/openTab
 *  идут в приложение (bridge), setBadge/setBarButtonState/applyCss/removeCss —
 *  в рантайм-состояние хоста (ctx.host), откуда их читает React (usePlugins).
 *  CSS сканируется тем же scanPluginCss (@muza/core) — красить хост можно,
 *  исполнять/утекать в сеть — нет. */

import { scanPluginCss } from "@muza/core";
import type { PluginApiContext, PluginApiModule } from "../types";

function arg(args: unknown): Record<string, unknown> {
  return (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
}
function str(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`bad_args: ${name} — строка`);
  return v;
}

export const uiApi: PluginApiModule = {
  "ui.toast": ({ bridge }: PluginApiContext, args) => {
    const a = arg(args);
    const kind = typeof a.kind === "string" ? a.kind : undefined;
    bridge.ui.toast(str(a.text, "text").slice(0, 200), kind);
  },
  "ui.openTab": ({ bridge, pluginId }, args) => {
    bridge.ui.openTab(pluginId, str(arg(args).tabId, "tabId"));
  },
  "ui.openPanel": ({ bridge, pluginId }) => {
    bridge.ui.openPanel(pluginId);
  },
  "ui.openOverlay": ({ bridge, pluginId }) => {
    bridge.ui.openOverlay(pluginId);
  },
  "ui.closeSurface": ({ bridge }) => {
    bridge.ui.closeSurface();
  },
  "ui.setBadge": ({ host, pluginId }, args) => {
    const a = arg(args);
    host.setBadge(pluginId, str(a.slotId, "slotId"), str(a.text, "text").slice(0, 12));
  },
  "ui.setBarButtonState": ({ host, pluginId }, args) => {
    const a = arg(args);
    const id = str(a.id, "id");
    const state = arg(a.state);
    host.setBarButtonState(pluginId, id, {
      icon: typeof state.icon === "string" ? state.icon : undefined,
      active: typeof state.active === "boolean" ? state.active : undefined,
    });
  },
  "ui.applyCss": ({ host, pluginId }, args) => {
    const css = str(arg(args).css, "css");
    const bad = scanPluginCss(css);
    if (bad) throw new Error(`denied: ${bad}`);
    host.applyCss(pluginId, css);
  },
  "ui.removeCss": ({ host, pluginId }) => {
    host.removeCss(pluginId);
  },
};
