"use client";

import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, SearchInput } from "@muza/ui";
import type { Track } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { TrackList } from "../../../src/components/TrackList";

/** Поиск веба: живой каталожный (на каждый ввод, мгновенный) + «Искать в
 *  источниках» (full — сервер дёргает yt-dlp, rate-limit). Модель десктопа. */
export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);

  // живой каталожный поиск с дебаунсом
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setNote(null);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(() => {
      getApi()
        .search(q, { scope: "catalog" })
        .then((tracks) => {
          if (seq.current === my) {
            setResults(tracks);
            setNote(tracks.length === 0 ? "В каталоге пусто — попробуй «Искать в источниках»." : null);
          }
        })
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const fullSearch = async () => {
    const q = query.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setNote("Ищем в источниках — это до полуминуты…");
    const my = ++seq.current;
    try {
      const tracks = await getApi().search(q, { scope: "full" });
      if (seq.current === my) {
        setResults(tracks);
        setNote(tracks.length === 0 ? "Ничего не нашлось." : null);
      }
    } catch (e) {
      if (seq.current === my) setNote(e instanceof Error ? e.message : "Поиск не удался");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", maxWidth: 900 }}>
      <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Трек, артист…" autoFocus style={{ flex: 1 }} />
        <Button variant="primary" icon="radar" disabled={busy || query.trim().length < 2} onClick={() => void fullSearch()}>
          {busy ? "Ищем…" : "Искать в источниках"}
        </Button>
      </div>
      {note ? <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{note}</p> : null}
      {query.trim().length < 2 && results.length === 0 ? (
        <EmptyState
          icon="search"
          title="Найди что угодно"
          hint="Каталог отвечает мгновенно, пока ты печатаешь. Не нашлось — «Искать в источниках» достанет трек из YouTube и SoundCloud."
        />
      ) : null}
      <TrackList tracks={results} />
    </div>
  );
}
