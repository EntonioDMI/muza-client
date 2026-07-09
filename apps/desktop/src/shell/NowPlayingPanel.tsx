import { IconButton, Lyrics } from "@muza/ui";
import type { DemoTrack } from "../data/demo";

export function NowPlayingPanel({
  track,
  liked,
  onLike,
  activeLine,
  onSeekLine,
}: {
  track: DemoTrack;
  liked: boolean;
  onLike: () => void;
  activeLine: number;
  onSeekLine: (i: number) => void;
}) {
  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-4)",
        padding: "var(--pad-zone)",
        borderRadius: "var(--r-lg)",
        background: "var(--surface-1)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-caption)",
          fontWeight: 600,
          letterSpacing: "var(--ls-caps)",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        Сейчас играет
      </span>
      <img
        key={track.id}
        src={track.cover}
        alt=""
        className="muza-view"
        style={{ width: "100%", aspectRatio: "1", borderRadius: "var(--r-md)", objectFit: "cover" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-strong)",
              fontWeight: 600,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </div>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
            {track.artist} · {track.album}
          </div>
        </div>
        <IconButton icon="heart" active={liked} label="Нравится" onClick={onLike} />
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          padding: "0 var(--sp-4)",
          overflow: "hidden",
        }}
      >
        <Lyrics lines={track.lyrics} activeIndex={activeLine} onSeek={onSeekLine} style={{ height: "100%" }} />
      </div>
    </aside>
  );
}
