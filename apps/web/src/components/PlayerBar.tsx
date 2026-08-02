"use client";

import { Cover, Icon, IconButton, Slider, Spinner, Tooltip } from "@muza/ui";
import { useT } from "@muza/app";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer, usePosition } from "../player";

/** Сердце с «пульсом» при лайке: key по liked — remount перезапускает
 *  анимацию muza-like-pop ровно в момент переключения. */
function LikeButton({ liked, onToggle, size = "sm" as const }: { liked: boolean; onToggle: () => void; size?: "sm" | "md" }) {
  const { t } = useT();
  return (
    <span key={liked ? "on" : "off"} className={liked ? "muza-like-pop" : undefined} style={{ display: "inline-flex" }}>
      <IconButton
        icon="heart"
        size={size}
        label={liked ? t("menu.catalog.unlike") : t("menu.catalog.like")}
        filled={liked}
        onClick={onToggle}
      />
    </span>
  );
}

// Своей обложки здесь больше нет — рисуем через <Cover> дизайн-системы, как
// это делает приложение (apps/desktop/src/shell/PlayerBar.tsx). Прежняя
// самоделка ставила сырой <img> с object-fit:cover, а сервер отдаёт тумб
// YouTube hqdefault 480×360: это кадр 16:9 с чёрными полями по 45px сверху и
// снизу. Центральный квадрат такой картинки — 360×360 — забирает обе полосы
// целиком, отсюда и жалоба владельца на «серые и чёрные грани». Cover знает
// про этот квирк ytimg и доворачивает геометрию (см. его шапку), а заодно даёт
// тот же плейсхолдер, что в приложении.

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
  const { t } = useT();
  const current = p.current;

  const volumeIcon = p.muted || p.volume === 0 ? "volume-x" : p.volume < 0.5 ? "volume-1" : "volume-2";
  const subtitle = p.error ?? (p.loading ? t("common.loading") : (current?.artist ?? t("web.player.queueHint")));

  return (
    <>
      {/* ── Десктоп ── */}
      <footer className="playerbar">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
          <Cover src={current?.coverUrl ?? null} size={52} />
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
              {current ? current.title : t("player.empty.title")}
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
          {current ? <LikeButton liked={likedIds.has(current.id)} onToggle={() => toggle(current)} /> : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <Tooltip label={t("player.shuffle")}>
              <IconButton icon="shuffle" size="sm" label={t("player.shuffle")} active={p.shuffle} onClick={p.toggleShuffle} />
            </Tooltip>
            <IconButton icon="skip-back" label={t("player.previous")} onClick={p.prev} disabled={!current} />
            <IconButton
              icon={p.playing ? "pause" : "play"}
              variant="accent"
              label={p.playing ? t("player.pause") : t("player.play")}
              onClick={p.toggle}
              disabled={!current}
            />
            <IconButton icon="skip-forward" label={t("player.next")} onClick={p.next} disabled={!current} />
            <Tooltip label={p.repeat === "one" ? t("player.repeat.one") : p.repeat === "all" ? t("player.repeat.all") : t("player.repeat.off")}>
              <IconButton
                icon={p.repeat === "one" ? "repeat-1" : "repeat"}
                size="sm"
                label={p.repeat === "one" ? t("player.repeat.one") : p.repeat === "all" ? t("player.repeat.all") : t("player.repeat.off")}
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
              rate={p.playing ? 1 : 0}
              ariaLabel={t("player.progress")}
              valueText={t("player.progressValueText", { pos: fmtTime(position), duration: fmtTime(duration) })}
              hoverLabel={fmtTime}
              style={{ flex: 1 }}
            />
            <span style={timeStyle}>{fmtTime(duration)}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-2)" }}>
          <Tooltip label={t("nowPlaying.heading")}>
            <IconButton
              icon="panel-right"
              size="sm"
              label={t("web.player.npPanelAria")}
              active={npOpen}
              onClick={onToggleNp}
              disabled={!current}
            />
          </Tooltip>
          <IconButton icon={volumeIcon} size="sm" label={p.muted ? t("player.unmute") : t("player.mute")} onClick={p.toggleMute} />
          <Slider
            value={p.muted ? 0 : Math.round(p.volume * 100)}
            max={100}
            onChange={(v) => p.setVolume(v / 100)}
            ariaLabel={t("player.volume")}
            valueText={`${Math.round((p.muted ? 0 : p.volume) * 100)}%`}
            style={{ width: 110 }}
          />
        </div>
      </footer>

      {/* ── Телефон: мини-бар. Вложенных <button> нет: подложка «Открыть» —
          отдельная растянутая кнопка, контент лежит поверх с pointer-events:
          none (кроме транспорта). ── */}
      <div className="minibar">
        <button type="button" className="minibar-open" aria-label={t("web.player.openNowPlayingAria")} onClick={onOpenMobile} />
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
          <Cover src={current?.coverUrl ?? null} size={44} />
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
              {current ? current.title : t("player.empty.title")}
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
              label={p.playing ? t("player.pause") : t("player.play")}
              onClick={p.toggle}
              disabled={!current}
            />
            <IconButton icon="skip-forward" size="sm" label={t("player.next")} onClick={p.next} disabled={!current} />
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
