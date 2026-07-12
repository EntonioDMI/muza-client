"use client";

import { IconButton } from "@muza/ui";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { Cover } from "./Cover";
import { LyricsBlock } from "./LyricsPanel";

/** Правая панель «Сейчас играет» (≥1200px): крупная обложка, трек, лайк и
 *  текст — зеркало десктопной NowPlayingPanel. Открывается сама при старте
 *  трека (prefs.npOpen), закрывается крестиком. */
export function NowPlayingPanel({ onClose }: { onClose: () => void }) {
  const { current } = usePlayer();
  const { likedIds, toggle } = useLikes();
  if (!current) return null;

  return (
    <aside className="zone np-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
        <IconButton icon="x" size="sm" label="Скрыть панель" iconSize={16} style={{ width: 30, height: 30 }} onClick={onClose} />
      </div>
      <Cover url={current.coverUrl} style={{ width: "100%", flex: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 17,
              fontWeight: 700,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {current.title}
          </div>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-caption)",
              color: "var(--text-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {current.artist}
          </div>
        </div>
        <IconButton
          icon="heart"
          size="sm"
          label={likedIds.has(current.id) ? "Убрать из любимого" : "В любимое"}
          filled={likedIds.has(current.id)}
          onClick={() => toggle(current)}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <LyricsBlock />
      </div>
    </aside>
  );
}
