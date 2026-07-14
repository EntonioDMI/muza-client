import { useRef, useState } from "react";
import { IconButton, Slider, Tooltip } from "@muza/ui";
import type { PlayerTrack } from "../player/types";
import type { BarButtonKey, RepeatMode } from "../types";
import { normalizeBarButtons, type BarButtonPref } from "../lib/barButtons";
import { isPluginKey } from "../lib/pluginSlots";
import { fmtTime } from "../lib/format";
import { startTrackFileDrag } from "../lib/dragOut";
import { useT } from "../i18n";

/** Плагинная кнопка бара (T44): иконка/подпись из contributes + рантайм-
 *  состояние (UI.setBarButtonState/setBadge). Клик уведомляет плагин. */
export interface PluginBarButtonView {
  key: string;
  pluginId: string;
  slotId: string;
  title: string;
  icon: string;
  active?: boolean;
  badge?: string;
}

/** Кнопка скорости: текст «1×», клик циклит пресеты (как в голосовых Telegram).
 *  Частая настройка — живёт прямо в баре, а не в недрах настроек. */
function SpeedButton({ speed, onClick }: { speed: number; onClick: () => void }) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  const label = `${speed}×`.replace(".", ",");
  return (
    <Tooltip label={t("player.speedTooltip")}>
      <button
        type="button"
        aria-label={t("player.speedAria", { speed: label })}
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
  jamActive,
  onJam,
  onCoverDragOut,
  buttons,
  pluginButtons = [],
  pluginKeys = [],
  onPluginButton,
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
  /** Jam (Stage 7): активная сессия подсвечивает кнопку. */
  jamActive: boolean;
  onJam: () => void;
  /** Drag-out: подготовить файл трека для нативного драга (null = не вышло,
   *  тост уже показан снаружи). undefined — жест недоступен (браузер/аноним). */
  onCoverDragOut?: () => Promise<string | null>;
  /** Компоновка (настройки → «Кнопки плеер-бара»): состав и порядок.
   *  Несъёмное — обложка/инфо/лайк, prev/play/next, прогресс. */
  buttons?: BarButtonPref[];
  /** T44: плагинные кнопки бара (мета + рантайм-состояние). */
  pluginButtons?: PluginBarButtonView[];
  /** T44: валидные плагинные ключи для нормализатора композиции. */
  pluginKeys?: readonly string[];
  /** T44: клик по плагинной кнопке — уведомить плагин. */
  onPluginButton?: (pluginId: string, slotId: string) => void;
}) {
  const { t } = useT();
  const repeatLabel = repeat === "one" ? t("player.repeat.one") : repeat === "all" ? t("player.repeat.all") : t("player.repeat.off");
  // Компоновка: shuffle/repeat живут в центре вокруг транспорта, остальные —
  // справа в порядке массива; выключенное не рендерится
  const layout = normalizeBarButtons(buttons ?? [], pluginKeys);
  const barOn = (key: BarButtonKey) => layout.find((b) => b.key === key)?.on !== false;
  const rightOrder = layout.filter((b) => b.on && b.key !== "shuffle" && b.key !== "repeat");
  const pluginBtn = (key: string) => pluginButtons.find((b) => b.key === key);
  // Жест drag-out с обложки: pointerdown взводит экспорт, движение >12px
  // запускает нативный драг, клик без движения — обычный «Режим прослушивания»
  const dragRef = useRef<{ x: number; y: number; file: Promise<string | null>; started: boolean } | null>(null);
  const draggedRef = useRef(false);
  return (
    <div
      style={{
        position: "absolute",
        left: "var(--gap-zone)",
        right: "var(--gap-zone)",
        bottom: "var(--gap-zone)",
        height: "var(--h-playerbar)",
        borderRadius: "var(--r-lg)",
        // зональная прозрачность: своё стекло плеера, фолбэк — общее
        background: "var(--glass-player, var(--glass-panel))",
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
        <Tooltip label={onCoverDragOut ? t("player.listeningModeTooltipDrag") : t("player.listeningModeTooltip")}>
          {/* настоящая кнопка: клавиатура открывает режим прослушивания;
              с зажатой ЛКМ обложка утаскивается файлом (drag-out) */}
          <button
            type="button"
            aria-label={t("player.listeningModeTooltip")}
            onClick={() => {
              if (draggedRef.current) {
                draggedRef.current = false; // это был drag, не клик
                return;
              }
              onExpand();
            }}
            onPointerDown={
              onCoverDragOut
                ? (e) => {
                    if (e.button !== 0) return;
                    draggedRef.current = false;
                    dragRef.current = { x: e.clientX, y: e.clientY, file: onCoverDragOut(), started: false };
                  }
                : undefined
            }
            onPointerMove={
              onCoverDragOut
                ? (e) => {
                    const d = dragRef.current;
                    if (!d || d.started) return;
                    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) return;
                    d.started = true;
                    draggedRef.current = true;
                    void d.file
                      .then((path) => (path ? startTrackFileDrag(path) : undefined))
                      .catch(() => undefined);
                  }
                : undefined
            }
            onPointerUp={() => {
              dragRef.current = null;
            }}
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
        <Tooltip label={t("common.like")}>
          <IconButton icon="heart" size="sm" active={liked} filled={liked} label={t("common.like")} onClick={onLike} />
        </Tooltip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          {barOn("shuffle") ? (
            <Tooltip label={t("player.shuffle")}>
              <IconButton icon="shuffle" size="sm" active={shuffle} label={t("player.shuffle")} onClick={onShuffle} />
            </Tooltip>
          ) : null}
          <Tooltip label={t("player.previous")}>
            <IconButton icon="skip-back" label={t("player.previous")} onClick={onPrev} />
          </Tooltip>
          <IconButton
            icon={buffering ? "loader-circle" : playing ? "pause" : "play"}
            variant="accent"
            label={buffering ? t("player.buffering") : playing ? t("player.pause") : t("player.play")}
            onClick={onTogglePlay}
          />
          <Tooltip label={t("player.next")}>
            <IconButton icon="skip-forward" label={t("player.next")} onClick={onNext} />
          </Tooltip>
          {barOn("repeat") ? (
            <Tooltip label={repeatLabel}>
              <IconButton
                icon={repeat === "one" ? "repeat-1" : "repeat"}
                size="sm"
                active={repeat !== "off"}
                label={repeatLabel}
                onClick={onRepeat}
              />
            </Tooltip>
          ) : null}
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
            ariaLabel={t("player.progress")}
            valueText={t("player.progressValueText", { pos: fmtTime(pos), duration: fmtTime(track.duration) })}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums", width: 36 }}>
            {fmtTime(track.duration)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-2)" }}>
        {rightOrder.map(({ key }) => {
          switch (key) {
            case "sleep":
              return (
                <Tooltip key={key} label={sleepLabel}>
                  <IconButton icon="moon" size="sm" active={sleepActive} label={sleepLabel} onClick={onSleep} />
                </Tooltip>
              );
            case "speed":
              return <SpeedButton key={key} speed={speed} onClick={onSpeed} />;
            case "equalizer":
              return (
                <Tooltip key={key} label={t("settings.equalizer.title")}>
                  <IconButton icon="sliders-vertical" size="sm" label={t("settings.equalizer.title")} onClick={onEqualizer} />
                </Tooltip>
              );
            case "lyrics":
              return (
                <Tooltip key={key} label={t("player.lyrics")}>
                  <IconButton icon="mic-vocal" size="sm" active={lyricsOn} label={t("player.lyrics")} onClick={onLyrics} />
                </Tooltip>
              );
            case "jam":
              return (
                <Tooltip key={key} label={jamActive ? t("player.jamActiveTooltip") : t("player.jamTooltip")}>
                  <IconButton icon="radio-tower" size="sm" active={jamActive} label={t("player.jamTooltip")} onClick={onJam} />
                </Tooltip>
              );
            case "queue":
              return (
                <Tooltip key={key} label={t("player.queue")}>
                  <IconButton icon="list-music" size="sm" active={queueOn} label={t("player.queue")} onClick={onQueue} />
                </Tooltip>
              );
            case "volume":
              // клик по иконке — mute (нативный жест), колесо на слайдере — ±громкость
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <Tooltip label={vol === 0 ? t("player.unmute") : t("player.mute")}>
                    <IconButton
                      icon={vol === 0 ? "volume-x" : vol < 40 ? "volume-1" : "volume-2"}
                      size="sm"
                      label={vol === 0 ? t("player.unmute") : t("player.mute")}
                      onClick={onMute}
                    />
                  </Tooltip>
                  <div onWheel={(e) => onVol(Math.max(0, Math.min(100, vol + (e.deltaY < 0 ? 5 : -5))))} style={{ display: "flex" }}>
                    <Slider value={vol} onChange={onVol} ariaLabel={t("player.volume")} valueText={`${Math.round(vol)} %`} style={{ width: 110 }} />
                  </div>
                </div>
              );
            case "fullscreen":
              return (
                <Tooltip key={key} label={t("player.fullscreen")}>
                  <IconButton icon="maximize-2" size="sm" label={t("player.listeningModeTooltip")} onClick={onExpand} />
                </Tooltip>
              );
            default: {
              // T44: плагинная кнопка бара (ключ plugin:<id>:<slot>)
              if (!isPluginKey(key)) return null;
              const pb = pluginBtn(key);
              if (!pb) return null;
              return (
                <Tooltip key={key} label={pb.badge ? `${pb.title} · ${pb.badge}` : pb.title}>
                  <IconButton
                    icon={pb.icon}
                    size="sm"
                    active={pb.active}
                    label={pb.title}
                    onClick={() => onPluginButton?.(pb.pluginId, pb.slotId)}
                  />
                </Tooltip>
              );
            }
          }
        })}
      </div>
    </div>
  );
}
