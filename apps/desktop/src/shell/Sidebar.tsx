import { useState } from "react";
import { Icon, IconButton, Tooltip } from "@muza/ui";
import glyph from "@muza/ui/assets/logo/glyph.svg";
import type { View } from "../types";

/** Пункт списка плейлистов: демо (с обложкой) или серверный (без — плейсхолдер). */
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
}: {
  cover?: string;
  name: string;
  meta: string;
  shared?: boolean;
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
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        border: "none",
        borderRadius: "var(--r-sm)",
        background: hover ? "var(--surface-2)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      {cover ? (
        <img src={cover} alt="" style={{ width: 40, height: 40, borderRadius: "var(--r-xs)", flex: "none" }} />
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
  isAdmin = false,
}: {
  view: View;
  setView: (v: View) => void;
  playlists: SidebarPlaylist[];
  onCreatePlaylist: () => void;
  onOpenPlaylist: (id: string) => void;
  /** Показывает пункт «Админка» (Stage 5); true только после adminPing. */
  isAdmin?: boolean;
}) {
  const mainNav = [
    { key: "home" as const, icon: "home", label: "Главная" },
    { key: "search" as const, icon: "search", label: "Поиск" },
    { key: "favorites" as const, icon: "heart", label: "Любимое" },
    { key: "library" as const, icon: "library-big", label: "Библиотека" },
    { key: "stats" as const, icon: "chart-line", label: "Статистика" },
  ];
  const idx = mainNav.findIndex((n) => n.key === view);
  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        padding: "var(--pad-zone)",
        borderRadius: "var(--r-lg)",
        background: "var(--surface-1)",
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
          <NavItem key={n.key} icon={n.icon} label={n.label} quiet active={view === n.key} onClick={() => setView(n.key)} />
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
          Плейлисты
        </span>
        <Tooltip label="Новый плейлист">
          <IconButton
            icon="plus"
            size="sm"
            label="Создать плейлист"
            style={{ width: 28, height: 28 }}
            iconSize={16}
            onClick={onCreatePlaylist}
          />
        </Tooltip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", scrollbarWidth: "none" }}>
        {playlists.map((p) => (
          <PlaylistRow key={p.id} cover={p.cover} name={p.name} meta={p.meta} shared={p.shared} onClick={() => onOpenPlaylist(p.id)} />
        ))}
      </div>
      <div style={{ marginTop: "auto" }}>
        {isAdmin ? (
          <NavItem icon="shield" label="Админка" active={view === "admin"} onClick={() => setView("admin")} />
        ) : null}
        <NavItem icon="settings" label="Настройки" active={view === "settings"} onClick={() => setView("settings")} />
      </div>
    </aside>
  );
}
