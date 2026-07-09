import React, { useState } from "react";
import { IconButton } from "../core/IconButton.jsx";

/** Media tile — soft rounded card with square cover; play pill appears on hover. */
export function Tile({ cover, title, subtitle, width = 176, playing = false, onPlay, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        width,
        flex: "none",
        padding: "var(--pad-tile)",
        borderRadius: "var(--r-md)",
        background: hover ? "var(--surface-3)" : "var(--surface-2)",
        cursor: "pointer",
        transition: "background var(--dur-base) var(--ease-out)",
      }}
    >
      <div style={{ position: "relative", marginBottom: "var(--sp-3)" }}>
        <img
          src={cover}
          alt=""
          style={{
            display: "block",
            width: "100%",
            aspectRatio: "1",
            objectFit: "cover",
            borderRadius: "var(--r-xs)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            opacity: hover || playing ? 1 : 0,
            transform: hover || playing ? "translateY(0)" : "translateY(4px)",
            transition: "opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
          }}
        >
          <IconButton
            icon={playing ? "pause" : "play"}
            variant="accent"
            label={playing ? "Пауза" : "Слушать"}
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
