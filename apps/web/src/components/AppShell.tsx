"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Badge, Button, Cover, Dialog, Icon, SearchInput } from "@muza/ui";
import { pickRandomPlaylistIcon, playlistIconSrc } from "@muza/core";
import { ApiError, type PlaylistMeta } from "@muza/api-client";
import { useT } from "@muza/app";
import { moveItem } from "@muza/app/lib/dragEngine";
import { DragLayer } from "@muza/app/shell/DragLayer";
import { Sidebar, type SidebarPlaylist } from "@muza/app/shell/Sidebar";
import { getApi } from "../api";
import { useLikes } from "../likes";
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
 *  Режимы шелла (медиа-ветки — globals.css → «Брейкпоинты»; DOM один на все
 *  режимы, переключает только CSS): ≥1200px — сайдбар + контент + «Сейчас
 *  играет» (автооткрытие); 900–1199px и планшет-портрет 700–899px — сайдбар +
 *  контент; телефон-портрет — нижняя навигация + мини-бар + полноэкранный
 *  now-playing; ландшафт высотой ≤480px — .bottomnav превращается в левый
 *  иконный рельс, мини-бар ужат.
 *
 *  Э3 веб-паритета (2026-08-02): боковая панель больше НЕ своя — это общая
 *  @muza/app/shell/Sidebar, та же, что в приложении. Вместе с ней приехало то,
 *  чего в вебе не было вообще: порядок плейлистов перетаскиванием за ручку-⠿
 *  (жест на Pointer Events — работает и пальцем), закреплённые с булавкой,
 *  подписки, приём трека на «Любимое» и подсветка цели. Плашка «Web» осталась
 *  (просил владелец) — теперь пропом. */

/* «Любимое» — НЕ пункт навигации, а особая первая строка блока плейлистов
   (её рисует общая панель) — паритет шелла 2026-07-21. Подписи — media.nav.*
   (реюз десктопного словаря, И5-веб 22.07). Иконки и ключи те же, что у
   компоновки приложения (lib/navItems.ts NAV_ITEM_META), чтобы активная
   вкладка выглядела одинаково в обоих клиентах. */
const NAV_KEYS = [
  { href: "/home", icon: "home", labelKey: "home" as const },
  { href: "/search", icon: "search", labelKey: "search" as const },
  { href: "/library", icon: "library-big", labelKey: "library" as const },
  { href: "/stats", icon: "chart-line", labelKey: "stats" as const },
];

/** Заливаемые глифы активной вкладки — зеркало NAV_FILLABLE десктопа: lucide
 *  рисует штрихом, активная вкладка — ЗАЛИТАЯ. Остался ради НИЖНЕЙ навигации
 *  (телефон): у боковой панели это правило теперь своё, внутри @muza/app. */
