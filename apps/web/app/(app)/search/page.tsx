"use client";

import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, SearchInput } from "@muza/ui";
import type { GroupedSearchResult, Track } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { GroupedTrackList } from "../../../src/components/GroupedTrackList";
import { TrackList } from "../../../src/components/TrackList";
import { usePrefs } from "../../../src/prefs";

/** Поиск веба: живой каталожный (на каждый ввод, мгновенный) + «Искать в
 *  источниках» (full — сервер дёргает yt-dlp, rate-limit). Модель десктопа.
 *  T41: preference searchGrouping (Настройки → Поиск, дефолт true) решает,
 *  бьёт ли сервер ?group=1 (карточки-группы ремиксов) или старый плоский
 *  контракт — оба режима держим отдельными списками результатов, чтобы
 *  выключенная группировка гарантированно оставалась старым плоским видом. */
export default function SearchPage() {
  const { prefs } = usePrefs();
  const grouping = prefs.searchGrouping;
  const [query, setQuery] = useState("");
  const [flatResults, setFlatResults] = useState<Track[]>([]);
  const [groupedResults, setGroupedResults] = useState<GroupedSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);

  // живой каталожный поиск с дебаунсом
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFlatResults([]);
      setGroupedResults([]);
      setNote(null);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(() => {
      const api = getApi();
      if (grouping) {
        api
          .searchGrouped(q, { scope: "catalog" })
          .then((items) => {
            if (seq.current !== my) return;
            setGroupedResults(items);
            setFlatResults([]);
            setNote(items.length === 0 ? "В каталоге пусто — попробуй «Искать в источниках»." : null);
          })
          .catch(() => undefined);
      } else {
        api
          .search(q, { scope: "catalog" })
          .then((tracks) => {
            if (seq.current !== my) return;
            setFlatResults(tracks);
            setGroupedResults([]);
            setNote(tracks.length === 0 ? "В каталоге пусто — попробуй «Искать в источниках»." : null);
          })
          .catch(() => undefined);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, grouping]);

  const fullSearch = async () => {
    const q = query.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setNote("Ищем в источниках — это до полуминуты…");
    const my = ++seq.current;
    try {
      const api = getApi();
      if (grouping) {
        const items = await api.searchGrouped(q, { scope: "full" });
        if (seq.current === my) {
          setGroupedResults(items);
          setFlatResults([]);
          setNote(items.length === 0 ? "Ничего не нашлось." : null);
        }
      } else {
        const tracks = await api.search(q, { scope: "full" });
        if (seq.current === my) {
          setFlatResults(tracks);
          setGroupedResults([]);
          setNote(tracks.length === 0 ? "Ничего не нашлось." : null);
        }
      }
    } catch (e) {
      if (seq.current === my) setNote(e instanceof Error ? e.message : "Поиск не удался");
    } finally {
      setBusy(false);
    }
  };

  const hasResults = grouping ? groupedResults.length > 0 : flatResults.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", maxWidth: 900 }}>
      {/* flexWrap — иначе SearchInput+Button не влезают рядом на 375px (ни один
          не может сжаться ниже своего min-content): найдено живой проверкой
          T41 на мобильном, было так и до группировки — попутный фикс. */}
      <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Трек, артист…" autoFocus style={{ flex: 1, minWidth: 200 }} />
        <Button variant="primary" icon="radar" disabled={busy || query.trim().length < 2} onClick={() => void fullSearch()}>
          {busy ? "Ищем…" : "Искать в источниках"}
        </Button>
      </div>
      {note ? <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{note}</p> : null}
      {query.trim().length < 2 && !hasResults ? (
        <EmptyState
          icon="search"
          title="Найди что угодно"
          hint="Каталог отвечает мгновенно, пока ты печатаешь. Не нашлось — «Искать в источниках» достанет трек из YouTube и SoundCloud."
        />
      ) : null}
      {grouping ? <GroupedTrackList results={groupedResults} /> : <TrackList tracks={flatResults} />}
    </div>
  );
}
