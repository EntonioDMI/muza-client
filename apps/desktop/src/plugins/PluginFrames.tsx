/** Фреймы плагинов уровня 1 (эпик W8, T44): по одному живому <iframe> на
 *  включённый плагин. Фрейм НИКОГДА не меняет родителя (иначе перезагрузка
 *  realm) — видимость/геометрия задаётся только CSS по активной поверхности
 *  (скрыт-фон / вкладка / панель / оверлей). sandbox="allow-scripts" без
 *  allow-same-origin → opaque origin. См. §2.1, §3.3 дизайн-дока. */

import { useEffect, useRef } from "react";
import { IconButton } from "@muza/ui";
import { pluginHost } from "./host";
import type { InstalledPluginInfo } from "./types";
import type { UsePlugins } from "./usePlugins";
import type { PluginPermission } from "@muza/core";
import { useT } from "../i18n";

/** Origin custom-протокола: Windows/WebView2 — http://muza-plugin.localhost,
 *  mac/Linux — muza-plugin://localhost (оба в frame-src tauri.conf.json). */
function pluginOrigin(): string {
  const isWin = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  return isWin ? "http://muza-plugin.localhost" : "muza-plugin://localhost";
}

type Surface = "hidden" | "tab" | "panel" | "overlay";

function frameStyle(surface: Surface): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "fixed",
    border: "none",
    background: "transparent",
    colorScheme: "normal",
  };
  switch (surface) {
    case "overlay":
      return { ...base, inset: 0, width: "100%", height: "100%", zIndex: 95 };
    case "tab":
      return {
        ...base,
        top: "var(--gap-zone)",
        left: "calc(var(--w-sidebar) + 2 * var(--gap-zone))",
        right: "var(--gap-zone)",
        bottom: "calc(var(--h-playerbar) + 2 * var(--gap-zone))",
        borderRadius: "var(--r-lg)",
        zIndex: 30,
      };
    case "panel":
      return {
        ...base,
        top: "var(--gap-zone)",
        right: "var(--gap-zone)",
        width: "var(--w-nowplaying)",
        bottom: "calc(var(--h-playerbar) + 2 * var(--gap-zone))",
        borderRadius: "var(--r-lg)",
        background: "var(--surface-1)",
        zIndex: 45,
      };
    default:
      // Скрытый фон: фрейм жив (события, клики бара/меню), но не виден
      return { ...base, width: 1, height: 1, left: -9999, top: -9999, opacity: 0, pointerEvents: "none", zIndex: -1 };
  }
}

function PluginFrame({ plugin, surface }: { plugin: InstalledPluginInfo; surface: Surface }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const granted = plugin.granted as PluginPermission[];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // contentWindow-прокси стабилен на весь жизненный цикл элемента —
    // регистрируем на монтаже, до того как guest пришлёт ready
    pluginHost.registerFrame(plugin.id, el, granted);
    return () => pluginHost.unregisterFrame(plugin.id);
    // granted меняется только при переустановке (новый ключ реестра) — тогда
    // компонент и так пересоздаётся по key; deps на id достаточно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.id]);

  return (
    <iframe
      ref={ref}
      title={`plugin-${plugin.id}`}
      src={`${pluginOrigin()}/${plugin.id}/`}
      sandbox="allow-scripts"
      style={frameStyle(surface)}
    />
  );
}

export function PluginFrames({ plugins }: { plugins: UsePlugins }) {
  const { t } = useT();
  const { enabled, activeTab, activePanel, activeOverlay, closeTab, closePanel, closeOverlay, isCrashed } = plugins;

  const surfaceOf = (id: string): Surface => {
    if (activeOverlay === id) return "overlay";
    if (activeTab?.pluginId === id) return "tab";
    if (activePanel === id) return "panel";
    return "hidden";
  };

  // T44-fix: security review, Important #1 — watchdog (host.ts::markCrashed)
  // раньше только помечал status:"crashed", а сам <iframe> оставался в DOM
  // (этот .map не фильтровал по статусу) — зависший realm продолжал жить.
  // Теперь снятый фрейм не монтируется вовсе, пока явно не сброшено
  // (usePlugins.refresh — выключили/включили плагин).
  const mountable = enabled.filter((p) => !isCrashed(p.id));

  return (
    <>
      {mountable.map((p) => (
        <PluginFrame key={p.id} plugin={p} surface={surfaceOf(p.id)} />
      ))}
      {/* Кнопка закрытия видимой поверхности (фрейм плагина сам её не рисует
          поверх своего sandbox — управление хостовое) */}
      {activeOverlay ? (
        <IconButton
          icon="x"
          label={t("plugins.closeOverlay")}
          onClick={closeOverlay}
          style={{ position: "fixed", top: "var(--gap-zone)", right: "var(--gap-zone)", zIndex: 96 }}
        />
      ) : null}
      {activePanel ? (
        <IconButton
          icon="x"
          size="sm"
          label={t("plugins.closePanel")}
          onClick={closePanel}
          style={{ position: "fixed", top: "calc(var(--gap-zone) + 4px)", right: "calc(var(--gap-zone) + 4px)", zIndex: 46 }}
        />
      ) : null}
      {activeTab ? (
        <IconButton
          icon="x"
          size="sm"
          label={t("plugins.closeTab")}
          onClick={closeTab}
          style={{ position: "fixed", top: "calc(var(--gap-zone) + 4px)", right: "calc(var(--gap-zone) + 4px)", zIndex: 31 }}
        />
      ) : null}
    </>
  );
}
