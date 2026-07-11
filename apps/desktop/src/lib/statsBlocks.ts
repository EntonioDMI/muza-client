/** Конфиг блоков страницы «Статистика»: нормализация сохранённого списка
 *  (prefs.statsBlocks) и подписи блоков для страницы и настроек. */

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
  summary: { label: "Сводка", hint: "Минуты, прослушивания, треки и артисты за период" },
  activity: { label: "Активность", hint: "График по дням или месяцам" },
  rhythm: { label: "Ритм дня", hint: "Распределение по часам суток" },
  top_tracks: { label: "Топ треков", hint: "До десяти самых прослушиваемых" },
  top_artists: { label: "Топ артистов", hint: "По наигранным минутам" },
  streaks: { label: "Серии", hint: "Дни с музыкой подряд" },
  likes: { label: "Лайки", hint: "Добавлено в любимое за период" },
  wrapped: { label: "Итоги года", hint: "Вход в story-итоги (Wrapped)" },
};
