import { useEffect, useRef, useState } from "react";
import { IconButton, Lyrics, Slider } from "@muza/ui";
import type { LyricLine } from "../data/demo";
import type { PlayerTrack } from "../player/types";
import { fmtTime } from "../lib/format";

/** Полноэкранный «режим прослушивания» — караоке-оверлей («ночной вайб»). */
export function ListeningMode({
  open,
  track,
  lyrics,
  playing,
  pos,
  activeLine,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onSeekLine,
  onClose,
}: {
  open: boolean;
  track: PlayerTrack;
  /** Строки текста (демо — локальные, каталог — LRCLIB, слайс 4). */
  lyrics: LyricLine[];
  playing: boolean;
  pos: number;
  activeLine: number;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (v: number) => void;
  onSeekLine: (i: number) => void;
  onClose: () => void;
}) {
  const [calm, setCalm] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wake = () => {
    setCalm(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCalm(true), 2500);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // на входе показать управление, Escape — выход
  useEffect(() => {
    if (!open) return;
    wake();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      onMouseMove={wake}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        overflow: "hidden",
        background: "var(--bg-0)",
        opacity: open ? 1 : 0,
        visibility: open ? "visible" : "hidden",
        pointerEvents: open ? "auto" : "none",
        transition: open
          ? "opacity var(--dur-slow) var(--ease-out), visibility 0s"
          : "opacity var(--dur-slow) var(--ease-out), visibility 0s linear var(--dur-slow)",
      }}
    >
      <img
        src={track.cover}
        alt=""
        style={{
          position: "absolute",
          inset: "-10%",
          width: "120%",
          height: "120%",
          objectFit: "cover",
          filter: "blur(var(--blur-scenery))",
          transform: "scale(1.1)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--glass-deep)",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
        }}
      ></div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "minmax(300px, 420px) 1fr",
          gap: "var(--sp-9)",
          alignItems: "center",
          padding: "0 var(--sp-10)",
          transform: open ? "translateY(0) scale(1)" : "translateY(24px) scale(0.985)",
          transition: "transform var(--dur-slow) var(--ease-out)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <img src={track.cover} alt="" style={{ width: "100%", aspectRatio: "1", borderRadius: "var(--r-xl)", objectFit: "cover" }} />
          <div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: "var(--ls-display)",
                color: "var(--text-1)",
              }}
            >
              {track.title}
            </div>
            <div style={{ fontSize: "var(--fs-strong)", color: "var(--text-2)", marginTop: 6 }}>
              {track.album ? `${track.artist} · ${track.album}` : track.artist}
            </div>
          </div>
        </div>
        {lyrics.length > 0 ? (
          <Lyrics lines={lyrics} activeIndex={activeLine} mode="karaoke" onSeek={onSeekLine} style={{ height: "100%" }} />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-3)",
              fontSize: "var(--fs-strong)",
            }}
          >
            Текст не найден
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          top: "var(--sp-6)",
          right: "var(--sp-6)",
          opacity: calm ? 0 : 1,
          transition: "opacity var(--dur-slow) var(--ease-out)",
          pointerEvents: calm ? "none" : "auto",
        }}
      >
        <IconButton icon="minimize-2" variant="surface" label="Свернуть" onClick={onClose} />
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: "var(--sp-6)",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          padding: "var(--sp-3) var(--sp-5)",
          borderRadius: "var(--r-pill)",
          background: "var(--glass-panel)",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          opacity: calm ? 0 : 1,
          transition: "opacity var(--dur-slow) var(--ease-out)",
          pointerEvents: calm ? "none" : "auto",
        }}
      >
        <IconButton icon="skip-back" label="Предыдущий" onClick={onPrev} />
        <IconButton
          icon={playing ? "pause" : "play"}
          variant="accent"
          size="lg"
          label={playing ? "Пауза" : "Слушать"}
          onClick={onTogglePlay}
        />
        <IconButton icon="skip-forward" label="Следующий" onClick={onNext} />
        <span style={{ fontSize: 13, color: "var(--text-2)", fontVariantNumeric: "tabular-nums", paddingLeft: 6 }}>{fmtTime(pos)}</span>
        <Slider value={pos} max={track.duration} onChange={onSeek} ariaLabel="Прогресс" style={{ width: 220 }} />
        <span style={{ fontSize: 13, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(track.duration)}</span>
      </div>
    </div>
  );
}
