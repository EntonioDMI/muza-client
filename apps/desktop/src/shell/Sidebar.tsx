/** Пенёк боковой панели: сама панель переехала в @muza/app/shell/Sidebar
 *  (Э3 веб-паритета) — веб рисовал свою копию, и та уже разъехалась с
 *  приложением (не было ни реордера, ни ручек, ни закрепа, ни подписок).
 *
 *  Здесь остался ПЕРЕХОДНИК, а не голый `export *`, и вот почему: общая панель
 *  не знает и не должна знать про десктопные понятия — компоновку вкладок из
 *  настроек (lib/navItems.ts), плагинные слоты (lib/pluginSlots.ts) и тип
 *  экрана `View`. Этот файл переводит их в плоский список {key, icon, label} и
 *  колбэк выбора. Разметка при этом целиком общая — DOM у приложения ровно
 *  тот же, что был до переезда.
 *
 *  Ассет логотипа тоже остаётся здесь: `import glyph from ".../glyph.svg"` —
 *  идиома Vite, в Next тот же импорт даёт объект, а не строку (см. шапку
 *  packages/app/tsconfig.json). Общий код получает готовый URL пропом. */

import glyph from "@muza/ui/assets/logo/glyph.svg";
import {
  Sidebar as SharedSidebar,
  type SidebarPlaylist,
  type SidebarUpdate,
} from "@muza/app/shell/Sidebar";
import { useLookEdit } from "@muza/app/shell/lookReorder";
import { applyVisibleOrder } from "@muza/app/lib/dragEngine";
import { NAV_ITEM_META, navItemLabel, normalizeNavItems, type NavItemPref } from "../lib/navItems";
import { isPluginKey } from "../lib/pluginSlots";
import type { View } from "../types";
import { useT } from "../i18n";

export type { SidebarPlaylist, SidebarUpdate };

/** ⚠️ `isFillableNavIcon` из lib/navItems.ts здесь больше не зовётся: правило
 *  заливки активной иконки — часть отрисовки панели и уехало в неё вместе с
 *  разметкой (множества совпадают дословно). Десктопная копия осталась без
 *  читателей и просится в удаление — но lib/navItems.ts вне этой зоны. */

/** T44: плагинная вкладка сайдбара (мета из contributes). */
export interface PluginNavItemView {
  key: string;
  pluginId: string;
  tabId: string;
  title: string;
  icon: string;
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
  onDropTrackOnFavorites,
  onReorderPlaylists,
  isAdmin = false,
  navItems,
  pluginNav = [],
  pluginKeys = [],
  activePluginKey = null,
  onSelectPluginTab,
  onSetNavItems,
  onOpenHotkeys,
  update,
}: {
  view: View;
  setView: (v: View) => void;
  playlists: SidebarPlaylist[];
  /** «Любимое» — закреплённая первая строка списка (счётчик лайков + переход). */
  favoritesCount: number;
  onOpenFavorites: () => void;
  /** Бросок трека на «Любимое» (2026-07-20): только добавляет, повтор безобиден. */
  onDropTrackOnFavorites?: (trackId: string) => void;
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
  /** Записать компоновку вкладок (режим правки вида, Ctrl+E). Нет колбэка —
   *  вкладки не переставляются. */
  onSetNavItems?: (items: NavItemPref[]) => void;
  /** Найденное обновление: пункт над «Настройками». Нет — пункта нет. */
  update?: SidebarUpdate;
  /** T9: видимая кнопка «?» — открывает диалог горячих клавиш (App). */
  onOpenHotkeys: () => void;
}) {
  const { t, lang } = useT();
  const { pushUndo } = useLookEdit();
  // Компоновка: скрытая вкладка не рендерится (активный view на скрытой —
  // индикатор гаснет, контент остаётся доступен), label — своё имя.
  // T44: плагинные вкладки живут в том же списке под ключами plugin:<id>:<tab>.
  const allNav = normalizeNavItems(navItems ?? [], pluginKeys);
  const mainNav = allNav
    .filter((n) => n.on)
    .map((n) => {
      if (isPluginKey(n.key)) {
        const pn = pluginNav.find((p) => p.key === n.key);
        return { key: n.key, icon: pn?.icon || "puzzle", label: n.label || pn?.title || t("settings.appearance.plugin.genericLabel"), plugin: pn };
      }
      const nativeKey = n.key as keyof typeof NAV_ITEM_META;
      return { key: n.key, icon: NAV_ITEM_META[nativeKey].icon, label: n.label || navItemLabel(nativeKey, lang), plugin: undefined };
    });
  return (
    <SharedSidebar
      logoSrc={glyph}
      nav={mainNav.map((n) => ({ key: n.key, icon: n.icon, label: n.label }))}
      activeNavKey={activePluginKey ?? view}
      onSelectNav={(key) => {
        const n = mainNav.find((x) => x.key === key);
        if (n?.plugin) onSelectPluginTab?.(n.plugin.pluginId, n.plugin.tabId);
        else setView(key as View);
      }}
      playlists={playlists}
      favoritesCount={favoritesCount}
      favoritesActive={view === "favorites"}
      onOpenFavorites={onOpenFavorites}
      onCreatePlaylist={onCreatePlaylist}
      onOpenPlaylist={onOpenPlaylist}
      onPlaylistMenu={onPlaylistMenu}
      onDropTrack={onDropTrack}
      onDropTrackOnFavorites={onDropTrackOnFavorites}
      onReorderPlaylists={onReorderPlaylists}
      // Панель переставляет ВИДИМЫЕ вкладки и отдаёт их новый порядок; в
      // компоновку он ложится через applyVisibleOrder — выключенная вкладка
      // остаётся на своём месте в списке настроек, а не уезжает в конец.
      onReorderNav={
        onSetNavItems
          ? (keys) => {
              pushUndo({ navItems: navItems ?? [] });
              onSetNavItems(applyVisibleOrder(allNav, (n) => n.key, keys));
            }
          : undefined
      }
      onOpenAdmin={isAdmin ? () => setView("admin") : undefined}
      adminActive={view === "admin"}
      onOpenSettings={() => setView("settings")}
      settingsActive={view === "settings"}
      onOpenHotkeys={onOpenHotkeys}
      update={update}
    />
  );
}
