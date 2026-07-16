import type React from "react";
import { Cover, EmptyState, IconButton, Lyrics } from "@muza/ui";
import type { LyricLine, PlayerTrack } from "../player/types";
import { useT } from "../i18n";

export function NowPlayingPanel({
  track,
  lyrics,
  lyricsLoading = false,
  liked,
  onLike,
  activeLine,
  lyricsAutoScroll = true,
  lyricsEndNote = true,
  onSeekLine,
  onExplain,
}: {
  /** null — ничего не играет: панель не исчезает (иначе схлопывалась бы
   *  колонка сетки окна), а показывает честное пустое состояние. */
  track: PlayerTrack | null;
  /** Строки текста — LRCLIB с сервера (слайс 4). */
  lyrics: LyricLine[];
  /** Текст ещё грузится — «Ищем текст…» вместо «Текст не найден». */
  lyricsLoading?: boolean;
  liked: boolean;
  onLike: () => void;
  activeLine: number;
  /** Настройка «Автоскролл» (Тексты): следовать ли за активной строкой. */
  lyricsAutoScroll?: boolean;
  /** Настройка «Нотка в конце» (Тексты): декоративный знак под текстом. */
  lyricsEndNote?: boolean;
  onSeekLine: (i: number) => void;
  /** Открыть общую модалку смысла для выделенной строки. */
  onExplain: (index: number) => void;
}) {
  const { t } = useT();
  const zoneStyle: React.CSSProperties = {
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
  };
  const heading = (
    <span
      style={{
        fontSize: "var(--fs-caption)",
        fontWeight: 600,
        letterSpacing: "var(--ls-caps)",
        textTransform: "uppercase",
        color: "var(--text-3)",
      }}
    >
      {t("nowPlaying.heading")}
    </span>
  );

  if (!track) {
    return (
      <aside style={zoneStyle}>
        {heading}
        <EmptyState
          icon="music-2"
          title={t("nowPlaying.empty.title")}
          hint={t("nowPlaying.empty.hint")}
          style={{ margin: "auto" }}
        />
      </aside>
    );
  }

  return (
    <aside style={zoneStyle}>
      {heading}
      <Cover key={track.id} src={track.cover} radius="var(--r-md)" className="muza-view" />
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
        <IconButton icon="heart" active={liked} filled={liked} label={t("common.like")} onClick={onLike} />
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
            endNote={lyricsEndNote}
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
            {lyricsLoading ? t("player.lyricsSearching") : t("player.lyricsNotFound")}
          </div>
        )}
      </div>
    </aside>
  );
}
