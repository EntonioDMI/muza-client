import { useEffect, useState } from "react";
import { Icon, IconButton, Lyrics } from "@muza/ui";
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
  // «Режим смысла»: открытая аннотация строки (пунктирные строки кликабельны)
  const [explain, setExplain] = useState<number | null>(null);
  useEffect(() => setExplain(null), [track.id]);
  const noted = explain !== null ? track.lyrics[explain] : null;

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
        <IconButton icon="heart" active={liked} filled={liked} label="Нравится" onClick={onLike} />
      </div>
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          padding: "0 var(--sp-4)",
          overflow: "hidden",
        }}
      >
        <Lyrics
          lines={track.lyrics}
          activeIndex={activeLine}
          onSeek={onSeekLine}
          onExplain={(i: number) => setExplain((cur) => (cur === i ? null : i))}
          style={{ height: "100%" }}
        />
        {noted ? (
          // Карточка «смысл строки»: стекло поверх текста, снизу — как подсказка Genius
          <div
            className="muza-view"
            style={{
              position: "absolute",
              left: "var(--sp-3)",
              right: "var(--sp-3)",
              bottom: "var(--sp-3)",
              borderRadius: "var(--r-md)",
              background: "var(--glass-panel)",
              backdropFilter: "blur(var(--blur-glass))",
              WebkitBackdropFilter: "blur(var(--blur-glass))",
              padding: "var(--sp-4)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-2)",
              boxShadow: "0 12px 40px rgba(0,0,0,.35)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <Icon name="sparkles" size={15} color="var(--accent-text)" />
              <span
                style={{
                  flex: 1,
                  fontSize: "var(--fs-caption)",
                  fontWeight: 600,
                  letterSpacing: "var(--ls-caps)",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                }}
              >
                Смысл строки
              </span>
              <IconButton icon="x" size="sm" label="Закрыть" onClick={() => setExplain(null)} style={{ width: 26, height: 26 }} iconSize={14} />
            </div>
            <div style={{ fontSize: "var(--fs-caption)", fontWeight: 600, color: "var(--accent-text)", lineHeight: 1.45 }}>
              «{noted.text}»
            </div>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.6 }}>{noted.note}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>Режим смысла · демо (Genius-аннотации — Stage 5)</div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
