"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState, Icon, Tabs } from "@muza/ui";
import type { HistoryItem, PlaylistMeta } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { TrackList } from "../../../src/components/TrackList";

/** Библиотека веба: плейлисты (просмотр/прослушивание) + история.
 *  Создание/импорт/локальные файлы — в десктопе. */
export default function LibraryPage() {
  const [tab, setTab] = useState("playlists");
  const [playlists, setPlaylists] = useState<PlaylistMeta[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    getApi()
      .getPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, []);

  useEffect(() => {
    if (tab !== "history" || history !== null) return;
    getApi()
      .getHistory(50)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [tab, history]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <h1 className="page-title">Библиотека</h1>
      <Tabs
        items={[
          { key: "playlists", label: "Плейлисты" },
          { key: "history", label: "История" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "playlists" ? (
        playlists === null ? (
          <p style={noteStyle}>Загрузка…</p>
        ) : playlists.length === 0 ? (
          <EmptyState
            icon="list-music"
            title="Плейлистов пока нет"
            hint="Создаются и импортируются в приложении для Windows — здесь появятся сразу и будут играть где угодно."
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--sp-3)" }}>
            {playlists.map((p) => (
              <Link
                key={p.id}
                href={`/playlist?id=${p.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                  padding: "var(--sp-3)",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface-2)",
                  textDecoration: "none",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "var(--r-xs)",
                    flex: "none",
                    background: "var(--accent-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={p.collaboratorsCount > 0 || p.role === "collaborator" ? "users" : "list-music"} size={22} color="var(--accent-text)" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontFamily: "var(--font-ui)",
                      fontWeight: 600,
                      fontSize: "var(--fs-body)",
                      color: "var(--text-1)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.name}
                  </span>
                  <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                    {p.trackCount} трек(ов)
                    {p.role === "collaborator" ? ` · от ${p.ownerUsername}` : ""}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )
      ) : history === null ? (
        <p style={noteStyle}>Загрузка…</p>
      ) : history.length === 0 ? (
        <EmptyState icon="history" title="История пуста" hint="Всё, что послушаешь, будет здесь — с любого устройства." />
      ) : (
        <TrackList tracks={history.map((h) => h.track)} />
      )}
    </div>
  );
}

const noteStyle: React.CSSProperties = { margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-3)" };