const NAV_FILLABLE = new Set(["heart", "home", "house", "library-big", "library"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, ready } = useSession();
  const { prefs, set } = usePrefs();
  const { current } = usePlayer();
  const { favorites } = useLikes();
  const { playlists, refresh: reloadPlaylists } = usePlaylists();
  const notify = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();
  const [mobileNp, setMobileNp] = useState(false);
  /** Порядок плейлистов, применённый оптимистично (перетаскиванием), пока
   *  сервер не ответил. null — показываем то, что дал контекст. Провайдер
   *  плейлистов общий на весь веб и своего «переставить» не умеет; заводить
   *  его ради одного жеста не стали — копия живёт ровно здесь и умирает, как
   *  только список перечитан с сервера (эффект ниже). */
  const [optimistic, setOptimistic] = useState<PlaylistMeta[] | null>(null);
  useEffect(() => setOptimistic(null), [playlists]);
  const list = optimistic ?? playlists;
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  /** Пункт «Админка» в панели — только если сервер подтвердил права. Спросить
   *  СЕРВЕР, а не смотреть на поле сессии: страница /admin и каждый её запрос
   *  всё равно охраняются сервером, и второй источник правды тут только мешал
   *  бы разъезжаться. Ровно так же это устроено в приложении (App.tsx →
   *  isAdmin). Отказ = «не админ»: показать пункт, ведущий на редирект, хуже,
   *  чем не показать вовсе (правило умений площадки — нет умения, нет пункта,
   *  а не серый). */
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      return;
    }
    let alive = true;
    getApi()
      .adminPing()
      .then((ok) => {
        if (alive) setIsAdmin(ok);
      })
      .catch(() => {
        if (alive) setIsAdmin(false);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  /** Строки панели: ровно та же раскладка признаков, что в приложении
   *  (App.tsx → sidebarPlaylists). fixed = «в перетаскивание не входит»:
   *  у подписок сервер не хранит позиций, а смысл закрепа — «случайно не
   *  сдвинуть». */
  const sidebarPlaylists: SidebarPlaylist[] = list.map((p) => ({
    id: p.id,
    name: p.name,
    meta:
      p.role === "follower"
        ? p.available === false
          ? t("sidebar.playlistMeta.hiddenByOwner")
          : t("sidebar.playlistMeta.followedFrom", { count: p.trackCount, owner: p.ownerUsername })
        : p.role === "collaborator"
          ? t("sidebar.playlistMeta.collabFrom", { count: p.trackCount, owner: p.ownerUsername })
          : p.collaboratorsCount > 0
            ? t("sidebar.playlistMeta.shared", { count: p.trackCount })
            : t("sidebar.playlistMeta.trackCount", { count: p.trackCount }),
    shared: p.role === "collaborator" || p.collaboratorsCount > 0,
    fixed: p.role === "follower" || p.pinned,
    pinned: p.pinned,
    dimmed: p.role === "follower" && p.available === false,
    cover: p.iconCoverUrl ?? playlistIconSrc(p.icon) ?? undefined,
  }));

  /** Трек уронили на плейлист панели (перетаскиванием из любого списка). */
  const dropOnPlaylist = async (playlistId: string, trackId: string) => {
    const pl = list.find((p) => p.id === playlistId);
    if (!pl) return;
    try {
      await getApi().addPlaylistTrack(playlistId, trackId);
      notify(t("toast.playlist.addedTrack", { name: pl.name }), "list-music");
      void reloadPlaylists();
    } catch (err) {
      notify(err instanceof Error ? err.message : t("toast.playlist.addFailed"), "x");
    }
  };

  /** Новый порядок плейлистов после перетаскивания за ручку-⠿.
   *
   *  ⚠️ toIndex приходит в координатах УРЕЗАННОГО списка: в перетаскивание
   *  панель отдаёт только подвижные строки (подписки и закреплённые
   *  исключены). Складывать его с позицией из ПОЛНОГО списка нельзя — промах
   *  равен числу исключённых, а закреплённые всегда сверху, так что промах
   *  гарантирован: сдвиг на позицию молча не даёт ничего, а испорченный
   *  порядок уходит на сервер и переживает перезапуск. Ровно эту ошибку
   *  чинили в приложении 2026-08-02 (App.tsx → reorderPlaylists) — здесь она
   *  не повторяется by design. */
  const reorderPlaylists = async (draggedId: string, toIndex: number) => {
    const movable = list.filter((p) => p.role !== "follower" && !p.pinned);
    const from = movable.findIndex((p) => p.id === draggedId);
    if (from < 0 || from === toIndex || toIndex < 0 || toIndex >= movable.length) return;
    const moved = moveItem(movable, from, toIndex);
    // Неподвижные остаются на СВОИХ местах в общем списке, подвижные
    // перетасовываются только между своими слотами.
    let k = 0;
    const next = list.map((p) => (p.role !== "follower" && !p.pinned ? moved[k++] : p));
    setOptimistic(next);
    try {
      await getApi().reorderPlaylists(next.map((p) => p.id));
    } catch {
      void reloadPlaylists(); // не сохранилось — вернём серверный порядок
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreateName("");
  };

  /** Создание с «+» у заголовка списка — как в приложении. Логика та же, что
   *  на странице библиотеки: случайная свободная иконка, затем переход в
   *  созданный плейлист. */
  const createPlaylist = async () => {
    const name = createName.trim();
    if (!name) return;
    setCreateBusy(true);
    try {
      const used = list.map((p) => p.icon).filter((v): v is string => Boolean(v));
      const created = await getApi().createPlaylist(name, pickRandomPlaylistIcon(used));
      await reloadPlaylists();
      closeCreate();
      router.push(`/playlist?id=${created.id}`);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("toast.playlist.createFailed"), "x");
    } finally {
      setCreateBusy(false);
    }
  };

  if (!ready || !session) {
    return <div style={{ position: "fixed", inset: 0, background: "var(--bg-0)" }} />;
  }

  const npVisible = prefs.npOpen && Boolean(current);

  return (
    // Э1: data-accent/тема теперь на общем ThemeRoot (providers.tsx), не здесь.
    // DragLayer — слой внутреннего переноса (превью под курсором + реестр зон
    // приёма). Он ОБЯЗАН быть выше панели (её строки — зоны приёма) и выше
    // страниц (их списки — будущие источники переноса). Живёт здесь, а не в
    // layout группы (app): layout — серверный компонент, а слой на хуках.
    <DragLayer>
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
      {/* bgType вместо прежнего веб-поля bgCover (слияние моделей 2026-08-02):
          в общей модели фон — перечисление, и веб применяет из него ровно
          один вариант, «из обложки». Остальные (цвет, градиент, картинка,
          анимированный) профиль хранит, но вкладка их пока не рисует. */}
      {prefs.bgType === "cover" && current?.coverUrl ? (
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
        {/* Сайдбар (≥900px).
            Обёртка нужна ровно за двумя вещами: она — ячейка сетки и она же
            прячет панель на телефоне (.sidebar{display:none} в медиа-ветках).
            Прятать саму панель классом нельзя: её display:flex стоит инлайном
            (она общая и не вправе рассчитывать на чужие классы), а инлайн
            сильнее любого правила таблицы. Свои фон и отступы обёртка гасит —
            панель несёт их сама, иначе была бы двойная рамка. */}
        <div className="zone sidebar" style={{ padding: 0, background: "transparent" }}>
          <Sidebar
            logoSrc="/glyph.svg"
            badge={<Badge>web</Badge>}
            style={{ flex: 1, minHeight: 0 }}
            nav={NAV_KEYS.map((n) => ({ key: n.href, icon: n.icon, label: t(`media.nav.${n.labelKey}`) }))}
            activeNavKey={pathname}
            onSelectNav={(href) => router.push(href)}
            playlists={sidebarPlaylists}
            favoritesCount={favorites.length}
            favoritesActive={pathname === "/favorites"}
            onOpenFavorites={() => router.push("/favorites")}
            onCreatePlaylist={() => setCreateOpen(true)}
            onOpenPlaylist={(id) => router.push(`/playlist?id=${id}`)}
            onDropTrack={(playlistId, trackId) => void dropOnPlaylist(playlistId, trackId)}
            onReorderPlaylists={(id, to) => void reorderPlaylists(id, to)}
            // Мост к HTML5-перетаскиванию: строки треков в вебе пока таскаются
            // им (TrackList.tsx), а не общим pointer-слоем. Когда списки
            // переедут на @muza/app, этот проп можно снять — приём тогда
            // пойдёт по родному пути, как в приложении.
            externalDrop={{
              accepts: (e) => e.dataTransfer.types.includes(TRACK_DND_MIME),
              trackId: (e) => {
                const raw = e.dataTransfer.getData(TRACK_DND_MIME);
                if (!raw) return null;
                try {
                  return (JSON.parse(raw) as { id?: string }).id ?? null;
                } catch {
                  return null;
                }
              },
            }}
            emptyHint={
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", padding: "0 var(--sp-3)" }}>
                {t("web.nav.playlistsEmptyHint")}
              </span>
            }
            // Нет прав — пункта нет вовсе (не серого): панель рисует его
            // ровно по наличию колбэка, как и в приложении.
            onOpenAdmin={isAdmin ? () => router.push("/admin") : undefined}
            adminActive={pathname === "/admin"}
            onOpenSettings={() => router.push("/settings")}
            settingsActive={pathname === "/settings"}
          />
        </div>

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

      <Dialog
        open={createOpen}
        title={t("app.newPlaylistName")}
        onClose={closeCreate}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={closeCreate}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="check" disabled={createBusy || !createName.trim()} onClick={() => void createPlaylist()}>
              {createBusy ? t("common.busy") : t("app.newPlaylistDialog.create")}
            </Button>
          </>
        }
      >
        <div
          style={{ minWidth: 280 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createPlaylist();
          }}
        >
          <SearchInput value={createName} onChange={setCreateName} placeholder={t("common.namePlaceholder")} icon="list-music" autoFocus />
        </div>
      </Dialog>

      {mobileNp ? <MobileNowPlaying onClose={() => setMobileNp(false)} /> : null}
    </div>
    </DragLayer>
  );
}
