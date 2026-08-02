/** Тонкая обёртка: сам экран статистики переехал в @muza/app (волна «экраны»,
 *  2026-08-02) — веб рисует ровно его же, чтобы вторая реализация не разъезжалась
 *  с приложением (она уже успела: у веба были плоские «Серии» и не было «Лайков»).
 *
 *  Обёртка, а не голый ре-экспорт, потому что три вещи знает только приложение:
 *  - какие блоки включены и в каком порядке (prefs.statsBlocks + normalizeStatsBlocks:
 *    STATS_BLOCK_KEYS живут в types.ts приложения, вебу они не нужны);
 *  - что запросы идут через запас последних удачных ответов (withSnapshot) —
 *    отсюда берётся признак «показываем прежние данные, сети нет»;
 *  - что строка трека готовится к мгновенному старту (useWarmRow).
 *
 *  Пропсы снаружи не изменились ни на один — App.tsx этой правки не заметил.
 *  Новый код импортирует экран напрямую из "@muza/app/views/StatsView". */

import { StatsView as SharedStatsView } from "@muza/app/views/StatsView";
import type { MuzaApi, StatsPeriod, Track } from "@muza/api-client";
import { normalizeStatsBlocks } from "../lib/statsBlocks";
import { withSnapshot } from "../lib/offlineSnapshot";
import { useWarmRow } from "../player/useWarmer";
import type { Prefs } from "../types";

export { Bars } from "@muza/app/views/StatsView";

export function StatsView({
  api,
  canSearch,
  prefs,
  currentId,
  playing,
  likes,
  onPlayCatalog,
  onLike,
  onCatalogMenu,
  onCustomize,
}: {
  api: MuzaApi;
  /** false у анонима: истории на сервере нет — честная заглушка. */
  canSearch: boolean;
  prefs: Prefs;
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  likes: string[];
  onPlayCatalog: (tracks: Track[], id: string) => void;
  onLike: (id: string) => void;
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  /** Открыть под-экран настроек «Статистика» (кнопка «Настроить»). */
  onCustomize: () => void;
}) {
  const warmRow = useWarmRow();
  return (
    <SharedStatsView
      api={api}
      canSearch={canSearch}
      blocks={normalizeStatsBlocks(prefs.statsBlocks).filter((b) => b.on).map((b) => b.key)}
      initialPeriod={prefs.statsPeriod}
      currentId={currentId}
      playing={playing}
      likes={likes}
      onPlayCatalog={onPlayCatalog}
      onLike={onLike}
      onCatalogMenu={onCatalogMenu}
      onCustomize={onCustomize}
      loadOverview={(period: StatsPeriod) => withSnapshot(`stats:${period}`, () => api.getStatsOverview(period))}
      rowProps={warmRow}
    />
  );
}
