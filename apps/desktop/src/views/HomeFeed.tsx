import { useState } from "react";
import { ChipGroup, Shelf, Tile } from "@muza/ui";
import { PLAYLISTS, RELEASES, TRACKS } from "../data/demo";
import type { View } from "../types";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

export function HomeFeed({
  currentId,
  playing,
  onPlayTrack,
  onOpen,
}: {
  currentId: string;
  playing: boolean;
  onPlayTrack: (id: string) => void;
  onOpen: (v: View) => void;
}) {
  const [chip, setChip] = useState("Всё");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "var(--fs-greet)",
          letterSpacing: "var(--ls-display)",
          color: "var(--text-1)",
          lineHeight: "var(--lh-tight)",
        }}
      >
        {greeting()}
      </h1>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <ChipGroup items={["Всё", "Музыка", "Плейлисты", "С текстом"]} value={chip} onChange={setChip} />
      </div>
      <Shelf title="Продолжить слушать">
        {TRACKS.map((t) => (
          <Tile
            key={t.id}
            cover={t.cover}
            title={t.title}
            subtitle={t.artist}
            playing={currentId === t.id && playing}
            onPlay={() => onPlayTrack(t.id)}
            onClick={() => onPlayTrack(t.id)}
          />
        ))}
      </Shelf>
      <Shelf title="Собрано для тебя" onAction={() => onOpen("library")}>
        {PLAYLISTS.map((p) => (
          <Tile key={p.id} cover={p.cover} title={p.name} subtitle={p.meta} onPlay={() => onPlayTrack(TRACKS[0].id)} />
        ))}
      </Shelf>
      <Shelf title="Новые релизы" onAction={() => onOpen("library")} style={{ paddingBottom: "var(--sp-6)" }}>
        {RELEASES.map((r) => (
          <Tile key={r.id} cover={r.cover} title={r.name} subtitle={r.meta} onPlay={() => onPlayTrack(TRACKS[1].id)} />
        ))}
      </Shelf>
    </div>
  );
}
