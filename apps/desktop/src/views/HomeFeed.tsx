import { useState } from "react";
import { ChipGroup, Shelf, Tile, TrackRow } from "@muza/ui";
import { PLAYLISTS, RELEASES, TRACKS, type DemoTrack } from "../data/demo";
import { fmtTime } from "../lib/format";
import type { View } from "../types";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

export function HomeFeed({
  greetName,
  currentId,
  playing,
  likes,
  onPlayTrack,
  onLike,
  onTrackMenu,
  onOpen,
}: {
  /** Ник для приветствия; null у анонима — просто «Доброе утро». */
  greetName: string | null;
  currentId: string;
  playing: boolean;
  likes: string[];
  onPlayTrack: (id: string) => void;
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
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
        {greetName ? `${greeting()}, ${greetName}!` : greeting()}
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
      <Shelf title="Новые релизы" onAction={() => onOpen("library")}>
        {RELEASES.map((r) => (
          <Tile key={r.id} cover={r.cover} title={r.name} subtitle={r.meta} onPlay={() => onPlayTrack(TRACKS[1].id)} />
        ))}
      </Shelf>
      {/* Простой список под полками — «как библиотека», без тяжёлых плиток */}
      <div style={{ paddingBottom: "var(--sp-6)" }}>
        <h2 style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-title)", fontWeight: 700, color: "var(--text-1)" }}>
          Подборка
        </h2>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {TRACKS.map((t, i) => (
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
        </div>
      </div>
    </div>
  );
}
