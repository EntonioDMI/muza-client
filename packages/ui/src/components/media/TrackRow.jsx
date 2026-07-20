import React, { useState } from "react";
import { Icon } from "../core/Icon.jsx";
import { IconButton } from "../core/IconButton.jsx";
import { Cover } from "./Cover.jsx";
import { Tooltip } from "../feedback/Tooltip.jsx";

/** Track list row — no dividers; hover is a surface layer, active is accent title.
 *  Keyboard-reachable: the index cell is a real play button (number → play icon
 *  on hover/focus), like/more appear on focus-within as well as hover.
 *  Labels default to English (ДС строко-нейтральна, DEFAULT_LANG=en) — приложение
 *  может передать локализованные playLabel/pauseLabel/likeLabel/moreLabel. */
/** Ширина слота версий = ширине распорки, чтобы ряд с версиями и без были
 *  одинаковы до пикселя (число + шеврон помещаются с запасом). */
const VERSIONS_SLOT = 40;

export function TrackRow({
  index,
  cover,
  showCover = true,
  title,
  artist,
  album,
  duration,
  showDuration = true,
  source,
  versionCount,
  showVersions = false,
  versionsExpanded = false,
  onVersions,
  versionsLabel,
  active = false,
  playing = false,
  liked = false,
  explicit = false,
  selected = false,
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
      aria-selected={selected || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        height: "var(--h-trackrow, 60px)",
        padding: "0 var(--sp-4)",
        borderRadius: "var(--r-sm)",
        // выделение сильнее «играет сейчас»: иначе выделенный играющий трек
        // визуально выпадает из выделения (мультивыбор, 2026-07-20)
        background: selected ? "var(--surface-4)" : active ? "var(--surface-3)" : lit ? "var(--surface-2)" : "transparent",
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
      {showCover ? <Cover src={cover} size={42} /> : null}
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
        {/* Альбом — в одной строке с артистом через « · », приглушённее
            (text-3): обрезку обеих частей делает общий ellipsis родителя. */}
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artist}
          {album ? <span style={{ color: "var(--text-3)" }}> · {album}</span> : null}
        </div>
      </div>
      {/* Источник трека — тихий информ-бейдж (всегда виден, не по ховеру): откуда
          добывается. Нативного title нет: он дублировал видимый текст стоковой
          плашкой WebView2 (жалоба 2026-07-16). */}
      {source ? (
        <span
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
        {/* Версии (ремиксы/спидапы) — слот ряда, а не сосед строки снаружи.
            Раньше карточка группы вешала бейдж СБОКУ от TrackRow, тот ужимался
            на её ширину, и у трека с версиями таймкод уезжал влево относительно
            соседних строк. Слот резервируется распоркой у ВСЕХ строк списка
            (showVersions — свойство списка, versionCount — данные строки),
            поэтому правый кластер стоит на одном месте у всех. */}
        {showVersions ? (
          versionCount ? (
            <Tooltip label={versionsLabel} style={{ flex: "none" }}>
            <button
              type="button"
              onClick={onVersions}
              aria-expanded={versionsExpanded}
              aria-label={versionsLabel}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                width: VERSIONS_SLOT,
                height: 36,
                flex: "none",
                border: "none",
                borderRadius: "var(--r-sm)",
                background: versionsExpanded ? "var(--surface-3)" : "transparent",
                color: versionsExpanded ? "var(--text-1)" : "var(--text-2)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-caption)",
                fontWeight: "var(--fw-semibold)",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              {versionCount}
              <Icon
                name="chevron-down"
                size={14}
                color="currentColor"
                style={{ transform: versionsExpanded ? "rotate(180deg)" : undefined, transition: "transform var(--dur-fast) var(--ease-out)" }}
              />
            </button>
            </Tooltip>
          ) : (
            <span style={{ width: VERSIONS_SLOT, flex: "none" }}></span>
          )
        ) : null}
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
