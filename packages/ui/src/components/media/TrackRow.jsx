import React, { useState } from "react";
import { Icon } from "../core/Icon.jsx";
import { IconButton } from "../core/IconButton.jsx";

/** Track list row — no dividers; hover is a surface layer, active is accent title.
 *  Keyboard-reachable: the index cell is a real play button (number → play icon
 *  on hover/focus), like/more appear on focus-within as well as hover.
 *  Labels default to English (ДС строко-нейтральна, DEFAULT_LANG=en) — приложение
 *  может передать локализованные playLabel/pauseLabel/likeLabel/moreLabel. */
export function TrackRow({
  index,
  cover,
  title,
  artist,
  duration,
  showDuration = true,
  source,
  active = false,
  playing = false,
  liked = false,
  explicit = false,
  onPlay,
  onRowDoubleClick,
  onLike,
  onMore,
  playLabel = "Play",
  pauseLabel = "Pause",
  likeLabel = "Like",
  moreLabel = "More",
}) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const lit = hover || focused;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      // дабл-клик по строке настраивается («играть»/«в очередь»); кнопка-номер — всегда play
      onDoubleClick={onRowDoubleClick ?? onPlay}
      // ПКМ = то же меню, что «⋯» (нативное браузерное меню в плеере — мусор)
      onContextMenu={
        onMore
          ? (e) => {
              e.preventDefault();
              onMore(e);
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        height: "var(--h-trackrow, 60px)",
        padding: "0 var(--sp-4)",
        borderRadius: "var(--r-sm)",
        background: active ? "var(--surface-3)" : lit ? "var(--surface-2)" : "transparent",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <div style={{ width: 28, flex: "none", display: "flex", justifyContent: "center" }}>
        {/* всегда настоящая кнопка: клавиатура достаёт play без ховера */}
        <button
          type="button"
          aria-label={active && playing ? pauseLabel : `${playLabel}: ${title}`}
          onClick={onPlay}
          style={{
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: "var(--r-pill)",
            background: lit ? "var(--surface-3)" : "transparent",
            /* роль акцента «активный трек»: свой цвет, фолбэк — общий акцент */
            color: active ? "var(--accent-active-text, var(--accent-text))" : lit ? "var(--text-1)" : "var(--text-3)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            fontVariantNumeric: "tabular-nums",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {lit ? (
            <Icon name={active && playing ? "pause" : "play"} size={16} color="currentColor" />
          ) : active && playing ? (
            <Icon name="audio-lines" size={18} color="var(--accent-active-text, var(--accent-text))" />
          ) : (
            <span>{index}</span>
          )}
        </button>
      </div>
      {cover ? (
        <img src={cover} alt="" loading="lazy" style={{ width: 42, height: 42, borderRadius: "var(--r-xs)", objectFit: "cover", flex: "none" }} />
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <span
            style={{
              fontSize: "var(--fs-body)",
              fontWeight: "var(--fw-medium)",
              color: active ? "var(--accent-active-text, var(--accent-text))" : "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </span>
          {explicit ? (
            <span style={{ flex: "none", fontSize: 11, fontWeight: "var(--fw-semibold)", color: "var(--text-3)", background: "var(--surface-3)", borderRadius: 4, padding: "1px 5px" }}>E</span>
          ) : null}
        </div>
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{artist}</div>
      </div>
      {/* Источник трека — тихий информ-бейдж (всегда виден, не по ховеру): откуда добывается */}
      {source ? (
        <span
          title={`Источник: ${source}`}
          style={{
            flex: "none",
            maxWidth: 132,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            fontWeight: "var(--fw-medium)",
            lineHeight: 1.55,
            color: "var(--text-2)",
            background: "var(--surface-3)",
            borderRadius: "var(--r-sm)",
            padding: "2px 8px",
          }}
        >
          {source}
        </span>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flex: "none" }}>
        {lit || liked ? (
          <IconButton icon="heart" size="sm" active={liked} filled={liked} label={likeLabel} onClick={onLike} style={{ opacity: liked || lit ? 1 : 0 }} />
        ) : (
          <span style={{ width: 36 }}></span>
        )}
        {showDuration ? (
          <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", fontVariantNumeric: "tabular-nums", width: 40, textAlign: "right" }}>{duration}</span>
        ) : null}
        {onMore ? (
          lit ? (
            <IconButton icon="ellipsis" size="sm" label={moreLabel} onClick={onMore} />
          ) : (
            <span style={{ width: 36 }}></span>
          )
        ) : null}
      </div>
    </div>
  );
}
