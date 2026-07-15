import { useState } from "react";
import { Icon, IconButton, Tooltip } from "@muza/ui";
import glyph from "@muza/ui/assets/logo/glyph.svg";
import { isTrackDrag, readTrackDrag } from "../lib/dnd";
import { NAV_ITEM_META, navItemLabel, normalizeNavItems, type NavItemPref } from "../lib/navItems";
import { isPluginKey } from "../lib/pluginSlots";
import type { View } from "../types";
import { useT } from "../i18n";

/** T44: плагинная вкладка сайдбара (мета из contributes). */
export interface PluginNavItemView {
  key: string;
  pluginId: string;
  tabId: string;
  title: string;
  icon: string;
}

/** Пункт списка плейлистов (серверный) — T47b: с
 *  cover, если у плейлиста есть валидная иконка манифеста @muza/core;
 *  иначе (или нет иконки) — плейсхолдер (users/list-music по shared). */
export interface SidebarPlaylist {
  id: string;
  name: string;
  meta: string;
  cover?: string;
  /** Stage 7: совместный плейлист — иконка «люди» вместо нот. */
  shared?: boolean;
}

const NAV_H = 48;
const NAV_GAP = 4;

function NavItem({
  icon,
  label,
  active,
  quiet,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  quiet?: boolean;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: NAV_H,
        width: "100%",
        boxSizing: "border-box",
        padding: "0 var(--sp-4)",
        border: "none",
        borderRadius: "var(--r-sm)",
        background: quiet
          ? !active && hover
            ? "var(--surface-2)"
            : "transparent"
          : active
            ? "var(--surface-4)"
            : hover
              ? "var(--surface-2)"
              : "transparent",
        color: active ? "var(--text-1)" : hover ? "var(--text-1)" : "var(--text-2)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        fontWeight: active ? "var(--fw-semibold)" : ("var(--fw-medium)" as never),
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-fast) var(--ease-out), color var(--dur-base) var(--ease-out)",
      }}
    >
      <Icon
        name={icon}
        size={20}
        color={active ? "var(--accent-text)" : "currentColor"}
        style={{ transition: "color var(--dur-base) var(--ease-out)" }}
      />
      {label}
    </button>
  );
}

