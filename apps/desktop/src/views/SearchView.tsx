import { useState } from "react";
import { SearchInput, TrackRow } from "@muza/ui";
import { TRACKS, type DemoTrack } from "../data/demo";
import { fmtTime } from "../lib/format";

export function SearchView({
  currentId,
  playing,
  likes,
  onPlayTrack,
  onLike,
  onTrackMenu,
}: {
  currentId: string;
  playing: boolean;
  likes: string[];
  onPlayTrack: (id: string) => void;
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
}) {
  const [q, setQ] = useState("");
  const found = TRACKS.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <SearchInput value={q} onChange={setQ} placeholder="Трек, артист, альбом" autoFocus style={{ maxWidth: 520 }} />
      <div>
        <h2 style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-title)", fontWeight: 700, color: "var(--text-1)" }}>
          {q ? "Результаты" : "Часто ищут"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {found.map((t, i) => (
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
          {found.length === 0 ? (
            <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
              Ничего не нашлось. Попробуй короче — например, имя артиста.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
