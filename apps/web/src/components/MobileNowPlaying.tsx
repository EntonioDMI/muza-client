"use client";

import { useEffect, useState } from "react";
import { IconButton, Slider } from "@muza/ui";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer, usePosition } from "../player";
import { Cover } from "./Cover";
import { LyricsBlock } from "./LyricsPanel";

/** Полноэкранный now-playing телефона: открывается тапом по мини-бару.
 *  Два вида — обложка и текст (кнопка mic-vocal). Глубокое стекло поверх
 *  сценографии; Esc/шеврон закрывают. */
export function MobileNowPlaying({ onClose }: { onClose: () => void }) {
  const p = usePlayer();
  const { position, duration } = usePosition();
  const { likedIds, toggle } = useLikes();
  const [view, setView] = useState<"cover" | "lyrics">("cover");
  const t = p.current;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // трек кончился и очередь пуста — закрываемся сами
  useEffect(() => {
    if (!t) onClose();
  }, [t, onClose]);

  if (!t) return null;

  return (
    <div className="np-overlay" role="dialog" aria-label="Сейчас играет">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <IconButton icon="chevron-down" label="Свернуть" onClick={onClose} />
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
        <IconButton
          icon="mic-vocal"
          label={view === "cover" ? "Текст песни" : "Обложка"}
          active={view === "lyrics"}
          onClick={() => setView((v) => (v === "cover" ? "lyrics" : "cover"))}
        />
      </div>

      {/* Центр: обложка или текст */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "var(--sp-4) 0" }}>
        {view === "cover" ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Cover url={t.coverUrl} style={{ width: "min(78vw, 46vh)" }} />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <LyricsBlock />
          </div>
        )}
      </div>

      {/* Трек + лайк */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", paddingBottom: "var(--sp-3)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 19,
              fontWeight: 700,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {t.title}
          </div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.error ?? t.artist}
          </div>
        </div>
        <IconButton
          icon="heart"
          label={likedIds.has(t.id) ? "Убрать из любимого" : "В любимое"}
          filled={likedIds.has(t.id)}
          onClick={() => toggle(t)}
        />
      </div>

      {/* Прогресс */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", paddingBottom: "var(--sp-3)" }}>
        <Slider
          value={position}
          max={Math.max(duration, 1)}
          onChange={p.seek}
          ariaLabel="Позиция"
          valueText={`${fmtTime(position)} из ${fmtTime(duration)}`}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
          <span>{fmtTime(position)}</span>
          <span>{fmtTime(duration)}</span>
        </div>
      </div>

      {/* Транспорт */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-4)" }}>
        <IconButton icon="shuffle" size="sm" label="Перемешать" active={p.shuffle} onClick={p.toggleShuffle} />
        <IconButton icon="skip-back" size="lg" label="Предыдущий" onClick={p.prev} />
        <IconButton icon={p.playing ? "pause" : "play"} size="lg" variant="accent" label={p.playing ? "Пауза" : "Играть"} onClick={p.toggle} />
        <IconButton icon="skip-forward" size="lg" label="Следующий" onClick={p.next} />
        <IconButton
          icon={p.repeat === "one" ? "repeat-1" : "repeat"}
          size="sm"
          label="Повтор"
          active={p.repeat !== "off"}
          onClick={p.cycleRepeat}
        />
      </div>
    </div>
  );
}
