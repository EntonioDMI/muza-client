/** Компоновка сайдбара: нормализация prefs.navItems (состав/порядок/свои
 *  имена вкладок). Главная выключаться не умеет — приложению нужен дом.
 *  T44: плагинные вкладки живут тут же под ключами `plugin:<id>:<tab>`.
 *
 *  i18n (эпик W5, T-media): `label` в NAV_ITEM_META — ДЕФОЛТНАЯ метка вкладки
 *  (не путать с NavItemPref.label — это СВОЙ текст пользователя, override,
 *  данные — не трогаем). Потребители (shell/Sidebar.tsx, views/SettingsView.tsx)
 *  вне зоны этой правки и читают `.label` как плоское поле без вызова t(),
 *  поэтому дефолт вычислен один раз через `translate(DEFAULT_LANG, key)` —
 *  было захардкожено RU, стало EN константой; живое переключение языка для
 *  этих меток потребует правки потребителя (см. navItemLabel ниже — уже
 *  готовая функция для этой будущей правки). */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";
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
  home: { label: translate(DEFAULT_LANG, "media.nav.home"), icon: "home" },
  search: { label: translate(DEFAULT_LANG, "media.nav.search"), icon: "search" },
  // favorites — не вкладка сайдбара (2026-07-16), закреплён отдельной строкой
  library: { label: translate(DEFAULT_LANG, "media.nav.library"), icon: "library-big" },
  stats: { label: translate(DEFAULT_LANG, "media.nav.stats"), icon: "chart-line" },
};

/** Глифы, которые ОСМЫСЛЕННО заливаются в активной вкладке (Icon.filled →
 *  `fill=color`). lucide рисует штрихом и солид-вариантов не поставляет, а
 *  заливка идёт по ВСЕМ подпутям глифа — годится только замкнутым силуэтам:
 *
 *  - `heart`, `home`, `library-big` — замкнутые фигуры, заливка даёт ровно тот
 *    солид-силуэт, что рисуют Spotify/Apple Music;
 *  - `search` (окружность + ручка) — заливка превращает линзу в глухой диск,
 *    лупа перестаёт читаться;
 *  - `chart-line` (оси + ломаная) — заливка ломаной даёт кляксу под линией.
 *
 *  Незалитый глиф активной вкладки не «ломается»: он просто остаётся штриховым
 *  и всё равно подсвечен акцентным цветом, фоном surface-4 и полужирным весом.
 *  Плагинные вкладки (`plugin:<id>:<tab>`) сюда не попадают: иконку выбирает
 *  автор плагина, заранее судить о её форме нельзя. */
const NAV_FILLABLE: ReadonlySet<string> = new Set(["heart", "home", "house", "library-big", "library"]);

export function isFillableNavIcon(icon: string): boolean {
  return NAV_FILLABLE.has(icon);
}

/** Локализованная метка вкладки — для будущей правки потребителя (Sidebar/
 *  SettingsView, вне зоны этого набора файлов): вместо NAV_ITEM_META[key].label
 *  (статичный EN) зовёт `navItemLabel(key, prefs.language)`. */
export function navItemLabel(key: NavItemKey, lang: Lang): string {
  return translate(lang, `media.nav.${key}`);
}
