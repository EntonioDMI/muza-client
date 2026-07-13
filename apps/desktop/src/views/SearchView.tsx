import { useEffect, useMemo, useRef, useState } from "react";
import { Button, SearchInput, TrackRow } from "@muza/ui";
import type { GroupedSearchResult, MuzaApi, Track } from "@muza/api-client";
import { TRACKS, type DemoTrack } from "../data/demo";
import { fmtTime } from "../lib/format";
import { startTrackDrag } from "../lib/dnd";
import { exportCachedTrack, maybeAltFileDrag } from "../lib/dragOut";
import { flattenGroupedResults, nextGroupLimit } from "../lib/searchGrouping";
import { SearchGroupCard } from "./SearchGroupCard";

/** Поиск Stage 2 (слайс 3): живой ввод — мгновенный поиск по накопленному
 *  каталогу (scope=catalog), Enter/кнопка — полный с провайдерами (scope=full,
 *  секунды: два запуска yt-dlp на сервере). Stage 3: клик по результату
 *  реально играет (очередь = список результатов).
 *
 *  T37 (эпик W6): searchGrouping=true (дефолт) переключает выдачу на
 *  api.searchGrouped() (?group=1 сервера T36) — ремиксы/спидапы/кавера
 *  сворачиваются под одной карточкой канона, лайк карточки бьёт по канону,
 *  разворот показывает варианты отдельными строками с человеческой подписью
 *  категории. Нераспознанные декорированные одиночки сервер уже кладёт в
 *  хвост выдачи (see grouping.ts сервера) — клиент рендерит их как обычные
 *  строки, ничего дополнительно не двигая. Выкл (searchGrouping=false) —
 *  прежний плоский путь, полностью не тронут. */
