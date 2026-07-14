/** Реестр плагинов для React (эпик W8, T44): грузит installed.json, задаёт
 *  бридж хосту, держит активные поверхности (вкладка/панель/оверлей),
 *  считает данные слотов (кнопки бара, вкладки сайдбара, пункты меню, панели,
 *  оверлеи), плагинные ключи композиции и инъекцию CSS. Фреймы рендерит
 *  PluginFrames. См. docs/notes/2026-07-13-плагины-архитектура.md §3. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isFullAccessManifest } from "@muza/core";
import { pluginHost } from "./host";
import { listInstalled } from "./install";
import { pluginSlotKey } from "../lib/pluginSlots";
import type { InstalledPluginInfo, PluginBridge } from "./types";
import type { PluginContributes, PluginContributesItem } from "@muza/core";

export interface PluginBarButton {
  key: string;
  pluginId: string;
  slotId: string;
  title: string;
  icon: string;
}
export interface PluginNavTab {
  key: string;
  pluginId: string;
  tabId: string;
  title: string;
  icon: string;
}
export interface PluginMenuItem {
  pluginId: string;
  slotId: string;
  title: string;
  icon?: string;
}
export type PluginMenuKind = "track" | "catalogTrack" | "playlist";

export interface ActiveTab {
  pluginId: string;
  tabId: string;
}

function contributes(p: InstalledPluginInfo): PluginContributes {
  return (p.manifest.contributes ?? {}) as PluginContributes;
}

/** Только уровень-1 плагины (T44); full-access (T44b) в этот рантайм не грузятся. */
function isLevel1(p: InstalledPluginInfo): boolean {
  return p.enabled && !isFullAccessManifest(p.manifest);
}

export function usePlugins(bridge: PluginBridge) {
  const [installed, setInstalled] = useState<InstalledPluginInfo[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<string | null>(null);

  // Бридж — один раз (host держит ссылку, ре-сеттинг безвреден)
  useEffect(() => {
    pluginHost.setBridge(bridge);
  }, [bridge]);

  const refresh = useCallback(async () => {
    try {
      setInstalled(await listInstalled());
    } catch {
      setInstalled([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Рантайм-состояние хоста (badges/barButtonState/injectedCss) — внешний стор
  const runtimeVersion = useSyncExternalStore(
    (cb) => pluginHost.subscribe(cb),
    () => pluginHost.runtimeVersion(),
  );

  const enabled = useMemo(() => installed.filter(isLevel1), [installed]);

  // Активные поверхности гаснут, если плагин выключили/удалили
  useEffect(() => {
    const ids = new Set(enabled.map((p) => p.id));
    if (activeTab && !ids.has(activeTab.pluginId)) setActiveTab(null);
    if (activePanel && !ids.has(activePanel)) setActivePanel(null);
    if (activeOverlay && !ids.has(activeOverlay)) setActiveOverlay(null);
  }, [enabled, activeTab, activePanel, activeOverlay]);

  const barButtons = useMemo<PluginBarButton[]>(() => {
    const out: PluginBarButton[] = [];
    for (const p of enabled) {
      for (const b of contributes(p).barButtons ?? []) {
        out.push({ key: pluginSlotKey(p.id, b.id), pluginId: p.id, slotId: b.id, title: b.title, icon: b.icon || "puzzle" });
      }
    }
    return out;
  }, [enabled]);

  const navTabs = useMemo<PluginNavTab[]>(() => {
    const out: PluginNavTab[] = [];
    for (const p of enabled) {
      const c = contributes(p);
      // navItem открывает вкладку плагина: сопоставляем по общему id (§3.3)
      const tabs = c.tabs ?? [];
      for (const n of c.navItems ?? []) {
        const tab = tabs.find((t) => t.id === n.id) ?? n;
        out.push({ key: pluginSlotKey(p.id, n.id), pluginId: p.id, tabId: tab.id, title: n.title, icon: n.icon || "puzzle" });
      }
    }
    return out;
  }, [enabled]);

  const pluginBarKeys = useMemo(() => barButtons.map((b) => b.key), [barButtons]);
  const pluginNavKeys = useMemo(() => navTabs.map((n) => n.key), [navTabs]);

  const menuItemsByKind = useMemo(() => {
    const map: Record<PluginMenuKind, PluginMenuItem[]> = { track: [], catalogTrack: [], playlist: [] };
    for (const p of enabled) {
      const menus = contributes(p).menus;
      if (!menus) continue;
      const push = (kind: PluginMenuKind, items?: PluginContributesItem[]) => {
        for (const it of items ?? []) map[kind].push({ pluginId: p.id, slotId: it.id, title: it.title, icon: it.icon });
      };
      push("track", menus.track);
      push("catalogTrack", menus.catalogTrack);
      push("playlist", menus.playlist);
    }
    return map;
  }, [enabled]);

  const panels = useMemo(
    () => enabled.filter((p) => contributes(p).panel).map((p) => ({ pluginId: p.id, title: contributes(p).panel!.title })),
    [enabled],
  );
  const overlays = useMemo(
    () => enabled.filter((p) => contributes(p).overlay).map((p) => ({ pluginId: p.id })),
    [enabled],
  );

  // Инъекция CSS: статический contributes.css из installed.json +
  // динамический из UI.applyCss (host runtime), только для включённых плагинов
  const injectedCss = useMemo(() => {
    void runtimeVersion; // пересчёт при applyCss/removeCss
    const enabledIds = new Set(enabled.map((p) => p.id));
    const out: { pluginId: string; css: string }[] = [];
    for (const p of enabled) {
      if (p.css) out.push({ pluginId: p.id, css: p.css });
    }
    for (const dyn of pluginHost.getInjectedCss()) {
      if (enabledIds.has(dyn.pluginId)) out.push({ pluginId: dyn.pluginId, css: dyn.css });
    }
    return out;
  }, [enabled, runtimeVersion]);

  const barButtonRuntime = useCallback(
    (pluginId: string, slotId: string) => {
      void runtimeVersion;
      const rt = pluginHost.getRuntime(pluginId);
      return {
        state: rt?.barButtonState[slotId],
        badge: rt?.badges[slotId],
        status: rt?.status,
      };
    },
    [runtimeVersion],
  );

  const openTab = useCallback((pluginId: string, tabId: string) => {
    setActiveOverlay(null);
    setActiveTab({ pluginId, tabId });
  }, []);
  const openTabByKey = useCallback(
    (key: string) => {
      const t = navTabs.find((n) => n.key === key);
      if (t) openTab(t.pluginId, t.tabId);
    },
    [navTabs, openTab],
  );
  const closeTab = useCallback(() => setActiveTab(null), []);

  const notifySlot = useCallback((pluginId: string, slotId: string, kind: string, payload?: unknown) => {
    pluginHost.notifySlot(pluginId, slotId, kind, payload);
  }, []);

  return {
    installed,
    enabled,
    refresh,
    barButtons,
    navTabs,
    pluginBarKeys,
    pluginNavKeys,
    menuItems: (kind: PluginMenuKind) => menuItemsByKind[kind],
    panels,
    overlays,
    injectedCss,
    barButtonRuntime,
    // активные поверхности
    activeTab,
    activePanel,
    activeOverlay,
    openTab,
    openTabByKey,
    closeTab,
    openPanel: (pluginId: string) => setActivePanel(pluginId),
    closePanel: () => setActivePanel(null),
    openOverlay: (pluginId: string) => setActiveOverlay(pluginId),
    closeOverlay: () => setActiveOverlay(null),
    notifySlot,
  };
}

export type UsePlugins = ReturnType<typeof usePlugins>;
