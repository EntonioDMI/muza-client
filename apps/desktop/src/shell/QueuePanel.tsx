import { IconButton, TrackRow } from "@muza/ui";
import type { PlayerTrack } from "../player/types";
import { fmtTime } from "../lib/format";

export function QueuePanel({
  open,
  tracks,
  currentId,
  playing,
  onPlayTrack,
  onClose,
}: {
  open: boolean;
  tracks: PlayerTrack[];
  currentId: string;
  playing: boolean;
  onPlayTrack: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        right: "var(--gap-zone)",
        bottom: "calc(var(--h-playerbar) + 2 * var(--gap-zone))",
        width: 380,
        maxHeight: 420,
        borderRadius: "var(--r-lg)",
        background: "var(--glass-panel)",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        padding: "var(--sp-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        zIndex: 50,
        opacity: open ? 1 : 0,
        transform: open ? "translateY(0)" : "translateY(10px)",
        pointerEvents: open ? "auto" : "none",
        transition: "opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--sp-2)" }}>
        <span
          style={{
            fontSize: "var(--fs-caption)",
            fontWeight: 600,
            letterSpacing: "var(--ls-caps)",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Очередь
        </span>
        <IconButton icon="x" size="sm" label="Закрыть" onClick={onClose} style={{ width: 28, height: 28 }} iconSize={16} />
      </div>
      <div style={{ overflowY: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column" }}>
        {tracks.map((t, i) => (
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
            onPlay={() => onPlayTrack(t.id)}
          />
        ))}
      </div>
    </div>
  );
}
