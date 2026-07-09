import { useState } from "react";
import { ChipGroup, Tile } from "@muza/ui";
import { PLAYLISTS, RELEASES, TRACKS } from "../data/demo";

export function LibraryView({ onPlayTrack }: { onPlayTrack: (id: string) => void }) {
  const [chip, setChip] = useState("Плейлисты");
  const items = chip === "Альбомы" ? RELEASES : PLAYLISTS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <h1 style={{ margin: 0, fontSize: "var(--fs-h1)", fontWeight: 700, color: "var(--text-1)" }}>Твоя медиатека</h1>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <ChipGroup items={["Плейлисты", "Альбомы", "Артисты"]} value={chip} onChange={setChip} />
      </div>
      {chip === "Артисты" ? (
        <div style={{ padding: "var(--sp-6) 0", color: "var(--text-2)" }}>
          Здесь появятся артисты, на которых ты подпишешься.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(176px, 1fr))",
            gap: "var(--sp-4)",
            paddingBottom: "var(--sp-6)",
          }}
        >
          {items.map((p) => (
            <Tile key={p.id} cover={p.cover} title={p.name} subtitle={p.meta} width="auto" onPlay={() => onPlayTrack(TRACKS[0].id)} />
          ))}
        </div>
      )}
    </div>
  );
}