export function SearchView({
  api,
  canSearch,
  currentId,
  playing,
  likes,
  instantSearch = true,
  searchScope = "all",
  searchGrouping = true,
  onPlayTrack,
  onPlayCatalog,
  onQueueCatalog,
  onQueueDemo,
  rowShow,
  onLike,
  onTrackMenu,
  onNotify,
  onCatalogMenu,
}: {
  api: MuzaApi;
  /** false у анонима: сервер его не знает, каталог недоступен. */
  canSearch: boolean;
  currentId: string;
  playing: boolean;
  likes: string[];
  /** Живой каталожный поиск при вводе (выкл = только по Enter/кнопке). */
  instantSearch?: boolean;
  /** «Где искать»: каталог + источники или только каталог (без yt-dlp). */
  searchScope?: "all" | "catalog";
  /** T37: группировка ремиксов/версий (настройки → Поиск). */
  searchGrouping?: boolean;
  onPlayTrack: (id: string) => void;
  /** Играть каталожный трек в контексте списка (Stage 3, движок). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** Дабл-клик = «в очередь» (настройка); нет — dblclick играет. */
  onQueueCatalog?: (t: Track) => void;
  onQueueDemo?: (id: string) => void;
  /** Строка трека (настройка «Строка трека»): что показывать. */
  rowShow?: { cover: boolean; duration: boolean };
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
  onNotify: (text: string, icon?: string) => void;
  /** «⋯» на серверном треке: меню Stage 4 (плейлист, версии/источники). */
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[] | null>(null); // null — запроса ещё не было (плоский режим)
  const [groupedResults, setGroupedResults] = useState<GroupedSearchResult[] | null>(null); // grouped-режим
  // «Загрузить ещё» в grouped-режиме: лестница limit 30→60→90 (group=1
  // сервера поддерживает только offset=0 — см. lib/searchGrouping.ts).
  const [groupLimit, setGroupLimit] = useState(30);
  const [groupScope, setGroupScope] = useState<"catalog" | "full">("catalog");
  const [groupExhausted, setGroupExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // отбрасываем ответы устаревших запросов (быстрый ввод, гонка catalog/full)
  const seqRef = useRef(0);

  const query = q.trim();

  // Плоский список для очереди воспроизведения (канон → варианты → singles,
  // в порядке карточек) — тот же принцип, что в веб-аналоге T41.
  const groupedFlat = useMemo(() => flattenGroupedResults(groupedResults ?? []), [groupedResults]);

  // живой каталожный поиск с debounce («Мгновенный поиск»; выкл = по Enter)
  useEffect(() => {
    if (!canSearch) return;
    if (query.length < 2) {
      seqRef.current += 1;
      setResults(null);
      setGroupedResults(null);
      setGroupLimit(30);
      setGroupExhausted(false);
      setError(null);
      setBusy(false);
      return;
    }
    if (!instantSearch) return;
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      if (searchGrouping) {
        setGroupScope("catalog");
        setGroupLimit(30);
        setGroupExhausted(false);
        api
          .searchGrouped(query, { scope: "catalog", limit: 30 })
          .then((found) => {
            if (seqRef.current === seq) {
              setGroupedResults(found);
              setResults(null);
            }
          })
          .catch(() => undefined); // живой ввод ошибок не показывает — есть полный поиск
      } else {
        api
          .search(query, { scope: "catalog" })
          .then((found) => {
            if (seqRef.current === seq) {
              setResults(found);
              setGroupedResults(null);
            }
          })
          .catch(() => undefined);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [api, query, canSearch, instantSearch, searchGrouping]);

  const runSearch = async (scope: "catalog" | "full") => {
    if (!canSearch || query.length < 2 || busy) return;
    const seq = ++seqRef.current;
    setBusy(true);
    setError(null);
    try {
      if (searchGrouping) {
        setGroupScope(scope);
        setGroupLimit(30);
        setGroupExhausted(false);
        const found = await api.searchGrouped(query, { scope, limit: 30 });
        if (seqRef.current === seq) {
          setGroupedResults(found);
          setResults(null);
        }
      } else {
        const found = await api.search(query, { scope });
        if (seqRef.current === seq) {
          setResults(found);
          setGroupedResults(null);
        }
      }
    } catch (e) {
      if (seqRef.current === seq) setError(e instanceof Error ? e.message : "Что-то пошло не так");
    } finally {
      if (seqRef.current === seq) setBusy(false);
    }
  };
  // Enter/кнопка: «только каталог» не запускает yt-dlp на сервере
  const fullSearch = () => runSearch(searchScope === "catalog" ? "catalog" : "full");

  /** «Загрузить ещё» (grouped-режим): group=1 сервера поддерживает только
   *  offset=0 — «ещё» растит limit целиком (30→60→90), группировка
   *  пересобирается заново над бОльшим пулом (task-T37-brief.md п.3). Если
   *  рост limit не добавил ни одного трека в плоский счёт — каталог
   *  исчерпан (кнопка прячется), это отдельно от достижения потолка 90. */
  const loadMoreGrouped = async () => {
    const next = nextGroupLimit(groupLimit);
    if (!canSearch || query.length < 2 || moreBusy || next === null) return;
    const seq = ++seqRef.current;
    setMoreBusy(true);
    try {
      const found = await api.searchGrouped(query, { scope: groupScope, limit: next });
      if (seqRef.current === seq) {
        const prevCount = groupedFlat.length;
        const nextCount = flattenGroupedResults(found).length;
        setGroupedResults(found);
        setGroupLimit(next);
        if (nextCount <= prevCount) setGroupExhausted(true);
      }
    } catch (e) {
      if (seqRef.current === seq) setError(e instanceof Error ? e.message : "Не удалось загрузить ещё");
    } finally {
      if (seqRef.current === seq) setMoreBusy(false);
    }
  };

  const showServerResults = canSearch && query.length >= 2;
  const demoFound = TRACKS.filter(
    (t) => !query || `${t.title} ${t.artist}`.toLowerCase().includes(query.toLowerCase()),
  );

  /** Строка трека: тач-таргет/драг-источник (Alt+drag — файл, T18) — общая
   *  для плоского и grouped-режима, чтобы не дублировать DnD/очередь/
   *  лайк/меню. index не задан — TrackRow просто не рисует номер (варианты
   *  внутри развёрнутой группы). */
  const renderRow = (t: Track, index?: number) => (
    <div
      key={t.id}
      draggable
      onDragStart={(e) => {
        if (maybeAltFileDrag(e, () => exportCachedTrack(t.id, t.artist, t.title), (m) => onNotify(m, "x"))) return;
        startTrackDrag(e, t.id, t.title, t.artist);
      }}
    >
      <TrackRow
        index={index}
        cover={rowShow?.cover === false ? undefined : (t.coverUrl ?? undefined)}
        title={t.title}
        artist={t.artist}
        duration={fmtTime(t.durationSec)}
        showDuration={rowShow?.duration !== false}
        active={currentId === t.id}
        playing={currentId === t.id && playing}
        liked={likes.includes(t.id)}
        onPlay={() => onPlayCatalog(searchGrouping ? groupedFlat : (results ?? []), t.id)}
        onRowDoubleClick={onQueueCatalog ? () => onQueueCatalog(t) : undefined}
        onLike={() => onLike(t.id)}
        onMore={(e: React.MouseEvent) => onCatalogMenu(t, e)}
      />
    </div>
  );

  const isEmptyResults = searchGrouping
    ? groupedResults !== null && groupedResults.length === 0
    : results !== null && results.length === 0;
  const canLoadMoreGrouped =
    searchGrouping &&
    groupedResults !== null &&
    groupedResults.length > 0 &&
    !groupExhausted &&
    nextGroupLimit(groupLimit) !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div
        style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void fullSearch();
        }}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Трек, артист, альбом" autoFocus style={{ maxWidth: 520, flex: 1 }} />
        {showServerResults && searchScope !== "catalog" ? (
          <Button variant="secondary" icon="search" disabled={busy} onClick={() => void fullSearch()}>
            {busy ? "Ищем…" : "Искать в источниках"}
          </Button>
        ) : null}
      </div>

      {!canSearch && query.length >= 2 ? (
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
          Поиск по каталогу доступен после входа с аккаунтом: анонимный аккаунт живёт только на этом устройстве.
        </div>
      ) : null}

      {showServerResults ? (
        <div>
          <h2 style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-title)", fontWeight: 700, color: "var(--text-1)" }}>
            Результаты
          </h2>
          {error ? (
            <div style={{ padding: "0 0 var(--sp-3)", color: "var(--danger)", fontSize: "var(--fs-caption)" }}>{error}</div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {searchGrouping
              ? (groupedResults ?? []).map((r, i) =>
                  r.kind === "single" ? (
                    renderRow(r.track, i + 1)
                  ) : (
                    <SearchGroupCard key={`g-${r.canonical.id}-${i}`} result={r} index={i + 1} renderRow={renderRow} />
                  ),
                )
              : (results ?? []).map((t, i) => renderRow(t, i + 1))}
            {isEmptyResults && !busy ? (
              <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
                В каталоге пока пусто. Нажми «Искать в источниках» — поищем в YouTube Music и SoundCloud.
              </div>
            ) : null}
            {busy ? (
              <div style={{ padding: "var(--sp-4)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
                Ищем в источниках — это несколько секунд…
              </div>
            ) : null}
            {canLoadMoreGrouped ? (
              <div style={{ padding: "var(--sp-4)", display: "flex", justifyContent: "center" }}>
                <Button variant="secondary" disabled={moreBusy} onClick={() => void loadMoreGrouped()}>
                  {moreBusy ? "Загружаем…" : "Загрузить ещё"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div>
          <h2 style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-title)", fontWeight: 700, color: "var(--text-1)" }}>
            {query ? "Результаты" : "Часто ищут"}
          </h2>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {demoFound.map((t, i) => (
              <TrackRow
                key={t.id}
                index={i + 1}
                cover={rowShow?.cover === false ? undefined : t.cover}
                title={t.title}
                artist={t.artist}
                duration={fmtTime(t.duration)}
                showDuration={rowShow?.duration !== false}
                explicit={t.explicit}
                active={currentId === t.id}
                playing={currentId === t.id && playing}
                liked={likes.includes(t.id)}
                onPlay={() => onPlayTrack(t.id)}
                onRowDoubleClick={onQueueDemo ? () => onQueueDemo(t.id) : undefined}
                onLike={() => onLike(t.id)}
                onMore={(e: React.MouseEvent) => onTrackMenu(t, e)}
              />
            ))}
            {demoFound.length === 0 ? (
              <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
                Ничего не нашлось. Попробуй короче — например, имя артиста.
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
