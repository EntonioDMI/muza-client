/** Компоновка сайдбара: нормализация prefs.navItems (состав/порядок/свои
 *  имена вкладок). Главная выключаться не умеет — приложению нужен дом.
 *  T44: плагинные вкладки живут тут же под ключами `plugin:<id>:<tab>`. */

import { NAV_ITEM_KEYS, type NavItemKey } from "../types";
import { isPluginKey } from "./pluginSlots";

/** Ключ пункта — родной NavItemKey либо плагинный `plugin:<id>:<tab>`. */
export type NavItemSlotKey = NavItemKey | string;

export interface NavItemPref {
  key: NavItemSlotKey;
  on: boolean;
  /** Своё имя вкладки; пусто/нет — дефолт из NAV_ITEM_META. */
  label?: string;
}

/** T44: `pluginKeys` — валидные плагинные ключи (плагин установлен и включён);
 *  плагинный ключ вне множества выбрасывается, отсутствующий — дописывается. */
export function normalizeNavItems(saved: NavItemPref[], pluginKeys: readonly string[] = []): NavItemPref[] {
  const knownNative = new Set<string>(NAV_ITEM_KEYS);
  const validPlugin = new Set<string>(pluginKeys);
  const seen = new Set<string>();
  const out: NavItemPref[] = [];
  for (const n of saved ?? []) {
    const ok = isPluginKey(n.key) ? validPlugin.has(n.key) : knownNative.has(n.key);
    if (!ok || seen.has(n.key)) continue;
    seen.add(n.key);
    const label = typeof n.label === "string" ? n.label.trim().slice(0, 24) : undefined;
    out.push({ key: n.key, on: n.key === "home" ? true : n.on, ...(label ? { label } : {}) });
  }
  for (const key of NAV_ITEM_KEYS) {
    if (!seen.has(key)) out.push({ key, on: true });
  }
  for (const key of validPlugin) {
    if (!seen.has(key)) out.push({ key, on: true });
  }
  return out;
}

export const NAV_ITEM_META: Record<NavItemKey, { label: string; icon: string }> = {
  home: { label: "Главная", icon: "home" },
  search: { label: "Поиск", icon: "search" },
  favorites: { label: "Любимое", icon: "heart" },
  library: { label: "Библиотека", icon: "library-big" },
  stats: { label: "Статистика", icon: "chart-line" },
};
