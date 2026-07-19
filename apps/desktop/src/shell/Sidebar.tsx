import { useState } from "react";
import { Icon, IconButton } from "@muza/ui";
import glyph from "@muza/ui/assets/logo/glyph.svg";
import { useCoverArt } from "../lib/coverArt";
import { insertionIndex } from "../lib/dragEngine";
import { useLocalReorder } from "../lib/useLocalReorder";
import { useDropZone } from "./DragLayer";
import { isFillableNavIcon, NAV_ITEM_META, navItemLabel, normalizeNavItems, type NavItemPref } from "../lib/navItems";
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
  /** 2026-07-17: подписка (follower) — в реордер не входит. */
  fixed?: boolean;
  /** 2026-07-17: скрытая владельцем подписка — строка гаснет. */
  dimmed?: boolean;
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
      {/* Активная вкладка — ЗАЛИТАЯ иконка (как в Spotify/Apple Music): цвета
          мало, силуэт читается с периферии. lucide рисует штрихом, солид-
          вариантов не поставляет, поэтому заливка — fill тем же цветом
          (Icon.filled). Годится не всякому глифу: см. NAV_FILLABLE в
          lib/navItems.ts — там список тех, кто заливается осмысленно. */}
      <Icon
        name={icon}
        size={20}
        color={active ? "var(--accent-text)" : "currentColor"}
        filled={Boolean(active) && isFillableNavIcon(icon)}
        style={{ transition: "color var(--dur-base) var(--ease-out)" }}
      />
      {label}
    </button>
  );
}

function PlaylistRow({
  playlistId,
  cover,
  name,
  meta,
  shared,
  onClick,
  onMenu,
  onDropTrack,
  grip,
  rowRef,
  shift,
  dragged = false,
  settling = false,
  reordering = false,
  dimmed = false,
}: {
  playlistId: string;
  cover?: string;
  name: string;
  meta: string;
  shared?: boolean;
  onClick?: () => void;
  /** ПКМ по строке — контекст-меню плейлиста (Открыть/Переименовать/Удалить). */
  onMenu?: (e: React.MouseEvent) => void;
  /** Дроп перетаскиваемого трека на этот плейлист (undefined = не таргет). */
  onDropTrack?: (trackId: string) => void;
  /** Реордер (useLocalReorder, живёт в Sidebar): пропсы ручки-⠿; нет — ручки нет. */
  grip?: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  rowRef?: (el: HTMLElement | null) => void;
  /** Transform строки во время реордера (сама или сосед); null — покой. */
  shift?: { x: number; y: number } | null;
  /** Тащат ИМЕННО эту строку: едет за курсором, без transition, поверх соседей. */
  dragged?: boolean;
  /** Строку отпустили — она доезжает до слота, transition нужен и ей. */
  settling?: boolean;
  /** Идёт реордер списка — ручки видны на всех строках (читаются цели). */
  reordering?: boolean;
  /** 2026-07-17: скрытая владельцем подписка — строка гаснет. */
  dimmed?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const { t } = useT();
  // Track-иконка плейлиста — сырой ytimg-URL: срезаем вшитые поля тем же
  // canvas-кропом, что у плеера (локальные/не-ytimg проходят как есть).
  const cleanCover = useCoverArt(cover ?? null);
  // id зоны с префиксом места: тот же плейлист бывает целью и здесь, и плиткой
  // медиатеки, и своей страницей — а реестр зон в DragLayer это плоская Map,
  // и одинаковые id затирали бы колбэк друг друга. Зона принимает ТОЛЬКО треки:
  // реордер плейлистов — локальный жест, между областями не ходит (2026-07-16).
  const { over: dropLit, props: dropProps } = useDropZone(
    onDropTrack ? `sidebar-playlist:${playlistId}` : null,
    (p) => onDropTrack?.(p.id),
  );
  return (
    <div
      {...dropProps}
      ref={rowRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        opacity: dimmed ? 0.45 : undefined,
        transform: shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined,
        // тащимая строка липнет к курсору без сглаживания; соседи разъезжаются
        // мягко; при посадке transition получает и она — доезжает до слота.
        // Вне реордера transition не держим — не мешать layout'у списка.
        transition: shift && (!dragged || settling) ? "transform 160ms var(--ease-out)" : undefined,
        zIndex: dragged ? 2 : undefined,
      }}
    >
    <button
      type="button"
      onClick={onClick}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(e);
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        boxSizing: "border-box",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        // не дать длинному имени лечь под ручку-⠿
        paddingRight: grip ? 30 : "var(--sp-2)",
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
      {cleanCover ? (
        // objectFit обязателен: без него дефолтный fill плющил неквадратную
        // обложку. Не Cover — у пустой ветки ниже свой осмысленный плейсхолдер
        // (совместный плейлист vs обычный), а не общий значок ноты.
        <img
          src={cleanCover}
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
    {grip ? (
      // Появляется на hover строки (в узком сайдбаре постоянные точки на каждой
      // строке — шум); пока список реордерится — видна везде (читается механика).
      <span
        {...grip}
        role="button"
        aria-label={t("views.library.reorderHandle")}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "50%",
          right: 4,
          transform: "translateY(-50%)",
          display: "grid",
          placeItems: "center",
          width: 26,
          height: 30,
          color: "var(--text-3)",
          cursor: dragged ? "grabbing" : "grab",
          opacity: hover || reordering ? 1 : 0,
          pointerEvents: hover || reordering ? "auto" : "none",
          transition: "opacity var(--dur-fast) var(--ease-out)",
          touchAction: "none",
        }}
      >
        <Icon name="grip-vertical" size={16} />
      </span>
    ) : null}
    </div>
  );
}