function PlaylistRow({
  cover,
  name,
  meta,
  shared,
  onClick,
  onMenu,
  onDropTrack,
}: {
  cover?: string;
  name: string;
  meta: string;
  shared?: boolean;
  onClick?: () => void;
  /** ПКМ по строке — контекст-меню плейлиста (Открыть/Переименовать/Удалить). */
  onMenu?: (e: React.MouseEvent) => void;
  /** Дроп перетаскиваемого трека на этот плейлист (undefined = не таргет). */
  onDropTrack?: (trackId: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const [dropLit, setDropLit] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(e);
            }
          : undefined
      }
      onDragOver={
        onDropTrack
          ? (e) => {
              if (!isTrackDrag(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDropLit(true);
            }
          : undefined
      }
      onDragLeave={onDropTrack ? () => setDropLit(false) : undefined}
      onDrop={
        onDropTrack
          ? (e) => {
              e.preventDefault();
              setDropLit(false);
              const data = readTrackDrag(e);
              if (data) onDropTrack(data.id);
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        border: "none",
        borderRadius: "var(--r-sm)",
        background: dropLit ? "var(--accent-soft)" : hover ? "var(--surface-2)" : "transparent",
        outline: dropLit ? "var(--focus-ring)" : undefined,
        outlineOffset: -2,
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      {cover ? (
        // objectFit обязателен: без него дефолтный fill плющил неквадратную
        // обложку. Не Cover — у пустой ветки ниже свой осмысленный плейсхолдер
        // (совместный плейлист vs обычный), а не общий значок ноты.
        <img
          src={cover}
          alt=""
          style={{ width: 40, height: 40, borderRadius: "var(--r-xs)", flex: "none", objectFit: "cover" }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--r-xs)",
            flex: "none",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={shared ? "users" : "list-music"} size={18} color="var(--accent-text)" />
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body)",
            fontWeight: 500,
            color: "var(--text-1)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
          {meta}
        </span>
      </span>
    </button>
  );
}

export function Sidebar({
  view,
  setView,
  playlists,
  onCreatePlaylist,
  onOpenPlaylist,
  onPlaylistMenu,
  onDropTrack,
  isAdmin = false,
  navItems,
  pluginNav = [],
  pluginKeys = [],
  activePluginKey = null,
  onSelectPluginTab,
  onOpenHotkeys,
}: {
  view: View;
  setView: (v: View) => void;
  playlists: SidebarPlaylist[];
  onCreatePlaylist: () => void;
  onOpenPlaylist: (id: string) => void;
  /** T17: ПКМ по плейлисту — контекст-меню (App: Открыть/Переименовать/Удалить). */
  onPlaylistMenu?: (p: SidebarPlaylist, e: React.MouseEvent) => void;
  /** DnD: трек уронили на плейлист (только серверные списки). */
  onDropTrack?: (playlistId: string, trackId: string) => void;
  /** Показывает пункт «Админка» (Stage 5); true только после adminPing. */
  isAdmin?: boolean;
  /** Компоновка (настройки → «Вкладки сайдбара»): состав/порядок/имена. */
  navItems?: NavItemPref[];
  /** T44: плагинные вкладки (мета из contributes). */
  pluginNav?: PluginNavItemView[];
  /** T44: валидные плагинные ключи для нормализатора композиции. */
  pluginKeys?: readonly string[];
  /** T44: активна плагинная вкладка (ключ plugin:<id>:<tab>) — подсветка. */
  activePluginKey?: string | null;
  /** T44: клик по плагинной вкладке — открыть её фрейм (App). */
  onSelectPluginTab?: (pluginId: string, tabId: string) => void;
  /** T9: видимая кнопка «?» — открывает диалог горячих клавиш (App). */
  onOpenHotkeys: () => void;
}) {
  const { t, lang } = useT();
  // Компоновка: скрытая вкладка не рендерится (активный view на скрытой —
  // индикатор гаснет, контент остаётся доступен), label — своё имя.
  // T44: плагинные вкладки живут в том же списке под ключами plugin:<id>:<tab>.
  const mainNav = normalizeNavItems(navItems ?? [], pluginKeys)
    .filter((n) => n.on)
    .map((n) => {
      if (isPluginKey(n.key)) {
        const pn = pluginNav.find((p) => p.key === n.key);
        return { key: n.key, icon: pn?.icon || "puzzle", label: n.label || pn?.title || t("settings.appearance.plugin.genericLabel"), plugin: pn };
      }
      const nativeKey = n.key as keyof typeof NAV_ITEM_META;
      return { key: n.key, icon: NAV_ITEM_META[nativeKey].icon, label: n.label || navItemLabel(nativeKey, lang), plugin: undefined };
    });
  const currentKey = activePluginKey ?? view;
  const idx = mainNav.findIndex((n) => n.key === currentKey);
  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        padding: "var(--pad-zone)",
        borderRadius: "var(--r-lg)",
        // зональная прозрачность: своя плотность поверхности + blur (вкл. зонами)
        background: "var(--glass-sidebar, var(--surface-1))",
        backdropFilter: "var(--bf-zone, none)",
        WebkitBackdropFilter: "var(--bf-zone, none)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-1) var(--sp-3) var(--sp-5)" }}>
        <img src={glyph} alt="" style={{ width: 26, height: 30 }} />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 19,
            letterSpacing: "var(--ls-display)",
            color: "var(--text-1)",
          }}
        >
          Muza
        </span>
      </div>
      <nav style={{ position: "relative", display: "flex", flexDirection: "column", gap: NAV_GAP }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: NAV_H,
            borderRadius: "var(--r-sm)",
            background: "var(--surface-4)",
            transform: `translateY(${Math.max(idx, 0) * (NAV_H + NAV_GAP)}px)`,
            opacity: idx >= 0 ? 1 : 0,
            transition: "transform var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)",
          }}
        ></div>
        {mainNav.map((n) => (
          <NavItem
            key={n.key}
            icon={n.icon}
            label={n.label}
            quiet
            active={currentKey === n.key}
            onClick={() =>
              n.plugin ? onSelectPluginTab?.(n.plugin.pluginId, n.plugin.tabId) : setView(n.key as View)
            }
          />
        ))}
      </nav>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--sp-5) var(--sp-3) var(--sp-2)",
        }}
      >
        <span
          style={{
            fontSize: "var(--fs-caption)",
            fontWeight: 600,
            letterSpacing: "var(--ls-caps)",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          {t("sidebar.playlistsHeading")}
        </span>
        <Tooltip label={t("sidebar.newPlaylistTooltip")}>
          <IconButton
            icon="plus"
            size="sm"
            label={t("sidebar.createPlaylistAria")}
            style={{ width: 28, height: 28 }}
            iconSize={16}
            onClick={onCreatePlaylist}
          />
        </Tooltip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", scrollbarWidth: "none" }}>
        {playlists.map((p) => (
          <PlaylistRow
            key={p.id}
            cover={p.cover}
            name={p.name}
            meta={p.meta}
            shared={p.shared}
            onClick={() => onOpenPlaylist(p.id)}
            onMenu={onPlaylistMenu ? (e) => onPlaylistMenu(p, e) : undefined}
            onDropTrack={onDropTrack ? (trackId) => onDropTrack(p.id, trackId) : undefined}
          />
        ))}
      </div>
      <div style={{ marginTop: "auto" }}>
        {isAdmin ? (
          <NavItem icon="shield" label={t("sidebar.admin")} active={view === "admin"} onClick={() => setView("admin")} />
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NavItem icon="settings" label={t("settings.title")} active={view === "settings"} onClick={() => setView("settings")} />
          </div>
          <Tooltip label={t("sidebar.hotkeysTooltip")}>
            <IconButton
              icon="circle-help"
              size="sm"
              label={t("sidebar.hotkeysAria")}
              style={{ width: 28, height: 28 }}
              iconSize={16}
              onClick={onOpenHotkeys}
            />
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
