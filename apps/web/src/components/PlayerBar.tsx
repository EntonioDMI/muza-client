"use client";

import { Icon, IconButton, Slider, Spinner, Tooltip } from "@muza/ui";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer, usePosition } from "../player";

/** Сердце с «пульсом» при лайке: key по liked — remount перезапускает
 *  анимацию muza-like-pop ровно в момент переключения. */
function LikeButton({ liked, onToggle, size = "sm" as const }: { liked: boolean; onToggle: () => void; size?: "sm" | "md" }) {
  return (
    <span key={liked ? "on" : "off"} className={liked ? "muza-like-pop" : undefined} style={{ display: "inline-flex" }}>
      <IconButton
        icon="heart"
        size={size}
        label={liked ? "Убрать из любимого" : "В любимое"}
        filled={liked}
        onClick={onToggle}
      />
    </span>
  );
}

function CoverThumb({ url, size }: { url: string | null; size: number }) {
  return url ? (
    <img src={url} alt="" style={{ width: size, height: size, borderRadius: "var(--r-xs)", objectFit: "cover", flex: "none" }} />
  ) : (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "var(--r-xs)",
        background: "var(--accent-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <Icon name="music-2" size={Math.round(size * 0.45)} color="var(--accent-text)" />
    </span>
  );
}

/** Плеер веба: на десктопе — плавающий стеклянный бар (как в приложении),
 *  на телефоне — мини-бар над нижней навигацией (тап открывает полноэкранный
 *  now-playing). Оба варианта в DOM, переключает CSS-брейкпоинт. */
export function PlayerBar({
  npOpen,
  onToggleNp,
  onOpenMobile,
}: {
  npOpen: boolean;
  onToggleNp: () => void;
  onOpenMobile: () => void;
}) {
  const p = usePlayer();
  const { position, duration } = usePosition();
  const { likedIds, toggle } = useLikes();
  const t = p.current;

  const volumeIcon = p.muted || p.volume === 0 ? "volume-x" : p.volume < 0.5 ? "volume-1" : "volume-2";
  const subtitle = p.error ?? (p.loading ? "Загрузка…" : (t?.artist ?? "Выбери трек — очередь появится сама"));

  return (
    <>
      {/* ── Десктоп ── */}
      <footer className="playerbar">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
          <CoverThumb url={t?.coverUrl ?? null} size={52} />
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-body)",
                fontWeight: 600,
                color: "var(--text-1)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t ? t.title : "Ничего не играет"}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-1)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-caption)",
                color: p.error ? "var(--danger)" : "var(--text-3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {p.loading && !p.error ? <Spinner size={12} /> : null}
              {subtitle}
            </span>
          </span>
          {t ? <LikeButton liked={likedIds.has(t.id)} onToggle={() => toggle(t)} /> : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <Tooltip label="Перемешать">
              <IconButton icon="shuffle" size="sm" label="Перемешать" active={p.shuffle} onClick={p.toggleShuffle} />
            </Tooltip>
            <IconButton icon="skip-back" label="Предыдущий" onClick={p.prev} disabled={!t} />
            <IconButton
              icon={p.playing ? "pause" : "play"}
              variant="accent"
              label={p.playing ? "Пауза" : "Играть"}
              onClick={p.toggle}
              disabled={!t}
            />
            <IconButton icon="skip-forward" label="Следующий" onClick={p.next} disabled={!t} />
            <Tooltip label={p.repeat === "one" ? "Повтор трека" : p.repeat === "all" ? "Повтор очереди" : "Повтор выключен"}>
              <IconButton
                icon={p.repeat === "one" ? "repeat-1" : "repeat"}
                size="sm"
                label="Повтор"
                active={p.repeat !== "off"}
                onClick={p.cycleRepeat}
              />
            </Tooltip>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", width: "100%", maxWidth: 560 }}>
            <span style={timeStyle}>{fmtTime(position)}</span>
            <Slider
              value={position}
              max={Math.max(duration, 1)}
              onChange={p.seek}
              ariaLabel="Позиция"
              valueText={`${fmtTime(position)} из ${fmtTime(duration)}`}
              hoverLabel={fmtTime}
              style={{ flex: 1 }}
            />
            <span style={timeStyle}>{fmtTime(duration)}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-2)" }}>
          <Tooltip label="Сейчас играет">
            <IconButton icon="panel-right" size="sm" label="Панель «Сейчас играет»" active={npOpen} onClick={onToggleNp} disabled={!t} />
          </Tooltip>
          <IconButton icon={volumeIcon} size="sm" label={p.muted ? "Включить звук" : "Выключить звук"} onClick={p.toggleMute} />
          <Slider
            value={p.muted ? 0 : Math.round(p.volume * 100)}
            max={100}
            onChange={(v) => p.setVolume(v / 100)}
            ariaLabel="Громкость"
            valueText={`${Math.round((p.muted ? 0 : p.volume) * 100)}%`}
            style={{ width: 110 }}
          />
        </div>
      </footer>

      {/* ── Телефон: мини-бар. Вложенных <button> нет: подложка «Открыть» —
          отдельная растянутая кнопка, контент лежит поверх с pointer-events:
          none (кроме транспорта). ── */}
      <div className="minibar">
        <button type="button" className="minibar-open" aria-label="Открыть «Сейчас играет»" onClick={onOpenMobile} />
        <span className="minibar-progress" style={{ width: duration > 0 ? `${(position / duration) * 100}%` : 0 }} />
        <span
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            height: "100%",
            padding: "0 var(--sp-3)",
            pointerEvents: "none",
            boxSizing: "border-box",
          }}
        >
          <CoverThumb url={t?.coverUrl ?? null} size={44} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-body)",
                fontWeight: 600,
                color: "var(--text-1)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t ? t.title : "Ничего не играет"}
            </span>
            <span
              style={{
                display: "block",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-caption)",
                color: p.error ? "var(--danger)" : "var(--text-3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {subtitle}
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", pointerEvents: "auto" }}>
            <IconButton
              icon={p.playing ? "pause" : "play"}
              variant="accent"
              size="sm"
              label={p.playing ? "Пауза" : "Играть"}
              onClick={p.toggle}
              disabled={!t}
            />
            <IconButton icon="skip-forward" size="sm" label="Следующий" onClick={p.next} disabled={!t} />
          </span>
        </span>
      </div>
    </>
  );
}

const timeStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  color: "var(--text-3)",
  fontVariantNumeric: "tabular-nums",
  flex: "none",
};
