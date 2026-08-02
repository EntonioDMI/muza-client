"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Badge, Cover, Icon } from "@muza/ui";
import type { PlaylistMeta } from "@muza/api-client";
import { useT } from "@muza/app";
import { getApi } from "../api";
import { tracksLabel } from "../format";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { usePlaylists } from "../playlists";
import { usePrefs } from "../prefs";
import { useSession } from "../session";
import { useToast } from "../toast";
import { MobileNowPlaying } from "./MobileNowPlaying";
import { NowPlayingPanel } from "./NowPlayingPanel";
import { PlayerBar } from "./PlayerBar";
import { PlaylistCover } from "./PlaylistCover";
import { TRACK_DND_MIME } from "./TrackList";

/** Каркас залогиненного веба. Живёт в layout группы (app) — плеер НЕ
 *  размонтируется при навигации. Визуальная модель десктопа: сценография
 *  (размытая обложка) → зоны surface-1 → плавающий стеклянный бар.
 *  Режимы шелла (медиа-ветки — globals.css → «Брейкпоинты»; DOM один на все
 *  режимы, переключает только CSS): ≥1200px — сайдбар + контент + «Сейчас
 *  играет» (автооткрытие); 900–1199px и планшет-портрет 700–899px — сайдбар +
 *  контент; телефон-портрет — нижняя навигация + мини-бар + полноэкранный
 *  now-playing; ландшафт высотой ≤480px — .bottomnav превращается в левый
 *  иконный рельс, мини-бар ужат. */

/* «Любимое» — НЕ пункт навигации, а особая первая строка блока плейлистов
   (как FavoritesRow десктопа) — паритет шелла 2026-07-21. Подписи — media.nav.*
   (реюз десктопного словаря, И5-веб 22.07), собираются в AppShell() ниже. */
const NAV_KEYS = [
  { href: "/home", icon: "home", labelKey: "home" as const },
  { href: "/search", icon: "search", labelKey: "search" as const },
  { href: "/library", icon: "library-big", labelKey: "library" as const },
  { href: "/stats", icon: "bar-chart-3", labelKey: "stats" as const },
];

/** Заливаемые глифы активной вкладки — зеркало NAV_FILLABLE десктопа
 *  (lib/navItems.ts): lucide рисует штрихом, активная вкладка — ЗАЛИТАЯ. */
const NAV_FILLABLE = new Set(["heart", "home", "house", "library-big", "library"]);

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
      {/* активная вкладка — залитая иконка, как в десктопе (Sidebar.tsx) */}
      <Icon
        name={icon}
        size={20}
        color={active ? "var(--accent-text)" : "currentColor"}
        filled={active && NAV_FILLABLE.has(icon)}
      />
      {label}
    </Link>
  );
}

/** «Любимое» над плейлистами: сердце на фирменном градиенте глифа —
 *  зеркало FavoritesRow десктопа (Sidebar.tsx:296). */
