import { useEffect, useRef, useState } from "react";
import { Button, SearchInput, TrackRow } from "@muza/ui";
import type { MuzaApi, Track } from "@muza/api-client";
import { TRACKS, type DemoTrack } from "../data/demo";
import { fmtTime } from "../lib/format";

/** Поиск Stage 2 (слайс 3): живой ввод — мгновенный поиск по накопленному
 *  каталогу (scope=catalog), Enter/кнопка — полный с провайдерами (scope=full,
 *  секунды: два запуска yt-dlp на сервере). Воспроизведение серверных треков —
 *  Stage 3 (движок); пустой запрос показывает демо-полку как раньше. */
export function SearchView({
  api,
  canSearch,
  currentId,
  playing,
  likes,
  onPlayTrack,
  onLike,
  onTrackMenu,
  onNotify,
  onAddToPlaylist,
}: {
  api: MuzaApi;
  /** false у анонима: сервер его не знает, каталог недоступен. */
  canSearch: boolean;
  currentId: string;
  playing: boolean;
  likes: string[];
  onPlayTrack: (id: string) => void;
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
  onNotify: (text: string, icon?: string) => void;
  /** «⋯» на серверном треке: выбор плейлиста (слайс 4). */
  onAddToPlaylist: (t: Track) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[] | null>(null); // null — запроса ещё не было
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // отбрасываем ответы устаревших запросов (быстрый ввод, гонка catalog/full)
  const seqRef = useRef(0);

  const query = q.trim();

  // живой каталожный поиск с debounce
  useEffect(() => {
    if (!canSearch) return;
    if (query.length < 2) {
      seqRef.current += 1;
      setResults(null);
      setError(null);
      setBusy(false);
      return;
    }
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      api
        .search(query, { scope: "catalog" })
        .then((found) => {
          if (seqRef.current === seq) setResults(found);
        })
        .catch(() => undefined); // живой ввод ошибок не показывает — есть полный поиск
    }, 250);
    return () => clearTimeout(t);
  }, [api, query, canSearch]);

  const fullSearch = async () => {
    if (!canSearch || query.length < 2 || busy) return;
    const seq = ++seqRef.current;
    setBusy(true);
    setError(null);
    try {
      const found = await api.search(query, { scope: "full" });
      if (seqRef.current === seq) setResults(found);
    } catch (e) {
      if (seqRef.current === seq) setError(e instanceof Error ? e.message : "Что-то пошло не так");
    } finally {
      if (seqRef.current === seq) setBusy(false);
    }
  };

  const showServerResults = canSearch && query.length >= 2;
  const demoFound = TRACKS.filter(
    (t) => !query || `${t.title} ${t.artist}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div
        style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void fullSearch();
        }}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Трек, артист, альбом" autoFocus style={{ maxWidth: 520, flex: 1 }} />
        {showServerResults ? (
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
            {(results ?? []).map((t, i) => (
              <TrackRow
                key={t.id}
                index={i + 1}
                cover={t.coverUrl ?? undefined}
                title={t.title}
                artist={t.artist}
                duration={fmtTime(t.durationSec)}
                active={currentId === t.id}
                playing={currentId === t.id && playing}
                liked={likes.includes(t.id)}
                onPlay={() => onNotify("Воспроизведение — в Stage 3 (движок)", "hourglass")}
                onLike={() => onLike(t.id)}
                onMore={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onAddToPlaylist(t);
                }}
              />
            ))}
            {results !== null && results.length === 0 && !busy ? (
              <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
                В каталоге пока пусто. Нажми «Искать в источниках» — поищем в YouTube Music и SoundCloud.
              </div>
            ) : null}
            {busy ? (
              <div style={{ padding: "var(--sp-4)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
                Ищем в источниках — это несколько секунд…
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
                cover={t.cover}
                title={t.title}
                artist={t.artist}
                duration={fmtTime(t.duration)}
                explicit={t.explicit}
                active={currentId === t.id}
                playing={currentId === t.id && playing}
                liked={likes.includes(t.id)}
                onPlay={() => onPlayTrack(t.id)}
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
