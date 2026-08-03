/** Конфиг блоков страницы «Статистика»: нормализация сохранённого списка
 *  (prefs.statsBlocks) и подписи блоков для страницы и настроек.
 *
 *  Переехало из apps/desktop/src/lib/statsBlocks.ts (волна «настройки»,
 *  2026-08-02) вместе с под-экраном «Статистика». Модуль чистый: ключи — из
 *  общей модели настроек (prefs/types), подписи — из общего словаря. На
 *  старом месте пенёк-ре-экспорт.
 *
 *  Блок «wrapped» удалён 2026-07-16 (вход во Wrapped — только с главной):
 *  ключ из старых сохранений отфильтровывает normalizeStatsBlocks. */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";
import { STATS_BLOCK_KEYS, type StatsBlockKey } from "../prefs/types";

export interface StatsBlockPref {
  key: StatsBlockKey;
  on: boolean;
}

/** Сохранённый список → полный: чужие ключи выбрасываются, отсутствующие
 *  (новые блоки будущих версий) дописываются в конец включёнными.
 *
 *  Вход не обязан быть массивом объектов. Профиль настроек переносимый
 *  (prefs/load.ts), и `"statsBlocks": null` в нём роняло `for…of` — а вместе с
 *  ним и под-экран «Статистика», и всю страницу статистики. У соседей по модели
 *  (lib/barButtons.ts, lib/navItems.ts) такая защита стояла с самого начала,
 *  здесь её просто забыли; элементы проверяются по той же причине. */
export function normalizeStatsBlocks(saved: readonly StatsBlockPref[]): StatsBlockPref[] {
  const known = new Set<string>(STATS_BLOCK_KEYS);
  const seen = new Set<string>();
  const out: StatsBlockPref[] = [];
  for (const b of Array.isArray(saved) ? saved : []) {
    if (!b || typeof b !== "object" || !known.has(b.key) || seen.has(b.key)) continue;
    seen.add(b.key);
    out.push({ key: b.key, on: b.on === true });
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
};

/** Локализованная метка/подсказка блока (страница статистики и её под-экран
 *  настроек зовут именно её, а не статичный EN-снимок META выше). */
export function statsBlockLabel(key: StatsBlockKey, lang: Lang): { label: string; hint: string } {
  return {
    label: translate(lang, `media.statsBlocks.${key}.label`),
    hint: translate(lang, `media.statsBlocks.${key}.hint`),
  };
}
