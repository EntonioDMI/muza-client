"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Badge, Button, Cover, Dialog, Icon, SearchInput } from "@muza/ui";
import { pickRandomPlaylistIcon, playlistIconSrc } from "@muza/core";
import { ApiError } from "@muza/api-client";
import { useT } from "@muza/app";
import { ContextMenuProvider, type ContextMenuApi, type MenuAbilities } from "@muza/app/shell/ContextMenu";
import { DragLayer } from "@muza/app/shell/DragLayer";
import { useLayout } from "@muza/app/shell/LayoutContext";
import { Sidebar, type SidebarPlaylist } from "@muza/app/shell/Sidebar";
import { BottomNav, NavRail, ShellDrawer, type NavEntry } from "./ShellNav";
import { getApi } from "../api";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { usePlayPlaylist, usePlaylists } from "../playlists";
import { usePrefs } from "../prefs";
import { useSession } from "../session";
import { useToast } from "../toast";
import { ListeningModeHost } from "./ListeningModeHost";
import { MobileNowPlaying } from "./MobileNowPlaying";
import { NowPlayingPanel } from "./NowPlayingPanel";
import { PlayerBar } from "./PlayerBar";

/** Каркас залогиненного веба. Живёт в layout группы (app) — плеер НЕ
 *  размонтируется при навигации. Визуальная модель десктопа: сценография
 *  (размытая обложка) → зоны surface-1 → плавающий стеклянный бар.
 *  Режимы шелла (медиа-ветки — globals.css → «Брейкпоинты»; DOM один на все
 *  режимы, переключает только CSS): ≥1200px — сайдбар + контент + «Сейчас
 *  играет» (автооткрытие); 900–1199px и планшет-портрет 700–899px — сайдбар +
 *  контент; телефон-портрет — нижняя навигация + мини-бар + полноэкранный
 *  now-playing; ландшафт высотой ≤480px — .bottomnav превращается в левый
 *  иконный рельс, мини-бар ужат.
 *  Поверх любого широкого режима может подняться караоке во весь экран
 *  (ListeningModeHost) — тот же общий оверлей, что в приложении; на телефоне
 *  его роль играет MobileNowPlaying.
 *
 *  Э3 веб-паритета (2026-08-02): боковая панель больше НЕ своя — это общая
 *  @muza/app/shell/Sidebar, та же, что в приложении. Вместе с ней приехало то,
 *  чего в вебе не было вообще: порядок плейлистов перетаскиванием за ручку-⠿
 *  (жест на Pointer Events — работает и пальцем), закреплённые с булавкой,
 *  подписки и подсветка цели. Плашка «Web» осталась (просил владелец) — теперь
 *  пропом.
 *
 *  ХВОСТЫ ПАРИТЕТА, ЗАКРЫТЫЕ 2026-08-03. Оба — не «решение веба», а пропущенные
 *  пропы: панель рисует умение ровно по наличию колбэка, и без него молчит.
 *  - `onDropTrackOnFavorites` — без него строка «Любимое» не была зоной приёма
 *    вовсе, и трек на неё уронить было нельзя (шапка обещала обратное, что и
 *    сбивало с толку);
 *  - `onPlaylistMenu` — правой кнопки у плейлистов панели не было, хотя все
 *    четыре пункта (переименовать/удалить/закрепить/отписаться) — чистые
 *    серверные вызовы, доступные браузеру наравне с приложением. */

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, ready } = useSession();
  const { prefs, set } = usePrefs();
  const { current } = usePlayer();
  const { likedIds, favorites, refresh: reloadLikes } = useLikes();
  const { playlists, refresh: reloadPlaylists, reorder: reorderPlaylists } = usePlaylists();
  const playPlaylist = usePlayPlaylist();
  const notify = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();
  const layout = useLayout();
  /** Ящик («бургер»): один на телефон и планшет. Закрывается сам при смене
   *  адреса — иначе после тапа по плейлисту он остался бы висеть поверх уже
   *  открытого экрана. */
  const [drawer, setDrawer] = useState(false);
  const [mobileNp, setMobileNp] = useState(false);
  /** Ссылки на «открыть/закрыть» держим СТАБИЛЬНЫМИ: MobileNowPlaying берёт
   *  onClose в зависимости сразу двух эффектов — слушателя Esc и «очередь
   *  кончилась, закрываемся сами». Со стрелкой, рождённой в рендере, оба
   *  переподписывались при каждой перерисовке оболочки (а её дёргает любая
   *  смена трека, настройки и списка плейлистов), то есть окно теряло и
   *  заводило глобальный слушатель клавиатуры вхолостую. */
  const openMobileNp = useCallback(() => setMobileNp(true), []);
  const closeMobileNp = useCallback(() => setMobileNp(false), []);
  /** Полноэкранный режим прослушивания (караоке) — как `expanded` в
   *  приложении: состояние живёт в оболочке, потому что вход даёт полоса
   *  плеера, а сцена накрывает всё окно целиком. На телефоне не включается —
   *  там полный экран это MobileNowPlaying (см. ListeningModeHost.tsx). */
  const [listening, setListening] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  /** Контекст-меню плейлиста панели: открывается ИЗ обработчика, а не из
   *  дерева, поэтому через apiRef — тот же приём, что у App.tsx приложения
   *  (он тоже снаружи собственного провайдера). */
  const menuApiRef = useRef<ContextMenuApi<MenuAbilities> | null>(null);
  const [plRename, setPlRename] = useState<{ id: string; name: string } | null>(null);
  const [plRenameValue, setPlRenameValue] = useState("");
  const [plDelete, setPlDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  // Ушли на другой экран — ящик закрылся. Тап по плейлисту внутри ящика иначе
  // оставлял бы шторку поверх только что открытого списка.
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  // Раскладка стала широкой (поворот планшета, растянутое окно) — ящику там
  // нечего показывать: полный сайдбар уже стоит в сетке.
  useEffect(() => {
    if (layout.desktop) setDrawer(false);
  }, [layout.desktop]);

  /** ⚠️ ЖИВАЯ ВЫСОТА ОКНА — ЛЕЧЕНИЕ ЖАЛОБЫ «на iPhone снизу пустое место».
   *  Разбор механизма — в globals.css, раздел «Высота окна»: у Safari
   *  начальный содержащий блок равен экрану с УБРАННЫМИ панелями браузера, и
   *  каркас на `inset: 0` оказывается выше видимой области. Здесь мы меряем
   *  видимую высоту сами и кладём её в --app-vh; CSS предпочитает эту
   *  переменную своим 100dvh.
   *
   *  Берётся `innerHeight`, а не `visualViewport.height`: второй сжимается
   *  вместе с экранной клавиатурой, и весь каркас прыгал бы при вводе в
   *  поиске. Слушаем ещё и `visualViewport.resize` — на iOS смена состояния
   *  панелей браузера меняет innerHeight, но события `resize` у окна при этом
   *  может не быть. */
  useEffect(() => {
    const apply = () => {
      document.documentElement.style.setProperty("--app-vh", `${window.innerHeight}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, []);

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
  const sidebarPlaylists: SidebarPlaylist[] = playlists.map((p) => ({
    id: p.id,
    name: p.name,
    // Число треков — тихой цифрой справа (count), meta осталась только там,
    // где есть что сказать СВЕРХ числа — ровно как в App.tsx (04.08).
    meta:
      p.role === "follower"
        ? p.available === false
          ? t("sidebar.playlistMeta.hiddenByOwner")
          : t("sidebar.playlistMeta.followedFrom", { count: p.trackCount, owner: p.ownerUsername })
        : p.role === "collaborator"
          ? t("sidebar.playlistMeta.collabFrom", { count: p.trackCount, owner: p.ownerUsername })
          : p.collaboratorsCount > 0
            ? t("sidebar.playlistMeta.shared", { count: p.trackCount })
            : "",
    count: p.trackCount,
    shared: p.role === "collaborator" || p.collaboratorsCount > 0,
    fixed: p.role === "follower" || p.pinned,
    pinned: p.pinned,
    dimmed: p.role === "follower" && p.available === false,
    cover: p.iconCoverUrl ?? playlistIconSrc(p.icon) ?? undefined,
  }));

  /** Трек уронили на плейлист панели (перетаскиванием из любого списка). */
  const dropOnPlaylist = async (playlistId: string, trackId: string) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    try {
      await getApi().addPlaylistTrack(playlistId, trackId);
      notify(t("toast.playlist.addedTrack", { name: pl.name }), "list-music");
      void reloadPlaylists();
    } catch (err) {
      notify(err instanceof Error ? err.message : t("toast.playlist.addFailed"), "x");
    }
  };

  /** Трек уронили на «Любимое».
   *
   *  НЕ toggleLike: тот переключает, а перенос — жест «положить сюда». Бросок
   *  уже любимого трека снимал бы лайк, то есть трек исчезал бы ровно тем
   *  движением, которым его кладут (урок приложения 2026-07-20,
   *  apps/desktop/src/shell/favoritesDrop.ts). Модуль оттуда не переиспользуем:
   *  он живёт в приложении, а не в общем пакете, и правило короче импорта.
   *
   *  Лайк веба (likes.tsx → toggle) принимает трек ЦЕЛИКОМ — он же кладёт его
   *  в список оптимистично, — а слой переноса отдаёт зоне только id с подписью.
   *  Поэтому здесь прямой серверный путь и перечитка: собирать половинчатый
   *  Track из полей превью значило бы класть в «Любимое» огрызок. */
  const dropOnFavorites = (trackId: string) => {
    if (likedIds.has(trackId)) {
      notify(t("toast.favorites.already"), "heart");
      return;
    }
    getApi()
      .addFavorite(trackId)
      .then(() => reloadLikes())
      .then(() => notify(t("toast.favorites.added"), "heart"))
      .catch(() => notify(t("toast.favorites.syncFailed"), "x"));
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
      const used = playlists.map((p) => p.icon).filter((v): v is string => Boolean(v));
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

  /** Закреп плейлиста СВЕРХУ СПИСКА (не офлайн-пин): PATCH и перечитка.
   *  Порядок пересобирает сервер — своего правила сортировки веб не заводит,
   *  иначе список после перечитки прыгал бы. */
  const togglePinned = async (id: string) => {
    const pl = playlists.find((p) => p.id === id);
    if (!pl) return;
    try {
      await getApi().setPlaylistPinned(id, !pl.pinned);
      await reloadPlaylists();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("views.search.somethingWrong"), "x");
    }
  };

  const renameFromMenu = async () => {
    const target = plRename;
    const name = plRenameValue.trim();
    if (!target || !name) return;
    setPlRename(null);
    try {
      await getApi().renamePlaylist(target.id, name);
      await reloadPlaylists();
      notify(t("toast.playlist.renamed"), "pencil");
    } catch (e) {
      notify(e instanceof Error ? e.message : t("toast.playlist.renameFailed"), "x");
    }
  };

  /** Удаление после подтверждения. Открытая страница удалённого плейлиста
   *  уводится в медиатеку — иначе она осталась бы висеть с ошибкой загрузки
   *  (в приложении ровно то же, App.tsx → deleteFromMenu). */
  const deleteFromMenu = async () => {
    const target = plDelete;
    if (!target) return;
    setPlDelete(null);
    try {
      await getApi().deletePlaylist(target.id);
      await reloadPlaylists();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("toast.playlist.deleteFailed"), "x");
      return;
    }
    notify(t("toast.playlist.deleted"), "trash-2");
    // id открытого плейлиста читаем из адреса, а НЕ через useSearchParams:
    // хук требует Suspense, а оболочка — общий layout всей группы (app), и
    // заворачивать в него весь сайт ради одной строки нельзя. Здесь мы уже в
    // обработчике клика, то есть заведомо в браузере.
    if (pathname === "/playlist" && new URLSearchParams(window.location.search).get("id") === target.id) {
      router.replace("/library");
    }
  };

  /** Отписка: уходит «ссылка» из библиотеки, сам плейлист у владельца цел. */
  const unfollowFromMenu = async (target: { id: string; name: string }) => {
    try {
      await getApi().unfollowPlaylist(target.id);
      await reloadPlaylists();
      notify(t("views.search.publicPlaylist.removed"), "list-x");
    } catch (e) {
      notify(e instanceof Error ? e.message : t("views.search.somethingWrong"), "x");
    }
  };

  /** Умения меню ОБОЛОЧКИ: плейлисты боковой панели + текст песни (панель
   *  «Сейчас играет» и караоке живут здесь же, внутри этого провайдера).
   *  Ровно то, что браузер УМЕЕТ: все пункты — серверные вызовы либо буфер
   *  обмена. Чего нет (очередь-вставка, «сохранить офлайн», иконка плейлиста,
   *  плагины) — того в меню и не появляется: набор собирается по наличию поля
   *  (menuActions.ts). */
  const shellMenuAbilities: MenuAbilities = {
    openPlaylist: (id) => router.push(`/playlist?id=${id}`),
    playlistRole: (id) => playlists.find((p) => p.id === id)?.role ?? "owner",
    playPlaylist: (id) => void playPlaylist(id),
    playlistPinned: (id) => playlists.find((p) => p.id === id)?.pinned ?? false,
    togglePlaylistPinned: (id) => void togglePinned(id),
    renamePlaylist: (pl) => {
      setPlRenameValue(pl.name);
      setPlRename(pl);
    },
    deletePlaylist: (pl) => setPlDelete(pl),
    unfollowPlaylist: (pl) => void unfollowFromMenu(pl),
    // Буфер обмена — навигаторский, как в приложении (там тоже не плагин Tauri,
    // а navigator.clipboard: паттерн ShareDialog).
    copyText: (text, doneToast) => {
      navigator.clipboard
        .writeText(text)
        .then(() => notify(doneToast, "copy"))
        .catch(() => notify(t("dialogs.copyFailed"), "x"));
    },
  };

  if (!ready || !session) {
    return <div style={{ position: "fixed", inset: 0, background: "var(--bg-0)" }} />;
  }

  // Панель «Сейчас играет» стоит ВСЕГДА, как в приложении: там это зона
  // раскладки, а не всплывающее окно, и пустой она показывает «Ничего не
  // играет». Пряталась она здесь по двум условиям сразу — и по настройке, и по
  // наличию трека, — из-за чего у человека без музыки правая треть экрана
  // просто исчезала, а раскладка прыгала на первом же клике (замечание
  // владельца 02.08). Настройку оставляем: кто её выключил — тот выключил.
  //
  // …кроме экрана настроек. Он единственный сам по себе двухколоночный
  // (рельс разделов + панель) и меряет себя container query по СВОЕЙ ширине —
  // отобранные панелью 340px роняли его в узкий режим: рельс схлопывался в
  // иконки, ряды настроек ломались в две строки. Замер 02.08: центральная зона
  // на /settings — 864px в вебе против 1216px в приложении, и это была самая
  // крупная оставшаяся разница между клиентами. В приложении ровно то же
  // правило и по той же причине (App.tsx → showNowPlaying: `view !==
  // "settings"`). Слушать музыку и крутить настройки одновременно не сценарий:
  // что играет, видно в полосе плеера снизу, она никуда не делась.
  //
  // Два РАЗНЫХ вопроса, и путать их нельзя: npAllowed — «панель на этом экране
  // вообще бывает», npVisible — «раскрыта прямо сейчас». Полоса плеера
  // получала сырую НАСТРОЙКУ prefs.npOpen, поэтому на /settings её кнопка
  // «Сейчас играет» горела нажатой и по нажатию не показывала ничего.
  //
  // ⚠️ Третье условие с 10.08 — РАЗМЕР. Панель занимает 340px, и на планшете
  // (768–1199) она оставляла контенту меньше половины строки; на телефоне её
  // роль и раньше играл полноэкранный now-playing. Раньше это решал только
  // CSS (`display: none !important`), то есть узел строился и считался зря, а
  // кнопка панели в полосе плеера горела нажатой, ничего не показывая, — ровно
  // тот же дефект, что уже чинили для /settings.
  const npAllowed = pathname !== "/settings" && layout.desktop;
  const npVisible = prefs.npOpen && npAllowed;

  /** Пункты навигации узких раскладок. «Любимое» здесь ПУНКТ (в отличие от
   *  сайдбара, где это особая первая строка блока плейлистов): в ящик за ним
   *  ходить дороже, чем он того стоит, — это второй по частоте экран. */
  const compactNav: NavEntry[] = [
    { href: "/home", icon: "home", label: t("media.nav.home") },
    { href: "/search", icon: "search", label: t("media.nav.search") },
    { href: "/favorites", icon: "heart", label: t("media.nav.favorites") },
    { href: "/library", icon: "library-big", label: t("media.nav.library") },
  ];
  // Планшетному рельсу вертикали хватает — статистика и настройки остаются на
  // виду и не прячутся за бургер, как на телефоне.
  const railNav: NavEntry[] = [
    ...compactNav,
    { href: "/stats", icon: "chart-line", label: t("media.nav.stats") },
    { href: "/settings", icon: "settings", label: t("settings.title") },
  ];

  /** Сайдбар собирается ОДИН раз и встаёт либо в сетку (десктоп), либо в ящик
   *  (телефон и планшет). Два места — но никогда одновременно: `layout` —
   *  перечисление, и ветки взаимно исключены. Копия пропов здесь была бы
   *  двадцатью строками, которые разъедутся на первой же новой возможности
   *  панели. */
  const sidebarNode = (
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
      onPlaylistMenu={(p, e) => menuApiRef.current?.openMenu(e, { kind: "playlist", id: p.id, name: p.name })}
      onDropTrack={(playlistId, trackId) => void dropOnPlaylist(playlistId, trackId)}
      onDropTrackOnFavorites={dropOnFavorites}
      onReorderPlaylists={(id, to) => void reorderPlaylists(id, to)}
      // externalDrop (мост к HTML5-перетаскиванию) здесь БЫЛ и снят
      // 2026-08-03 вместе со своим единственным источником: списки веба
      // переехали на общие экраны @muza/app и таскают строки родным
      // pointer-слоем (DragLayer выше), как приложение. Мост без
      // источника ничего не принимал — только обещал приём в разметке.
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
  );

  return (
    // Э1: data-accent/тема теперь на общем ThemeRoot (providers.tsx), не здесь.
    // DragLayer — слой внутреннего переноса (превью под курсором + реестр зон
    // приёма). Он ОБЯЗАН быть выше панели (её строки — зоны приёма) и выше
    // страниц (их списки — будущие источники переноса). Живёт здесь, а не в
    // layout группы (app): layout — серверный компонент, а слой на хуках.
    <DragLayer>
    {/* Провайдер меню ОБОЛОЧКИ: правая кнопка по плейлистам боковой панели и
        по тексту песни (панель «Сейчас играет», караоке). Страницы держат свой
        (у них другие умения: треки, плитки), и вложенность здесь безобидна —
        каждый провайдер рисует свой <Menu>, а оболочка открывает СВОЙ через
        apiRef, будучи снаружи собственного дерева, как App.tsx приложения.
        suppressNativeMenu={false}: у браузера своё меню, на сайте отбирать его
        целиком нельзя — строки гасят нативное меню сами. */}
    <ContextMenuProvider ctx={shellMenuAbilities} apiRef={menuApiRef} suppressNativeMenu={false}>
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
          РАЗМЕР КВАДРАТА — по тому же правилу, что запас рамки .scenery: окно
          по большей стороне ПЛЮС шесть радиусов размытия (по три с каждой
          стороны, столько гаусс гасит внутрь). Прежние max(120vw,120vh) на
          телефоне были меньше рамки — картинка не доставала до её краёв, и
          размытие тянуло прозрачность уже от СВОЕЙ кромки, у самого экрана.
          Виден по-прежнему центральный кроп арта — как в приложении. */}
      {/* bgType вместо прежнего веб-поля bgCover (слияние моделей 2026-08-02):
          в общей модели фон — перечисление, и веб применяет из него ровно
          один вариант, «из обложки». Остальные (цвет, градиент, картинка,
          анимированный) профиль хранит, но вкладка их пока не рисует. */}
      {prefs.bgType === "cover" && current?.coverUrl ? (
        <>
          {/* overflow скрыт не для вида, а ради размытия: без него браузер
              растрирует и размывает весь квадрат целиком (на широком окне это
              заметно больше пикселей, чем видно). Обрезка идёт по рамке
              .scenery — она выходит за окно на три радиуса размытия, так что
              его край остаётся за экраном (см. globals.css → .scenery). */}
          <div className="scenery" aria-hidden="true" style={{ overflow: "hidden" }}>
            <Cover
              key={current.coverUrl}
              src={current.coverUrl}
              size="calc(max(100vw, 100vh) + 6 * var(--blur-scenery))"
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
        {/* Одна ячейка — три содержимых. Десктоп получает полный сайдбар,
            планшет — иконный рельс той же ячейкой (сетка меняет только ширину
            колонки, контент вбок не прыгает), телефон — ничего: там ячейка
            схлопнута медиа-веткой, а навигация живёт внизу. */}
        <div className="zone sidebar" style={{ padding: 0, background: "transparent" }}>
          {layout.desktop ? sidebarNode : null}
          {layout.tablet ? (
            <NavRail entries={railNav} pathname={pathname} menuOpen={drawer} onOpenMenu={() => setDrawer(true)} />
          ) : null}
        </div>

        {/* Контент */}
        {/* Класса zone тут НЕТ намеренно: в приложении фон-подложку носят только
            сайдбар, «Сейчас играет» и полоса плеера, а центральный экран лежит
            прямо на фоне страницы. Веб добавлял ему четвёртую подложку, и от
            этого экран читался как «страница внутри страницы» (замечание
            владельца 02.08). */}
        {/* view-in — ПРИХОД экрана, и только он. Почему у веба нет фазы ухода
            и почему класс свой, а не общий .muza-view приложения — в
            globals.css, раздел «Переход между экранами». */}
        <main key={pathname} className="main view-in">
          {children}
        </main>

        {/* «Сейчас играет» (≥1200px, автооткрытие при старте трека) */}
        {npVisible ? <NowPlayingPanel onClose={() => set({ npOpen: false })} /> : null}
      </div>

      <PlayerBar
        npOpen={npVisible}
        // где панели не бывает — там и кнопки нет (правило умений площадки)
        onToggleNp={npAllowed ? () => set({ npOpen: !prefs.npOpen }) : undefined}
        onOpenMobile={openMobileNp}
        onExpand={() => setListening(true)}
      />

      {/* Нижняя навигация телефона: пять пунктов, пятый — бургер. Разбор
          состава и почему бургер внизу — в шапке ShellNav.tsx. Узел стоит в
          дереве всегда: показывает его медиа-ветка (.bottomnav), а не React —
          так на смене раскладки не пересоздаётся поддерево. */}
      <BottomNav entries={compactNav} pathname={pathname} menuOpen={drawer} onOpenMenu={() => setDrawer(true)} />

      {/* Ящик — ТОЛЬКО в узких раскладках: на десктопе тот же сайдбар уже
          стоит в сетке, и открыть ящик нечем (кнопки нет). Условие всё равно
          явное — окно можно растянуть, пока ящик открыт. */}
      <ShellDrawer open={drawer && !layout.desktop} onClose={() => setDrawer(false)}>
        {!layout.desktop ? sidebarNode : null}
      </ShellDrawer>

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

      {/* Диалоги меню плейлиста — те же, что в приложении (App.tsx). Оба
          подтверждают действие текстом, а не молча делают: переименование и
          удаление необратимы для чужих глаз (совместные плейлисты). */}
      <Dialog
        open={plRename !== null}
        title={t("app.renamePlaylistDialog.title")}
        onClose={() => setPlRename(null)}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={() => setPlRename(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="check" disabled={!plRenameValue.trim()} onClick={() => void renameFromMenu()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {/* Enter = главная кнопка диалога (Button из ДС submit-кнопкой не станет) */}
        <div
          style={{ minWidth: 280 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void renameFromMenu();
          }}
        >
          <SearchInput value={plRenameValue} onChange={setPlRenameValue} placeholder={t("common.namePlaceholder")} icon="list-music" autoFocus />
        </div>
      </Dialog>

      <Dialog
        open={plDelete !== null}
        title={t("app.deletePlaylistDialog.title")}
        onClose={() => setPlDelete(null)}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={() => setPlDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="trash-2" onClick={() => void deleteFromMenu()}>
              {t("app.deletePlaylistDialog.confirm")}
            </Button>
          </>
        }
      >
        {/* Только серверный текст: плейлистов «на этом устройстве» у браузера
            не бывает, и развилки bodyLocal здесь нет. */}
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          {t("app.deletePlaylistDialog.bodyServer", { name: plDelete?.name ?? "" })}
        </div>
      </Dialog>

      {/* Экран стоит в дереве ВСЕГДА и слушает проп: снимать его условием
          нельзя — уходить будет нечему (см. шапку MobileNowPlaying). Пока он
          закрыт, узла в разметке всё равно нет: компонент возвращает null сам,
          пока хук слоя не смонтирован. */}
      <MobileNowPlaying open={mobileNp} onClose={closeMobileNp} />

      {/* Караоке во весь экран — ПОСЛЕДНИМ ребёнком .shell и без обёрток:
          общий оверлей позиционируется absolute inset:0 и рассчитывает, что
          ближайший позиционированный предок — сам шелл (position: fixed).
          z-index у него 100, то есть выше плеер-бара (--z-bar 40), нижней
          навигации (30) и мобильного now-playing (--z-overlay 50) — и ниже
          слоя переноса (300), как в приложении. */}
      <ListeningModeHost open={listening} onClose={() => setListening(false)} />
    </div>
    </ContextMenuProvider>
    </DragLayer>
  );
}
