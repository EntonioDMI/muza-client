import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, SearchInput, Shelf, TrackRow } from "@muza/ui";
import type { GroupedSearchResult, MuzaApi, PublicPlaylist, PublicPlaylistHit, Track } from "@muza/api-client";
import { fmtTime, primarySourceLabel } from "../lib/format";
import { trackRowL10n } from "../lib/dsLabels";
import { useWarmRow } from "../player/useWarmer";
import { useDrag } from "../shell/DragLayer";
import { exportCachedTrack, maybeAltFileDrag } from "../lib/dragOut";
import { flattenGroupedResults, loadMoreScope, nextGroupLimit } from "../lib/searchGrouping";
import { parsePlaylistCode, parsePlaylistHandle } from "../lib/playlistCode";
import { PublicPlaylistCard } from "./PublicPlaylistCard";
import { SearchGroupCard, type VersionsSlot } from "./SearchGroupCard";
import { useT } from "../i18n";

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
  onPlayCatalog,
  onQueueCatalog,
  rowShow,
  onLike,
  onNotify,
  onCatalogMenu,
  onOpenPlaylist,
  onPlaylistsChanged,
}: {
  api: MuzaApi;
  /** false у анонима: сервер его не знает, каталог недоступен. */
  canSearch: boolean;
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  likes: string[];
  /** Живой каталожный поиск при вводе (выкл = только по Enter/кнопке). */
  instantSearch?: boolean;
  /** «Где искать»: каталог + источники или только каталог (без yt-dlp). */
  searchScope?: "all" | "catalog";
  /** T37: группировка ремиксов/версий (настройки → Поиск). */
  searchGrouping?: boolean;
  /** Играть каталожный трек в контексте списка (Stage 3, движок). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** Дабл-клик = «в очередь» (настройка); нет — dblclick играет. */
  onQueueCatalog?: (t: Track) => void;
  /** Строка трека (настройка «Строка трека»): что показывать. */
  rowShow?: { cover: boolean; duration: boolean; album: boolean; source: boolean };
  onLike: (id: string) => void;
  onNotify: (text: string, icon?: string) => void;
  /** «⋯» на серверном треке: меню Stage 4 (плейлист, версии/источники). */
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  /** Открыть плейлист из выдачи/по коду (2026-07-17, публичные плейлисты). */
  onOpenPlaylist: (id: string) => void;
  /** Подписка из выдачи прошла — App перечитывает список плейлистов. */
  onPlaylistsChanged?: () => void;
}) {
  const { t, lang } = useT();
  const [q, setQ] = useState("");
  // Публичные плейлисты (2026-07-17): режим кода PL_… + хиты обычного поиска
  const [codeResult, setCodeResult] = useState<PublicPlaylist | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [playlistHits, setPlaylistHits] = useState<PublicPlaylistHit[]>([]);
  // на кого подписались В ЭТОЙ сессии поиска (кнопка гаснет; сервер идемпотентен)
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [results, setResults] = useState<Track[] | null>(null); // null — запроса ещё не было (плоский режим)
  const [groupedResults, setGroupedResults] = useState<GroupedSearchResult[] | null>(null); // grouped-режим
  // «Загрузить ещё» в grouped-режиме: лестница limit шагом 30 (group=1
  // сервера поддерживает только offset=0 — см. lib/searchGrouping.ts).
  const [groupLimit, setGroupLimit] = useState(30);
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

  /** Запрос-код PL_… или @адрес (2026-07-17): весь запрос целиком — прямой
   *  lookup одной карточки, треки не ищем. */
  const playlistCode = parsePlaylistCode(query);
  const playlistHandle = playlistCode === null ? parsePlaylistHandle(query) : null;
  const playlistLookup = playlistCode !== null || playlistHandle !== null;

  // Режим кода/адреса: debounce-запрос метаданных (rate-limit на сервере общий)
  useEffect(() => {
    if (!canSearch || !playlistLookup) {
      setCodeResult(null);
      setCodeError(null);
      setCodeBusy(false);
      return;
    }
    const seq = ++seqRef.current;
    // код вытесняет трековую выдачу прошлого запроса
    setResults(null);
    setGroupedResults(null);
    setPlaylistHits([]);
    setError(null);
    setBusy(false);
    setCodeBusy(true);
    setCodeError(null);
    const timer = setTimeout(() => {
      (playlistCode !== null
        ? api.getPublicPlaylistByCode(playlistCode)
        : api.getPublicPlaylistByHandle(playlistHandle ?? ""))
        .then((p) => {
          if (seqRef.current === seq) {
            setCodeResult(p);
            setCodeBusy(false);
          }
        })
        .catch((e: unknown) => {
          if (seqRef.current === seq) {
            setCodeResult(null);
            setCodeError(e instanceof Error ? e.message : t("views.search.somethingWrong"));
            setCodeBusy(false);
          }
        });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canSearch, playlistCode, playlistHandle]);

  // Хиты публичных плейлистов: тот же debounce, что живой каталожный поиск.
  // Эндпоинт дешёвый (десятки строк, TS-скоринг) — на полный поиск не ждём.
  useEffect(() => {
    if (!canSearch || playlistLookup || query.length < 2) {
      setPlaylistHits([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      api
        .searchPublicPlaylists(query)
        .then((hits) => {
          if (!stale) setPlaylistHits(hits);
        })
        // ошибка плейлистов НЕ трогает трековую выдачу — просто без витрины
        .catch(() => {
          if (!stale) setPlaylistHits([]);
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [api, canSearch, playlistCode, query]);

  // живой каталожный поиск с debounce («Мгновенный поиск»; выкл = по Enter)
  useEffect(() => {
    if (!canSearch) return;
    if (playlistLookup) return; // режим кода/адреса: трековый поиск молчит
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
  }, [api, query, canSearch, instantSearch, searchGrouping, playlistCode]);

  const runSearch = async (scope: "catalog" | "full") => {
    if (!canSearch || query.length < 2 || busy || playlistLookup) return;
    const seq = ++seqRef.current;
    setBusy(true);
    setError(null);
    try {
      if (searchGrouping) {
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
      if (seqRef.current === seq) setError(e instanceof Error ? e.message : t("views.search.somethingWrong"));
    } finally {
      if (seqRef.current === seq) setBusy(false);
    }
  };
  // Enter/кнопка: «только каталог» не запускает yt-dlp на сервере
  const fullSearch = () => runSearch(searchScope === "catalog" ? "catalog" : "full");

  /** «Загрузить ещё» (grouped-режим): group=1 сервера поддерживает только
   *  offset=0 — «ещё» растит limit целиком (шаг 30), группировка
   *  пересобирается заново над бОльшим пулом (task-T37-brief.md п.3). Если
   *  рост limit не добавил ни одного трека в плоский счёт — источники
   *  исчерпаны (кнопка прячется), это отдельно от достижения потолка лестницы.
   *
   *  Scope берётся из настройки «Где искать», а НЕ из того, чем искали в
   *  прошлый раз: живой ввод ищет по каталогу, и «ещё» повторял именно его —
   *  листал каталог и в источники не ходил никогда (см. loadMoreScope). */
  const loadMoreGrouped = async () => {
    const next = nextGroupLimit(groupLimit);
    if (!canSearch || query.length < 2 || moreBusy || next === null) return;
    const seq = ++seqRef.current;
    setMoreBusy(true);
    try {
      const found = await api.searchGrouped(query, { scope: loadMoreScope(searchScope), limit: next });
      if (seqRef.current === seq) {
        const prevCount = groupedFlat.length;
        const nextCount = flattenGroupedResults(found).length;
        setGroupedResults(found);
        setGroupLimit(next);
        if (nextCount <= prevCount) setGroupExhausted(true);
      }
    } catch (e) {
      if (seqRef.current === seq) setError(e instanceof Error ? e.message : t("views.search.loadMoreFailed"));
    } finally {
      if (seqRef.current === seq) setMoreBusy(false);
    }
  };

  const showServerResults = canSearch && query.length >= 2;
  const { dragSource } = useDrag();
  const warmRow = useWarmRow();

  /** Строка трека: тач-таргет/драг-источник (Alt+drag — файл, T18) — общая
   *  для плоского и grouped-режима, чтобы не дублировать DnD/очередь/
   *  лайк/меню. index не задан — TrackRow просто не рисует номер (варианты
   *  внутри развёрнутой группы). versions задан только у канона группы.
   *
   *  showVersions включён для ВСЕЙ grouped-выдачи, а не только у групп: в ней
   *  карточки-группы и одиночные треки идут вперемешку, и слот версий обязан
   *  быть зарезервирован у всех — иначе правый кластер (лайк/таймкод/«⋯»)
   *  разъезжается между соседними строками. */
  const renderRow = (tr: Track, index?: number, versions?: VersionsSlot) => (
    <div
      key={tr.id}
      draggable
      onDragStart={(e) => {
        // Сюда попадаем только с зажатым Alt: для остального dragSource гасит
        // draggable, иначе native drag убил бы pointer-перенос (pointercancel).
        if (maybeAltFileDrag(e, () => exportCachedTrack(tr.id, tr.artist, tr.title), (m) => onNotify(m, "x"))) return;
        e.preventDefault();
      }}
      {...dragSource({ id: tr.id, title: tr.title, artist: tr.artist, cover: tr.coverUrl, kind: "track" })}
      {...warmRow(tr.id)}
    >
      <TrackRow
        {...trackRowL10n(t)}
        index={index}
        cover={tr.coverUrl}
        showCover={rowShow?.cover !== false}
        title={tr.title}
        artist={tr.artist}
        album={rowShow?.album ? (tr.album ?? undefined) : undefined}
        duration={fmtTime(tr.durationSec)}
        showDuration={rowShow?.duration !== false}
        // Бейдж источника в ПОИСКЕ виден всегда (запрос владельца 14.07:
        // «откуда возьмётся звук» — свойство выдачи); тумблер rowShow.source
        // добавляет его в остальные списки и этот ряд не гасит.
        source={primarySourceLabel(tr.sources, lang)}
        showVersions={searchGrouping}
        versionCount={versions?.count}
        versionsExpanded={versions?.expanded}
        onVersions={versions?.onToggle}
        versionsLabel={versions?.label}
        active={currentId === tr.id}
        playing={currentId === tr.id && playing}
        liked={likes.includes(tr.id)}
        onPlay={() => onPlayCatalog(searchGrouping ? groupedFlat : (results ?? []), tr.id)}
        onRowDoubleClick={onQueueCatalog ? () => onQueueCatalog(tr) : undefined}
        onLike={() => onLike(tr.id)}
        onMore={(e: React.MouseEvent) => onCatalogMenu(tr, e)}
      />
    </div>
  );

  /** Подписка из выдачи/по коду. Свой плейлист сервер отобьёт 400-кой —
   *  честно показываем его текст тостом. */
  const followFromSearch = async (p: PublicPlaylist) => {
    try {
      await api.followPlaylist(p.id);
      setFollowedIds((ids) => (ids.includes(p.id) ? ids : [...ids, p.id]));
      onNotify(t("views.search.publicPlaylist.added"), "list-music");
      onPlaylistsChanged?.();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("views.search.somethingWrong"), "x");
    }
  };

  // Плашка «Лучший результат» — только совпадение ПО НАЗВАНИЮ (спека 17.07);
  // совпавшие лишь по артистам живут в витрине под выдачей.
  const heroHit = playlistHits.find((h) => h.nameMatched) ?? null;
  const shelfHits = playlistHits.filter((h) => h.id !== heroHit?.id);

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
        <SearchInput value={q} onChange={setQ} placeholder={t("views.search.placeholder")} autoFocus style={{ maxWidth: 520, flex: 1 }} />
        {showServerResults && searchScope !== "catalog" ? (
          <Button variant="secondary" icon="search" disabled={busy} onClick={() => void fullSearch()}>
            {busy ? t("views.search.searching") : t("views.search.searchSources")}
          </Button>
        ) : null}
      </div>

      {playlistLookup && canSearch ? (
        // Режим кода PL_… / @адреса: одна карточка вместо трековой выдачи
        <div data-testid="playlist-code-result">
          {codeResult ? (
            <PublicPlaylistCard
              playlist={codeResult}
              variant="hero"
              onOpen={() => onOpenPlaylist(codeResult.id)}
              onFollow={() => void followFromSearch(codeResult)}
              following={followedIds.includes(codeResult.id)}
            />
          ) : codeBusy ? (
            <div style={{ padding: "var(--sp-4)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
              {t("views.search.publicPlaylist.codeSearching")}
            </div>
          ) : codeError ? (
            <EmptyState icon="list-music" title={codeError} />
          ) : null}
        </div>
      ) : showServerResults ? (
        <div>
          {heroHit ? (
            <div style={{ margin: "0 0 var(--sp-5)" }}>
              <div
                style={{
                  margin: "0 0 var(--sp-2)",
                  fontSize: "var(--fs-caption)",
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {t("views.search.publicPlaylist.topResult")}
              </div>
              <PublicPlaylistCard
                playlist={heroHit}
                variant="hero"
                onOpen={() => onOpenPlaylist(heroHit.id)}
                onFollow={() => void followFromSearch(heroHit)}
                following={followedIds.includes(heroHit.id)}
              />
            </div>
          ) : null}
          <h2 style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-title)", fontWeight: 700, color: "var(--text-1)" }}>
            {t("views.search.results")}
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
              : (results ?? []).map((tr, i) => renderRow(tr, i + 1))}
            {isEmptyResults && !busy ? (
              <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
                {t("views.search.catalogEmpty")}
              </div>
            ) : null}
            {busy ? (
              <div style={{ padding: "var(--sp-4)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
                {t("views.search.searchingSources")}
              </div>
            ) : null}
            {canLoadMoreGrouped ? (
              <div style={{ padding: "var(--sp-4)", display: "flex", justifyContent: "center" }}>
                <Button variant="secondary" disabled={moreBusy} onClick={() => void loadMoreGrouped()}>
                  {moreBusy ? t("views.search.loadingMore") : t("views.search.loadMore")}
                </Button>
              </div>
            ) : null}
          </div>
          {shelfHits.length > 0 ? (
            // Витрина «как на главной» под выдачей (решение владельца 17.07);
            // задел под будущие категории — просто ещё один Shelf рядом.
            <div style={{ marginTop: "var(--sp-6)" }} data-testid="public-playlists-shelf">
              <Shelf title={t("views.search.publicPlaylist.shelf")}>
                {shelfHits.map((h) => (
                  <PublicPlaylistCard key={h.id} playlist={h} variant="tile" onOpen={() => onOpenPlaylist(h.id)} />
                ))}
              </Shelf>
            </div>
          ) : null}
        </div>
      ) : !canSearch ? (
        // Аноним каталог не ищет: сервер его не знает
        <EmptyState icon="user" title={t("views.search.anon.title")} hint={t("views.search.needsAccount")} />
      ) : (
        // Запрос пустой/короткий. Раньше здесь рисовались 4 выдуманных трека
        // из макета Stage 1 под заголовком «Часто ищут» — их видел КАЖДЫЙ,
        // включая только что зарегистрировавшегося.
        <EmptyState icon="search" title={t("views.search.start.title")} hint={t("views.search.start.hint")} />
      )}
    </div>
  );
}
