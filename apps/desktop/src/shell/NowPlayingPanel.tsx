import { useEffect, useState } from "react";
import { Icon, IconButton, Lyrics } from "@muza/ui";
import type { Annotation } from "@muza/api-client";
import type { LyricLine } from "../data/demo";
import type { PlayerTrack } from "../player/types";
import { openExternal } from "../lib/system";

export function NowPlayingPanel({
  track,
  lyrics,
  lyricsLoading = false,
  liked,
  onLike,
  activeLine,
  onSeekLine,
  annotations,
  geniusUrl,
}: {
  track: PlayerTrack;
  /** Строки текста: демо — локальные, каталог — LRCLIB с сервера (слайс 4). */
  lyrics: LyricLine[];
  /** Текст ещё грузится — «Ищем текст…» вместо «Текст не найден». */
  lyricsLoading?: boolean;
  liked: boolean;
  onLike: () => void;
  activeLine: number;
  onSeekLine: (i: number) => void;
  /** Genius-аннотации по индексу строки (Stage 5); у демо-треков — нет,
   *  их note живут прямо в строках. */
  annotations?: Map<number, Annotation>;
  geniusUrl?: string | null;
}) {
  // «Режим смысла»: открытая аннотация строки (пунктирные строки кликабельны)
  const [explain, setExplain] = useState<number | null>(null);
  useEffect(() => setExplain(null), [track.id]);
  const noted = explain !== null ? lyrics[explain] : null;
  const notedMeta = explain !== null ? annotations?.get(explain) : undefined;

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
            onSeek={onSeekLine}
            onExplain={(i: number) => setExplain((cur) => (cur === i ? null : i))}
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
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.6, overflowY: "auto", maxHeight: 180 }}>
              {noted.note}
            </div>
            {notedMeta ? (
              // настоящая аннотация: источник + голоса (+ ссылка на страницу)
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: 11, color: "var(--text-3)" }}>
                <span>
                  Genius
                  {notedMeta.verified ? " · от автора" : ""}
                  {notedMeta.votes > 0 ? ` · ▲ ${notedMeta.votes}` : ""}
                </span>
                {geniusUrl ? (
                  <button
                    type="button"
                    onClick={() => void openExternal(geniusUrl)}
                    style={{
                      border: "none",
                      background: "none",
                      padding: 0,
                      color: "var(--accent-text)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Открыть страницу
                  </button>
                ) : null}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Режим смысла · демо</div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