/** «Любимое» — закреплённая ПЕРВАЯ строка списка плейлистов (Spotify-паттерн,
 *  2026-07-16): не вкладка сайдбара, а особый плейлист. Фирменный градиент
 *  логотипа Музы + сердце вместо обложки; подсвечивается, когда открыт её
 *  экран (view==="favorites"). Приёмной зоны дропа нет — это агрегат лайков,
 *  трек в него кладут кнопкой-сердцем, а не перетаскиванием. */
function FavoritesRow({ count, active, onOpen }: { count: number; active: boolean; onOpen: () => void }) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      // имя — только «Любимое» (без счётчика в подписи): и скринридеру чище, и
      // это стабильный role-name для тестов навигации
      aria-label={t("views.favorites.title")}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        border: "none",
        borderRadius: "var(--r-sm)",
        background: active ? "var(--surface-4)" : hover ? "var(--surface-2)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
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
          display: "grid",
          placeItems: "center",
          // тот же фирменный градиент, что у плитки библиотеки (glyph.svg)
          background: "linear-gradient(160deg, #F76967 0%, #3B82F6 100%)",
        }}
      >
        <Icon name="heart" size={22} color="#fff" filled />
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
          {t("views.favorites.title")}
        </span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
          {t("views.library.playlistSubtitle", { count })}
        </span>
      </span>
    </button>
  );
}

export function Sidebar({
  view,
  setView,
  playlists,
  favoritesCount,
  onOpenFavorites,
  onCreatePlaylist,
  onOpenPlaylist,
  onPlaylistMenu,
  onDropTrack,
  onReorderPlaylists,
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
  /** «Любимое» — закреплённая первая строка списка (счётчик лайков + переход). */
  favoritesCount: number;
  onOpenFavorites: () => void;
  onCreatePlaylist: () => void;
  onOpenPlaylist: (id: string) => void;
  /** T17: ПКМ по плейлисту — контекст-меню (App: Открыть/Переименовать/Удалить). */
  onPlaylistMenu?: (p: SidebarPlaylist, e: React.MouseEvent) => void;
  /** DnD: трек уронили на плейлист (только серверные списки). */
  onDropTrack?: (playlistId: string, trackId: string) => void;
  /** Реордер за ручку-⠿ (локальный, только внутри сайдбара): id встаёт на
   *  toIndex (splice-индекс) — тот же контракт, что в Библиотеке. */
  onReorderPlaylists?: (draggedId: string, toIndex: number) => void;
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
  // Реордер плейлистов — локальный жест столбца: строка следует за курсором в
  // пределах списка, соседи разъезжаются (useLocalReorder). «Любимое» закреплено
  // и в ids не входит — на его место ничего не встанет.
  const reorder = useLocalReorder({
    // fixed (подписки, 2026-07-17) в реордер не входят — их позиций на сервере нет
    ids: playlists.filter((p) => !p.fixed).map((p) => p.id),
    resolveTo: (rects, from, _x, y) => insertionIndex(rects, from, y),
    onCommit: (id, to) => onReorderPlaylists?.(id, to),
  });
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
        <IconButton
          icon="plus"
          size="sm"
          label={t("sidebar.newPlaylistTooltip")}
          style={{ width: 28, height: 28 }}
          iconSize={16}
          onClick={onCreatePlaylist}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", scrollbarWidth: "none" }}>
        {/* «Любимое» закреплено первым (2026-07-16) — над обычными плейлистами */}
        <FavoritesRow count={favoritesCount} active={view === "favorites"} onOpen={onOpenFavorites} />
        {playlists.map((p) => (
          <PlaylistRow
            key={p.id}
            playlistId={p.id}
            cover={p.cover}
            name={p.name}
            meta={p.meta}
            shared={p.shared}
            dimmed={p.dimmed}
            onClick={() => onOpenPlaylist(p.id)}
            onMenu={onPlaylistMenu ? (e) => onPlaylistMenu(p, e) : undefined}
            onDropTrack={onDropTrack && !p.fixed ? (trackId) => onDropTrack(p.id, trackId) : undefined}
            grip={onReorderPlaylists && !p.fixed ? reorder.grip(p.id) : undefined}
            rowRef={p.fixed ? undefined : reorder.itemRef(p.id)}
            shift={p.fixed ? null : reorder.shiftFor(p.id)}
            dragged={!p.fixed && reorder.draggingId === p.id}
            settling={reorder.settling}
            reordering={reorder.draggingId !== null}
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
          <IconButton
            icon="circle-help"
            size="sm"
            label={t("sidebar.hotkeysTooltip")}
            style={{ width: 28, height: 28 }}
            iconSize={16}
            onClick={onOpenHotkeys}
          />
        </div>
      </div>
    </aside>
  );
}
