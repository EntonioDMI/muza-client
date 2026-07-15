import React, { useState } from "react";
import { IconButton } from "../core/IconButton.jsx";
import { Cover } from "./Cover.jsx";

/** Media tile — soft rounded card with square cover; play pill appears on
 *  hover AND keyboard focus. The tile itself is a keyboard target
 *  (role=button, Enter/Space = onClick).
 *  Обложка — через Cover: нет картинки → плейсхолдер, а не дыра в плитке. */
export function Tile({ cover, title, subtitle, width = 176, playing = false, onPlay, onClick, onMenu, playLabel = "Play", pauseLabel = "Pause" }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const lit = hover || focused;
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? title : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // ПКМ = то же меню, что «⋯» у TrackRow (нативное браузерное меню в плеере — мусор)
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(e);
            }
          : undefined
      }
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onClick && e.target === e.currentTarget) {
          e.preventDefault();
          onClick();
        }
      }}
      onClick={onClick}
      style={{
        width,
        flex: "none",
        padding: "var(--pad-tile)",
        borderRadius: "var(--r-md)",
        background: lit ? "var(--surface-3)" : "var(--surface-2)",
        cursor: "pointer",
        transition: "background var(--dur-base) var(--ease-out)",
      }}
    >
      <div style={{ position: "relative", marginBottom: "var(--sp-3)" }}>
        <Cover src={cover} />
        <div
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            opacity: lit || playing ? 1 : 0,
            transform: lit || playing ? "translateY(0)" : "translateY(4px)",
            transition: "opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
          }}
        >
          <IconButton
            icon={playing ? "pause" : "play"}
            variant="accent"
            label={playing ? pauseLabel : playLabel}
            onClick={(e) => { if (e) e.stopPropagation(); if (onPlay) onPlay(); }}
          />
        </div>
      </div>
      <div
        style={{
          fontSize: "var(--fs-body)",
          fontWeight: "var(--fw-semibold)",
          color: "var(--text-1)",
          lineHeight: "var(--lh-ui)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </div>
      {subtitle ? (
        <div
          style={{
            fontSize: "var(--fs-caption)",
            color: "var(--text-2)",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
