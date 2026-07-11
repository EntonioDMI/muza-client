import { useState } from "react";
import { Icon, IconButton, Slider, Tooltip } from "@muza/ui";
import type { PlayerTrack } from "../player/types";
import type { RepeatMode } from "../types";
import { fmtTime } from "../lib/format";

/** Кнопка скорости: текст «1×», клик циклит пресеты (как в голосовых Telegram).
 *  Частая настройка — живёт прямо в баре, а не в недрах настроек. */
function SpeedButton({ speed, onClick }: { speed: number; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const label = `${speed}×`.replace(".", ",");
  return (
    <Tooltip label="Скорость воспроизведения">
      <button
        type="button"
        aria-label={`Скорость: ${label}`}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          height: 28,
          minWidth: 44,
          padding: "0 var(--sp-2)",
          border: "none",
          borderRadius: "var(--r-pill)",
          background: hover ? "var(--surface-3)" : speed !== 1 ? "var(--surface-2)" : "transparent",
          color: speed !== 1 ? "var(--accent-text)" : "var(--text-2)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-caption)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          transition: "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
          flex: "none",
        }}
      >
        {label}
      </button>
    </Tooltip>
  );
}

export function PlayerBar({
  track,
  playing,
  buffering = false,
  onTogglePlay,
  onPrev,
  onNext,
  pos,
  onSeek,
  vol,
  onVol,
  liked,
  onLike,
  shuffle,
  onShuffle,
  repeat,
  onRepeat,
  speed,
  onSpeed,
  lyricsOn,
  onLyrics,
  queueOn,
  onQueue,
  onEqualizer,
  onMute,
  onExpand,
  sleepActive,
  sleepLabel,
  onSleep,
}: {
  track: PlayerTrack;
  playing: boolean;
  /** Идёт добыча/буферизация каталожного трека. */
  buffering?: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  pos: number;
  onSeek: (v: number) => void;
  vol: number;
  onVol: (v: number) => void;
  liked: boolean;
  onLike: () => void;
  shuffle: boolean;
  onShuffle: () => void;
  repeat: RepeatMode;
  onRepeat: () => void;
  speed: number;
  onSpeed: () => void;
  lyricsOn: boolean;
  onLyrics: () => void;
  queueOn: boolean;
  onQueue: () => void;
  onEqualizer: () => void;
  onMute: () => void;
  onExpand: () => void;
  /** Таймер сна: клик по луне циклит выкл → пресеты (prefs) → конец трека. */
  sleepActive: boolean;
  sleepLabel: string;
  onSleep: () => void;
}) {
  const repeatLabel = repeat === "one" ? "Повтор трека" : repeat === "all" ? "Повтор очереди" : "Повтор выключен";
  return (
    <div
      style={{
        position: "absolute",
        left: "var(--gap-zone)",
        right: "var(--gap-zone)",
        bottom: "var(--gap-zone)",
        height: "var(--h-playerbar)",
        borderRadius: "var(--r-lg)",
        background: "var(--glass-panel)",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: "var(--sp-5)",
        padding: "0 var(--sp-5)",
        zIndex: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
        <Tooltip label="Режим прослушивания">
          {/* настоящая кнопка: клавиатура открывает режим прослушивания */}
          <button
            type="button"
            aria-label="Режим прослушивания"
            onClick={onExpand}
            style={{ border: "none", background: "none", padding: 0, cursor: "pointer", flex: "none", display: "block" }}
          >
            <img
              key={track.id}
              src={track.cover}
              alt=""
              className="muza-view"
              style={{
                width: "var(--size-cover-bar)",
                height: "var(--size-cover-bar)",
                borderRadius: "var(--r-sm)",
                display: "block",
              }}
            />
          </button>
        </Tooltip>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-body)",
              fontWeight: 600,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </div>
          <div
            style={{
              fontSize: "var(--fs-caption)",
              color: "var(--text-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.artist}
          </div>
        </div>
        <Tooltip label="Нравится">
          <IconButton icon="heart" size="sm" active={liked} filled={liked} label="Нравится" onClick={onLike} />
        </Tooltip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <Tooltip label="Перемешать">
            <IconButton icon="shuffle" size="sm" active={shuffle} label="Перемешать" onClick={onShuffle} />
          </Tooltip>
          <Tooltip label="Предыдущий">
            <IconButton icon="skip-back" label="Предыдущий" onClick={onPrev} />
          </Tooltip>
          <IconButton
            icon={buffering ? "loader-circle" : playing ? "pause" : "play"}
            variant="accent"
            label={buffering ? "Добываем трек…" : playing ? "Пауза" : "Слушать"}
            onClick={onTogglePlay}
          />
          <Tooltip label="Следующий">
            <IconButton icon="skip-forward" label="Следующий" onClick={onNext} />
          </Tooltip>
          <Tooltip label={repeatLabel}>
            <IconButton
              icon={repeat === "one" ? "repeat-1" : "repeat"}
              size="sm"
              active={repeat !== "off"}
              label={repeatLabel}
              onClick={onRepeat}
            />
          </Tooltip>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", width: 480 }}>
          <span
            style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums", width: 36, textAlign: "right" }}
          >
            {fmtTime(pos)}
          </span>
          <Slider
            value={pos}
            max={track.duration}
            onChange={onSeek}
            ariaLabel="Прогресс"
            valueText={`${fmtTime(pos)} из ${fmtTime(track.duration)}`}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums", width: 36 }}>
            {fmtTime(track.duration)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-2)" }}>
        <Tooltip label={sleepLabel}>
          <IconButton icon="moon" size="sm" active={sleepActive} label={sleepLabel} onClick={onSleep} />
        </Tooltip>
        <SpeedButton speed={speed} onClick={onSpeed} />
        <Tooltip label="Эквалайзер">
          <IconButton icon="sliders-vertical" size="sm" label="Эквалайзер" onClick={onEqualizer} />
        </Tooltip>
        <Tooltip label="Текст">
          <IconButton icon="mic-vocal" size="sm" active={lyricsOn} label="Текст" onClick={onLyrics} />
        </Tooltip>
        <Tooltip label="Очередь">
          <IconButton icon="list-music" size="sm" active={queueOn} label="Очередь" onClick={onQueue} />
        </Tooltip>
        {/* клик по иконке — mute (нативный жест), колесо на слайдере — ±громкость */}
        <Tooltip label={vol === 0 ? "Включить звук" : "Без звука"}>
          <IconButton
            icon={vol === 0 ? "volume-x" : vol < 40 ? "volume-1" : "volume-2"}
            size="sm"
            label={vol === 0 ? "Включить звук" : "Без звука"}
            onClick={onMute}
          />
        </Tooltip>
        <div onWheel={(e) => onVol(Math.max(0, Math.min(100, vol + (e.deltaY < 0 ? 5 : -5))))} style={{ display: "flex" }}>
          <Slider value={vol} onChange={onVol} ariaLabel="Громкость" valueText={`${Math.round(vol)} %`} style={{ width: 110 }} />
        </div>
        <Tooltip label="Во весь экран">
          <IconButton icon="maximize-2" size="sm" label="Режим прослушивания" onClick={onExpand} />
        </Tooltip>
      </div>
    </div>
  );
}
