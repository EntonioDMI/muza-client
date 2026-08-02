import type React from "react";
import { useRef } from "react";
import { Cover, EmptyState, IconButton, Lyrics } from "@muza/ui";
import type { LyricLine, PlayerTrack } from "../player/types";
import { useT } from "../i18n";
import { useVideoSync } from "../player/useVideoSync";
import { useContextMenu } from "./ContextMenu";

export function NowPlayingPanel({
  track,
  lyrics,
  lyricsLoading = false,
  liked,
  onLike,
  activeLine,
  lyricsAutoScroll = true,
  lyricsEndNote = true,
  lyricsPanelLines = 0,
  onSeekLine,
  onExplain,
  videoUrl = null,
  pos = 0,
  playing = false,
  speed = 1,
  onVideoError,
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
  /** 0 — «Авто», N — подогнать размер строки под N строк (prefs.lyricsPanelLines). */
  lyricsPanelLines?: number;
  onSeekLine: (i: number) => void;
  /** Открыть общую модалку смысла для выделенной строки. */
  onExplain: (index: number) => void;
  /** Видео трека (2026-07-21, преф videoNowPlaying): удалённый googlevideo-URL
   *  из useTrackVideo; null — обложка (нет видео / тумблер выключен). */
  videoUrl?: string | null;
  /** Часы аудио для слейва видео (useVideoSync): позиция/игра/скорость. */
  pos?: number;
  playing?: boolean;
  speed?: number;
  /** URL протух (googlevideo ~6ч) — хозяин ре-резолвит или гасит видео. */
  onVideoError?: () => void;
}) {
  const { t } = useT();
  const { openMenu } = useContextMenu();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // видео — слейв к часам аудио; при videoUrl=null хук спит
  useVideoSync(videoRef, { url: videoUrl, pos, playing, speed });
  // ПКМ по тексту (2026-07-21): цель "lyrics" — копировать всё/строку, смысл
  const openLyricsMenu = (e: React.MouseEvent, i: number | null) =>
    openMenu(e, {
      kind: "lyrics",
      allText: lyrics.map((l) => l.text).join("\n"),
      // пустая инструментальная строка («•••») — копировать нечего
      lineText: i !== null ? lyrics[i]?.text || null : null,
      lineIndex: i,
      hasNote: i !== null && !!lyrics[i]?.note,
      ctl: { explain: onExplain },
    });
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
      {videoUrl ? (
        // Видео вместо обложки (спека владельца 2026-07-21, «как в Spotify»):
        // на всю ширину плашки БЕЗ рамок (минус-отступы съедают pad-zone,
        // углы клипует сама панель), граница с текстом — блюр + затемнение,
        // а не линия. Клики не нужны — слой декоративный.
        <div
          aria-hidden
          data-testid="np-video"
          style={{
            margin: "0 calc(-1 * var(--pad-zone))",
            // низ видео растворяется ПОД блоком названия (правка владельца
            // 21.07: «переход плавнее» — не полоса на кромке, а перекрытие)
            marginBottom: "-52px",
            position: "relative",
            flex: "none",
          }}
        >
          {/* Переход = РАСТВОРЕНИЕ самого кадра в прозрачность (маска), а не
              закраска поверх: скрим цветом панели давал ступеньку на кромке —
              стекло панели полупрозрачно, оттенок не совпадает никогда
              (итерации владельца 21.07). Сквозь хвост кадра проступает
              настоящий фон панели — стыка не существует по построению. */}
          <video
            ref={videoRef}
            key={track.id}
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            onError={onVideoError}
            style={{
              width: "100%",
              aspectRatio: "16 / 10",
              objectFit: "cover",
              display: "block",
              // S-кривая из 8 ступеней: CSS интерполирует линейно, и на ярком
              // кадре изломы скорости затухания читаются полосами (Мах-банды);
              // частые ступени по косинусоиде дают перцептивно ровный спад
              maskImage:
                "linear-gradient(to bottom, black 0%, black 38%, rgba(0,0,0,0.97) 48%, rgba(0,0,0,0.88) 58%, rgba(0,0,0,0.72) 68%, rgba(0,0,0,0.5) 78%, rgba(0,0,0,0.28) 86%, rgba(0,0,0,0.12) 93%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, black 0%, black 38%, rgba(0,0,0,0.97) 48%, rgba(0,0,0,0.88) 58%, rgba(0,0,0,0.72) 68%, rgba(0,0,0,0.5) 78%, rgba(0,0,0,0.28) 86%, rgba(0,0,0,0.12) 93%, transparent 100%)",
            }}
          />
          {/* мягкий блюр по растворяющемуся хвосту — «блюрится, будто
              затемняется» из спеки; сам тоже с маской, кромки не имеет */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "45%",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              maskImage:
                "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.6) 70%, black 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.6) 70%, black 100%)",
              pointerEvents: "none",
            }}
          />
        </div>
      ) : (
        <Cover key={track.id} src={track.cover} radius="var(--r-md)" className="muza-view" />
      )}
      {/* zIndex: при видео блок названия лежит НА затухающем низе кадра */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", position: "relative", zIndex: 1 }}>
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
          // Видео-режим: БЕЗ коробки — её скруглённый верх и был «острой
          // гранью» (итерация владельца 21.07). Текст лежит на фоне панели,
          // кадр перетекает в него сплошным полотном (как в караоке-оверлее).
          borderRadius: videoUrl ? 0 : "var(--r-md)",
          background: videoUrl ? "transparent" : "var(--surface-2)",
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
            panelLines={lyricsPanelLines}
            onSeek={onSeekLine}
            onExplain={onExplain}
            onLineContextMenu={openLyricsMenu}
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