function FavoritesRow({ count, active }: { count: number; active: boolean }) {
  const { t, lang } = useT();
  const [hover, setHover] = useState(false);
  return (
    <Link
      href="/favorites"
      aria-label={t("media.nav.favorites")}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        borderRadius: "var(--r-sm)",
        textDecoration: "none",
        background: active ? "var(--surface-4)" : hover ? "var(--surface-2)" : "transparent",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--r-xs)",
          // тот же фирменный градиент, что в десктопе и у глифа лого
          background: "linear-gradient(160deg, #F76967 0%, #3B82F6 100%)",
        }}
      >
        <Icon name="heart" size={20} color="#fff" filled />
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body)",
            fontWeight: 500,
            color: "var(--text-1)",
          }}
        >
          {t("media.nav.favorites")}
        </span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
          {tracksLabel(count, lang)}
        </span>
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, ready } = useSession();
  const { prefs, set } = usePrefs();
  const { current } = usePlayer();
  const { favorites } = useLikes();
  const { playlists, refresh: reloadPlaylists } = usePlaylists();
  const notify = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { t, lang } = useT();
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
      notify(t("toast.playlist.addedTrack", { name: pl.name }), "list-music");
      void reloadPlaylists();
    } catch (err) {
      notify(err instanceof Error ? err.message : t("toast.playlist.addFailed"), "x");
    }
  };

  if (!ready || !session) {
    return <div style={{ position: "fixed", inset: 0, background: "var(--bg-0)" }} />;
  }

  const npVisible = prefs.npOpen && Boolean(current);

  return (
    // Э1: data-accent/тема теперь на общем ThemeRoot (providers.tsx), не здесь
    <div className="shell">
      {/* Сценография: фирменный вид Muza — размытая обложка за интерфейсом.
          Картинку рисует Cover ДС, а не голый <img>, и это принципиально.
          Приложение кладёт в фон обложку, УЖЕ прошедшую очистку (canvas-кроп
          в useCoverArt) — то есть квадрат самого арта. Веб очистку не тянет,
          и сырой тумб источника — это кадр 4:3 с полями сверху и снизу: на
          узком окне object-fit их не срезает, и по краям экрана проступала
          тёмная кайма, которой в приложении нет. Cover доворачивает геометрию
          сам и знает, какие варианты ссылок трогать нельзя, — знание остаётся
          в одном месте, копии регулярки в вебе не заводим.
          Квадрат max(120vw,120vh) центрирован в .scenery: он заведомо
          перекрывает окно с тем же запасом ±10%, что был у прежнего <img>,
          и виден ровно центральный кроп арта — как в приложении. */}
      {prefs.bgCover && current?.coverUrl ? (
        <>
          {/* overflow скрыт не для вида, а ради размытия: без него браузер
              растрирует и размывает весь квадрат целиком (на широком окне это
              заметно больше пикселей, чем видно). Обрезка идёт по рамке
              .scenery — она на 10% больше окна с каждой стороны, так что край
              размытия остаётся за экраном, как и раньше. */}
          <div className="scenery" aria-hidden="true" style={{ overflow: "hidden" }}>
            <Cover
              key={current.coverUrl}
              src={current.coverUrl}
              size="max(120vw, 120vh)"
              radius="0"
              className="muza-fade"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                // без заливки: пока картинка грузится, фон окна остаётся своим,
                // а не мигает на весь экран подложкой обложки
                background: "transparent",
              }}
            />
          </div>
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
            {NAV_KEYS.map((n) => (
              <NavLink key={n.href} href={n.href} icon={n.icon} label={t(`media.nav.${n.labelKey}`)} active={pathname === n.href} />
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
            {t("sidebar.playlistsHeading")}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", minHeight: 0, scrollbarWidth: "none" }}>
            {/* «Любимое» — всегда первой строкой, как в приложении */}
            <FavoritesRow count={favorites.length} active={pathname === "/favorites"} />
            {playlists.length === 0 ? (
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", padding: "0 var(--sp-3)" }}>
                {t("web.nav.playlistsEmptyHint")}
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
                  <PlaylistCover
                    icon={p.icon}
                    coverUrl={p.iconCoverUrl}
                    shared={p.role === "collaborator" || p.collaboratorsCount > 0}
                    size={40}
                    iconSize={18}
                  />
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
                      {tracksLabel(p.trackCount, lang)}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
          <div style={{ marginTop: "auto", paddingTop: "var(--sp-3)" }}>
            <NavLink href="/settings" icon="settings" label={t("settings.title")} active={pathname === "/settings"} />
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

      {/* Нижняя навигация (<900px): «Любимое» здесь остаётся пунктом —
          сайдбара с FavoritesRow на телефоне нет */}
      <nav className="bottomnav" aria-label={t("web.nav.bottomNavAria")}>
        {[
          { href: NAV_KEYS[0].href, icon: NAV_KEYS[0].icon, label: t(`media.nav.${NAV_KEYS[0].labelKey}`) },
          { href: NAV_KEYS[1].href, icon: NAV_KEYS[1].icon, label: t(`media.nav.${NAV_KEYS[1].labelKey}`) },
          { href: "/favorites", icon: "heart", label: t("media.nav.favorites") },
          { href: NAV_KEYS[2].href, icon: NAV_KEYS[2].icon, label: t(`media.nav.${NAV_KEYS[2].labelKey}`) },
          { href: NAV_KEYS[3].href, icon: NAV_KEYS[3].icon, label: t(`media.nav.${NAV_KEYS[3].labelKey}`) },
          { href: "/settings", icon: "settings", label: t("settings.title") },
        ].map((n) => (
          <Link key={n.href} href={n.href} className={pathname === n.href ? "active" : undefined}>
            <Icon name={n.icon} size={22} filled={pathname === n.href && NAV_FILLABLE.has(n.icon)} />
            {n.label}
          </Link>
        ))}
      </nav>

      {mobileNp ? <MobileNowPlaying onClose={() => setMobileNp(false)} /> : null}
    </div>
  );
}
