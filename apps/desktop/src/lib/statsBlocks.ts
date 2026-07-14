/** Конфиг блоков страницы «Статистика»: нормализация сохранённого списка
 *  (prefs.statsBlocks) и подписи блоков для страницы и настроек.
 *
 *  i18n (эпик W5, T-media): та же схема, что у NAV_ITEM_META (см.
 *  lib/navItems.ts) — потребители (views/StatsView.tsx, views/SettingsView.tsx)
 *  вне зоны этой правки, дефолты вычислены через `translate(DEFAULT_LANG, key)`. */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";
import { STATS_BLOCK_KEYS, type StatsBlockKey } from "../types";

export interface StatsBlockPref {
  key: StatsBlockKey;
  on: boolean;
}

/** Сохранённый список → полный: чужие ключи выбрасываются, отсутствующие
 *  (новые блоки будущих версий) дописываются в конец включёнными. */
export function normalizeStatsBlocks(saved: StatsBlockPref[]): StatsBlockPref[] {
  const known = new Set<string>(STATS_BLOCK_KEYS);
  const seen = new Set<string>();
  const out: StatsBlockPref[] = [];
  for (const b of saved) {
    if (!known.has(b.key) || seen.has(b.key)) continue;
    seen.add(b.key);
    out.push({ key: b.key, on: b.on });
  }
  for (const key of STATS_BLOCK_KEYS) {
    if (!seen.has(key)) out.push({ key, on: true });
  }
  return out;
}

export const STATS_BLOCK_META: Record<StatsBlockKey, { label: string; hint: string }> = {
  summary: { label: translate(DEFAULT_LANG, "media.statsBlocks.summary.label"), hint: translate(DEFAULT_LANG, "media.statsBlocks.summary.hint") },
  activity: { label: translate(DEFAULT_LANG, "media.statsBlocks.activity.label"), hint: translate(DEFAULT_LANG, "media.statsBlocks.activity.hint") },
  rhythm: { label: translate(DEFAULT_LANG, "media.statsBlocks.rhythm.label"), hint: translate(DEFAULT_LANG, "media.statsBlocks.rhythm.hint") },
  top_tracks: { label: translate(DEFAULT_LANG, "media.statsBlocks.top_tracks.label"), hint: translate(DEFAULT_LANG, "media.statsBlocks.top_tracks.hint") },
  top_artists: { label: translate(DEFAULT_LANG, "media.statsBlocks.top_artists.label"), hint: translate(DEFAULT_LANG, "media.statsBlocks.top_artists.hint") },
  streaks: { label: translate(DEFAULT_LANG, "media.statsBlocks.streaks.label"), hint: translate(DEFAULT_LANG, "media.statsBlocks.streaks.hint") },
  likes: { label: translate(DEFAULT_LANG, "media.statsBlocks.likes.label"), hint: translate(DEFAULT_LANG, "media.statsBlocks.likes.hint") },
  wrapped: { label: translate(DEFAULT_LANG, "media.statsBlocks.wrapped.label"), hint: translate(DEFAULT_LANG, "media.statsBlocks.wrapped.hint") },
};

/** Локализованная метка/подсказка блока — для будущей правки потребителя
 *  (views/StatsView.tsx, views/SettingsView.tsx — вне зоны этого набора файлов). */
export function statsBlockLabel(key: StatsBlockKey, lang: Lang): { label: string; hint: string } {
  return {
    label: translate(lang, `media.statsBlocks.${key}.label`),
    hint: translate(lang, `media.statsBlocks.${key}.hint`),
  };
}
