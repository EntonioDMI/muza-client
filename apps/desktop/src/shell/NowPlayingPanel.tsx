import { IconButton, Lyrics } from "@muza/ui";
import type { LyricLine } from "../data/demo";
import type { PlayerTrack } from "../player/types";

export function NowPlayingPanel({
  track,
  lyrics,
  lyricsLoading = false,
  liked,
  onLike,
  activeLine,
  lyricsAutoScroll = true,
  onSeekLine,
  onExplain,
}: {
  track: PlayerTrack;
  /** Строки текста: демо — локальные, каталог — LRCLIB с сервера (слайс 4). */
  lyrics: LyricLine[];
  /** Текст ещё грузится — «Ищем текст…» вместо «Текст не найден». */
  lyricsLoading?: boolean;
  liked: boolean;
  onLike: () => void;
  activeLine: number;
  /** Настройка «Автоскролл» (Тексты): следовать ли за активной строкой. */
  lyricsAutoScroll?: boolean;
  onSeekLine: (i: number) => void;
  /** Открыть общую модалку смысла для выделенной строки. */
  onExplain: (index: number) => void;
}) {
  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-4)",
        padding: "var(--pad-zone)",
        borderRadius: "var(--r-lg)",
        // зональная прозрачность: своя плотность поверхности + blur (вкл. зонами)
        background: "var(--glass-nowplaying, var(--surface-1))",
        backdropFilter: "var(--bf-zone, none)",
        WebkitBackdropFilter: "var(--bf-zone, none)",
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
            {track.album ? `${track.artist} · ${track.album}` : track.artist}
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
        {lyrics.length > 0 ? (
          <Lyrics
            lines={lyrics}
            activeIndex={activeLine}
            autoScroll={lyricsAutoScroll}
            onSeek={onSeekLine}
            onExplain={onExplain}
            style={{ height: "100%" }}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-3)",
              fontSize: "var(--fs-caption)",
            }}
          >
            {lyricsLoading ? "Ищем текст…" : "Текст не найден"}
          </div>
        )}
      </div>
    </aside>
  );
}
