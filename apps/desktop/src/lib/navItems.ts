/** Компоновка сайдбара: нормализация prefs.navItems (состав/порядок/свои
 *  имена вкладок). Главная выключаться не умеет — приложению нужен дом. */

import { NAV_ITEM_KEYS, type NavItemKey } from "../types";

export interface NavItemPref {
  key: NavItemKey;
  on: boolean;
  /** Своё имя вкладки; пусто/нет — дефолт из NAV_ITEM_META. */
  label?: string;
}

export function normalizeNavItems(saved: NavItemPref[]): NavItemPref[] {
  const known = new Set<string>(NAV_ITEM_KEYS);
  const seen = new Set<string>();
  const out: NavItemPref[] = [];
  for (const n of saved ?? []) {
    if (!known.has(n.key) || seen.has(n.key)) continue;
    seen.add(n.key);
    const label = typeof n.label === "string" ? n.label.trim().slice(0, 24) : undefined;
    out.push({ key: n.key, on: n.key === "home" ? true : n.on, ...(label ? { label } : {}) });
  }
  for (const key of NAV_ITEM_KEYS) {
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
