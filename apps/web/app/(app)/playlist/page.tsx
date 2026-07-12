"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Icon } from "@muza/ui";
import type { PlaylistDetail } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { usePlayer } from "../../../src/player";
import { TrackList } from "../../../src/components/TrackList";

/** Страница плейлиста. id — query-параметр (`/playlist?id=…`): статический
 *  экспорт Next не умеет динамические сегменты без generateStaticParams. */

function PlaylistBody() {
  const params = useSearchParams();
  const id = params.get("id");
  const { playContext } = usePlayer();
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!id) return;
    getApi()
      .getPlaylist(id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Плейлист не найден"));
  }, [id]);

  if (!id) return <p style={noteStyle}>Плейлист не указан.</p>;
  if (error) return <p style={noteStyle}>{error}</p>;
  if (!detail) return <p style={noteStyle}>Загрузка…</p>;

  const playable = detail.tracks.filter((t) => !t.localHash);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
        <span
          aria-hidden="true"
          style={{
            width: 72,
            height: 72,
            borderRadius: "var(--r-md)",
            flex: "none",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={detail.collaborators.length > 0 ? "users" : "list-music"} size={30} color="var(--accent-text)" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="page-title" style={{ fontSize: 24 }}>
            {detail.name}
          </h1>
          <p style={{ margin: "4px 0 0", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            {detail.tracks.length} трек(ов)
            {!detail.isOwner && detail.ownerUsername ? ` · от ${detail.ownerUsername}` : ""}
          </p>
        </div>
        <Button variant="primary" icon="play" disabled={playable.length === 0} onClick={() => playContext(detail.tracks, 0)}>
          Слушать
        </Button>
      </div>
      {detail.tracks.length === 0 ? <p style={noteStyle}>Плейлист пуст.</p> : <TrackList tracks={detail.tracks} />}
    </div>
  );
}

export default function PlaylistPage() {
  // useSearchParams в статическом экспорте обязан жить под Suspense
  return (
    <Suspense fallback={<p style={noteStyle}>Загрузка…</p>}>
      <PlaylistBody />
    </Suspense>
  );
}

const noteStyle: React.CSSProperties = { margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-3)" };
