import { Icon, IconButton, Slider, Tooltip } from "@muza/ui";
import type { DemoTrack } from "../data/demo";
import { fmtTime } from "../lib/format";

export function PlayerBar({
  track,
  playing,
  onTogglePlay,
  onPrev,
  onNext,
  pos,
  onSeek,
  vol,
  onVol,
  liked,
  onLike,
  shuffle,
  onShuffle,
  repeat,
  onRepeat,
  lyricsOn,
  onLyrics,
  queueOn,
  onQueue,
  onExpand,
}: {
  track: DemoTrack;
  playing: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  pos: number;
  onSeek: (v: number) => void;
  vol: number;
  onVol: (v: number) => void;
  liked: boolean;
  onLike: () => void;
  shuffle: boolean;
  onShuffle: () => void;
  repeat: boolean;
  onRepeat: () => void;
  lyricsOn: boolean;
  onLyrics: () => void;
  queueOn: boolean;
  onQueue: () => void;
  onExpand: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: "var(--gap-zone)",
        right: "var(--gap-zone)",
        bottom: "var(--gap-zone)",
        height: "var(--h-playerbar)",
        borderRadius: "var(--r-lg)",
        background: "var(--glass-panel)",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: "var(--sp-5)",
        padding: "0 var(--sp-5)",
        zIndex: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
        <Tooltip label="Режим прослушивания">
          <img
            key={track.id}
            src={track.cover}
            alt=""
            className="muza-view"
            style={{
              width: "var(--size-cover-bar)",
              height: "var(--size-cover-bar)",
              borderRadius: "var(--r-sm)",
              flex: "none",
              cursor: "pointer",
            }}
            onClick={onExpand}
          />
        </Tooltip>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-body)",
              fontWeight: 600,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </div>
          <div
            style={{
              fontSize: "var(--fs-caption)",
              color: "var(--text-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.artist}
          </div>
        </div>
        <Tooltip label="Нравится">
          <IconButton icon="heart" size="sm" active={liked} label="Нравится" onClick={onLike} />
        </Tooltip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <Tooltip label="Перемешать">
            <IconButton icon="shuffle" size="sm" active={shuffle} label="Перемешать" onClick={onShuffle} />
          </Tooltip>
          <Tooltip label="Предыдущий">
            <IconButton icon="skip-back" label="Предыдущий" onClick={onPrev} />
          </Tooltip>
          <IconButton
            icon={playing ? "pause" : "play"}
            variant="accent"
            label={playing ? "Пауза" : "Слушать"}
            onClick={onTogglePlay}
          />
          <Tooltip label="Следующий">
            <IconButton icon="skip-forward" label="Следующий" onClick={onNext} />
          </Tooltip>
          <Tooltip label="Повтор">
            <IconButton icon="repeat" size="sm" active={repeat} label="Повтор" onClick={onRepeat} />
          </Tooltip>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", width: 480 }}>
          <span
            style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums", width: 36, textAlign: "right" }}
          >
            {fmtTime(pos)}
          </span>
          <Slider value={pos} max={track.duration} onChange={onSeek} ariaLabel="Прогресс" style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums", width: 36 }}>
            {fmtTime(track.duration)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-2)" }}>
        <Tooltip label="Текст">
          <IconButton icon="mic-vocal" size="sm" active={lyricsOn} label="Текст" onClick={onLyrics} />
        </Tooltip>
        <Tooltip label="Очередь">
          <IconButton icon="list-music" size="sm" active={queueOn} label="Очередь" onClick={onQueue} />
        </Tooltip>
        <Icon name="volume-2" size={18} color="var(--text-2)" />
        <Slider value={vol} onChange={onVol} ariaLabel="Громкость" style={{ width: 110 }} />
        <Tooltip label="Во весь экран">
          <IconButton icon="maximize-2" size="sm" label="Режим прослушивания" onClick={onExpand} />
        </Tooltip>
      </div>
    </div>
  );
}
