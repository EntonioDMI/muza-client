/** Очередь (UX-доводка 2026-07-11): секции «История / Сейчас / Далее»,
 *  удаление/перестановка/очистка хвоста, «Сохранить как плейлист»,
 *  «К текущему». Закрытая панель НЕ живёт в DOM (unmount) — Tab не попадает
 *  в невидимые кнопки; фокус при открытии — в панель, при закрытии App
 *  возвращает его на кнопку очереди. */

import { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "@muza/ui";
import type { PlayerTrack } from "../player/types";
import { fmtTime } from "../lib/format";

function QueueRow({
  track,
  position,
  current,
  playing,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  track: PlayerTrack;
  position: number;
  current: boolean;
  playing: boolean;
  onPlay: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  // кнопки видимы при наведении И при клавиатурном фокусе внутри ряда
  const showActions = hover || focused;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "var(--sp-2)",
        borderRadius: "var(--r-sm)",
        background: current ? "var(--surface-3)" : hover ? "var(--surface-2)" : "transparent",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
      data-queue-current={current || undefined}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Играть: ${track.artist} — ${track.title}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          flex: 1,
          minWidth: 0,
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ width: 22, flex: "none", textAlign: "right", fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
          {current ? <Icon name={playing ? "volume-2" : "pause"} size={14} color="var(--accent-text)" /> : position}
        </span>
        <img src={track.cover} alt="" style={{ width: 36, height: 36, borderRadius: "var(--r-xs)", flex: "none", objectFit: "cover" }} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--fs-body)",
              fontWeight: current ? 600 : 500,
              color: current ? "var(--accent-text)" : "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </span>
          <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {track.artist}
          </span>
        </span>
      </button>
      {showActions && (onMoveUp || onMoveDown || onRemove) ? (
        <span style={{ display: "flex", gap: 2, flex: "none" }}>
          {onMoveUp ? <IconButton icon="chevron-up" size="sm" label="Выше в очереди" onClick={onMoveUp} style={{ width: 28, height: 28 }} iconSize={15} /> : null}
          {onMoveDown ? <IconButton icon="chevron-down" size="sm" label="Ниже в очереди" onClick={onMoveDown} style={{ width: 28, height: 28 }} iconSize={15} /> : null}
          {onRemove ? <IconButton icon="x" size="sm" label="Убрать из очереди" onClick={onRemove} style={{ width: 28, height: 28 }} iconSize={15} /> : null}
        </span>
      ) : (
        <span style={{ flex: "none", fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
          {fmtTime(track.duration)}
        </span>
      )}
    </div>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--sp-2) var(--sp-2) 0" }}>
      <span
        style={{
          fontSize: "var(--fs-caption)",
          fontWeight: 600,
          letterSpacing: "var(--ls-caps)",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        {children}
      </span>
      {action}
    </div>
  );
}

export function QueuePanel({
  open,
  tracks,
  currentIndex,
  playing,
  canSave,
  onPlayTrack,
  onClose,
  onRemove,
  onMove,
  onClearUpNext,
  onSaveAsPlaylist,
}: {
  open: boolean;
  tracks: PlayerTrack[];
  /** Индекс текущего трека в очереди (секции режутся по нему). */
  currentIndex: number;
  playing: boolean;
  /** Серверная сессия: «Сохранить как плейлист» доступно. */
  canSave: boolean;
  onPlayTrack: (id: string) => void;
  onClose: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: 1 | -1) => void;
  onClearUpNext: () => void;
  onSaveAsPlaylist: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const scrollToCurrent = (smooth: boolean) => {
    const el = listRef.current?.querySelector("[data-queue-current]");
    el?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  };

  // Открытие: фокус в панель (Esc из App работает) + текущий трек в видимости
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    scrollToCurrent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null; // unmount: закрытая панель не ловит Tab

  const history = tracks.slice(0, Math.max(currentIndex, 0));
  const current = tracks[currentIndex];
  const upNext = tracks.slice(currentIndex + 1);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Очередь"
      tabIndex={-1}
      style={{
        position: "absolute",
        right: "var(--gap-zone)",
        bottom: "calc(var(--h-playerbar) + 2 * var(--gap-zone))",
        width: 380,
        maxHeight: 460,
        borderRadius: "var(--r-lg)",
        // очередь визуально принадлежит плееру — то же зональное стекло
        background: "var(--glass-player, var(--glass-panel))",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        padding: "var(--sp-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        zIndex: 50,
        outline: "none",
        animation: "muzaMenuIn var(--dur-base) var(--ease-out)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "0 var(--sp-2)" }}>
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
          Очередь{tracks.length > 0 ? ` · ${tracks.length}` : ""}
        </span>
        {tracks.length > 0 ? (
          <IconButton icon="locate" size="sm" label="К текущему треку" onClick={() => scrollToCurrent(true)} style={{ width: 28, height: 28 }} iconSize={15} />
        ) : null}
        {canSave && tracks.length > 0 ? (
          <IconButton icon="save" size="sm" label="Сохранить очередь как плейлист" onClick={onSaveAsPlaylist} style={{ width: 28, height: 28 }} iconSize={15} />
        ) : null}
        <IconButton icon="x" size="sm" label="Закрыть очередь" onClick={onClose} style={{ width: 28, height: 28 }} iconSize={16} />
      </div>

      {tracks.length === 0 ? (
        <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.5 }}>
          Очередь пуста. Включи трек из поиска, плейлиста или ленты — очередью станет список, из которого он запущен.
        </div>
      ) : (
        <div ref={listRef} style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {history.length > 0 ? (
            <>
              <SectionLabel
                action={
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((v) => !v)}
                    style={{ border: "none", background: "none", color: "var(--text-3)", fontSize: "var(--fs-caption)", cursor: "pointer", padding: 0 }}
                  >
                    {historyOpen ? "Свернуть" : `Показать (${history.length})`}
                  </button>
                }
              >
                История
              </SectionLabel>
              {historyOpen
                ? history.map((t, i) => (
                    <QueueRow
                      key={`${t.id}:${i}`}
                      track={t}
                      position={i + 1}
                      current={false}
                      playing={false}
                      onPlay={() => onPlayTrack(t.id)}
                      onRemove={() => onRemove(t.id)}
                    />
                  ))
                : null}
            </>
          ) : null}

          {current ? (
            <>
              <SectionLabel>Сейчас</SectionLabel>
              <QueueRow
                track={current}
                position={currentIndex + 1}
                current
                playing={playing}
                onPlay={() => onPlayTrack(current.id)}
                onRemove={() => onRemove(current.id)}
              />
            </>
          ) : null}

          {upNext.length > 0 ? (
            <>
              <SectionLabel
                action={
                  <button
                    type="button"
                    onClick={onClearUpNext}
                    style={{ border: "none", background: "none", color: "var(--text-3)", fontSize: "var(--fs-caption)", cursor: "pointer", padding: 0 }}
                  >
                    Очистить
                  </button>
                }
              >
                Далее · {upNext.length}
              </SectionLabel>
              {upNext.map((t, i) => (
                <QueueRow
                  key={`${t.id}:${currentIndex + 1 + i}`}
                  track={t}
                  position={currentIndex + 2 + i}
                  current={false}
                  playing={false}
                  onPlay={() => onPlayTrack(t.id)}
                  onRemove={() => onRemove(t.id)}
                  onMoveUp={i > 0 ? () => onMove(t.id, -1) : undefined}
                  onMoveDown={i < upNext.length - 1 ? () => onMove(t.id, 1) : undefined}
                />
              ))}
            </>
          ) : (
            <div style={{ padding: "var(--sp-3) var(--sp-2)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
              Дальше пусто{canSave ? " — включи радио по треку или добавь из поиска" : ""}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
