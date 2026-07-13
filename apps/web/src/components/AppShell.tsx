"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Badge, Icon } from "@muza/ui";
import type { PlaylistMeta } from "@muza/api-client";
import { getApi } from "../api";
import { usePlayer } from "../player";
import { usePlaylists } from "../playlists";
import { usePrefs } from "../prefs";
import { useSession } from "../session";
import { useToast } from "../toast";
import { MobileNowPlaying } from "./MobileNowPlaying";
import { NowPlayingPanel } from "./NowPlayingPanel";
import { PlayerBar } from "./PlayerBar";
import { TRACK_DND_MIME } from "./TrackList";

/** Каркас залогиненного веба. Живёт в layout группы (app) — плеер НЕ
 *  размонтируется при навигации. Визуальная модель десктопа: сценография
 *  (размытая обложка) → зоны surface-1 → плавающий стеклянный бар.
 *  ≥1200px — сайдбар + контент + «Сейчас играет» (автооткрытие);
 *  <900px — нижняя навигация + мини-бар + полноэкранный now-playing. */

const NAV = [
  { href: "/home", icon: "home", label: "Главная" },
  { href: "/search", icon: "search", label: "Поиск" },
  { href: "/favorites", icon: "heart", label: "Любимое" },
  { href: "/library", icon: "library-big", label: "Библиотека" },
  { href: "/stats", icon: "bar-chart-3", label: "Статистика" },
];

function NavLink({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 48,
        padding: "0 var(--sp-4)",
        borderRadius: "var(--r-sm)",
        background: active ? "var(--surface-4)" : hover ? "var(--surface-2)" : "transparent",
        color: active || hover ? "var(--text-1)" : "var(--text-2)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        fontWeight: active ? 600 : 500,
        textDecoration: "none",
        transition: "background var(--dur-fast) var(--ease-out), color var(--dur-base) var(--ease-out)",
      }}
    >
      <Icon name={icon} size={20} color={active ? "var(--accent-text)" : "currentColor"} />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, ready } = useSession();
  const { prefs, set } = usePrefs();
  const { current } = usePlayer();
  const { playlists, refresh: reloadPlaylists } = usePlaylists();
  const notify = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNp, setMobileNp] = useState(false);
  /** плейлист под перетаскиваемым треком — подсветка drop-таргета */
  const [dropPl, setDropPl] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  /** Drop трека на плейлист сайдбара (DnD из любого списка). */
  const dropOnPlaylist = async (e: React.DragEvent, pl: PlaylistMeta) => {
    e.preventDefault();
    setDropPl(null);
    try {
      const raw = e.dataTransfer.getData(TRACK_DND_MIME);
      if (!raw) return;
      const { id } = JSON.parse(raw) as { id: string };
      await getApi().addPlaylistTrack(pl.id, id);
      notify(`Добавлено в «${pl.name}»`, "list-music");
      void reloadPlaylists();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Не удалось добавить", "x");
    }
  };

  if (!ready || !session) {
    return <div style={{ position: "fixed", inset: 0, background: "var(--bg-0)" }} />;
  }

  const npVisible = prefs.npOpen && Boolean(current);
  const accentAttr = prefs.accent === "blue" ? undefined : prefs.accent;

  return (
    <div className="shell" data-accent={accentAttr}>
      {/* Сценография: фирменный вид Muza — размытая обложка за интерфейсом */}
      {prefs.bgCover && current?.coverUrl ? (
        <>
          <img key={current.coverUrl} src={current.coverUrl} alt="" aria-hidden="true" className="scenery muza-fade" />
          <div className="scenery-dim" aria-hidden="true" />
        </>
      ) : null}

      <div className={npVisible ? "shell-grid with-np" : "shell-grid"}>
        {/* Сайдбар (≥900px) */}
        <aside className="zone sidebar">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-1) var(--sp-3) var(--sp-5)" }}>
            <img src="/glyph.svg" alt="" style={{ width: 24, height: 28 }} />
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
            <Badge>web</Badge>
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {NAV.map((n) => (
              <NavLink key={n.href} {...n} active={pathname === n.href} />
            ))}
          </nav>
          <span
            style={{
              fontSize: "var(--fs-caption)",
              fontWeight: 600,
              letterSpacing: "var(--ls-caps)",
              textTransform: "uppercase",
              color: "var(--text-3)",
              padding: "var(--sp-5) var(--sp-3) var(--sp-2)",
            }}
          >
            Плейлисты
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", minHeight: 0, scrollbarWidth: "none" }}>
            {playlists.length === 0 ? (
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", padding: "0 var(--sp-3)" }}>
                Создаются в приложении
              </span>
            ) : (
              playlists.map((p) => (
                <Link
                  key={p.id}
                  href={`/playlist?id=${p.id}`}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(TRACK_DND_MIME)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setDropPl(p.id);
                  }}
                  onDragLeave={() => setDropPl((v) => (v === p.id ? null : v))}
                  onDrop={(e) => void dropOnPlaylist(e, p)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-3)",
                    padding: "var(--sp-2)",
                    borderRadius: "var(--r-sm)",
                    textDecoration: "none",
                    background: dropPl === p.id ? "var(--accent-soft)" : undefined,
                    outline: dropPl === p.id ? "var(--focus-ring)" : undefined,
                    outlineOffset: -2,
                    transition: "background var(--dur-fast) var(--ease-out)",
                  }}
                >
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
                    <Icon
                      name={p.role === "collaborator" || p.collaboratorsCount > 0 ? "users" : "list-music"}
                      size={18}
                      color="var(--accent-text)"
                    />
                  </span>
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
                      {p.name}
                    </span>
                    <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                      {p.trackCount} трек(ов)
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
          <div style={{ marginTop: "auto", paddingTop: "var(--sp-3)" }}>
            <NavLink href="/settings" icon="settings" label="Настройки" active={pathname === "/settings"} />
          </div>
        </aside>

        {/* Контент */}
        <main key={pathname} className="zone main muza-view">
          {children}
        </main>

        {/* «Сейчас играет» (≥1200px, автооткрытие при старте трека) */}
        {npVisible ? <NowPlayingPanel onClose={() => set({ npOpen: false })} /> : null}
      </div>

      <PlayerBar
        npOpen={prefs.npOpen}
        onToggleNp={() => set({ npOpen: !prefs.npOpen })}
        onOpenMobile={() => setMobileNp(true)}
      />

      {/* Нижняя навигация (<900px) */}
      <nav className="bottomnav" aria-label="Основная навигация">
        {[...NAV, { href: "/settings", icon: "settings", label: "Настройки" }].map((n) => (
          <Link key={n.href} href={n.href} className={pathname === n.href ? "active" : undefined}>
            <Icon name={n.icon} size={22} />
            {n.label}
          </Link>
        ))}
      </nav>

      {mobileNp ? <MobileNowPlaying onClose={() => setMobileNp(false)} /> : null}
    </div>
  );
}
