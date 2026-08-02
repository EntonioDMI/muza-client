"use client";

import { useState } from "react";
import { Cover, IconButton, Spinner, Tooltip } from "@muza/ui";
import { useT } from "@muza/app";
import { PlayerBar as SharedPlayerBar } from "@muza/app/shell/PlayerBar";
import { QueuePanel } from "@muza/app/shell/QueuePanel";
import { useLikes } from "../likes";
import { usePlayer, usePosition } from "../player";

/** Плеер веба: на широком экране — ТА ЖЕ полоса, что в приложении
 *  (@muza/app/shell/PlayerBar), на телефоне — мини-бар над нижней навигацией
 *  (тап открывает полноэкранный now-playing). Оба варианта в DOM, переключает
 *  CSS-брейкпоинт (globals.css: .playerbar / .minibar).
 *
 *  Э3 веб-паритета (2026-08-02): своей полосы здесь больше нет. Прежняя была
 *  написана «по памяти» и разъезжалась с приложением — не было перемешивания,
 *  повтора, очереди; время считалось другой формулой. Теперь этот файл только
 *  ПОДКЛЮЧАЕТ общую полосу к веб-плееру (player.tsx) и лайкам.
 *
 *  Чего в вебе нет — того нет и в баре, и это не «серые заглушки»: общая
 *  полоса рисует кнопку, только если ей дали обработчик. Мы не даём таймер
 *  сна, скорость, эквалайзер, текст песни, совместное прослушивание и вынос
 *  файла на рабочий стол — их в вебе не существует. Остаются перемешивание,
 *  повтор, очередь и громкость.
 *
 *  ⚠️ Мини-бар остался своим: у приложения телефона нет вовсе, и переносить
 *  в общий пакет пока нечего — он рисует ту же пару «обложка + название +
 *  транспорт», но в высоту 60px и с полосой прогресса вместо слайдера. */
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
  const [queueOpen, setQueueOpen] = useState(false);
  const current = p.current;

  // Длительность берём живую (метаданные <audio>), пока её нет — серверную:
  // иначе первые секунды трека полоса стояла бы на нулевой шкале.
  const trackDuration = duration > 0 ? duration : (current?.durationSec ?? 0);

  /** Строка под названием: обычно артист (его подставляет сама полоса), но
   *  подготовка и ошибка важнее — их и показываем вместо него. */
  const status = p.error ?? (p.loading ? t("common.loading") : null);
  const statusNode = status ? (
    <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", color: p.error ? "var(--danger)" : undefined }}>
      {p.loading && !p.error ? <Spinner size={12} /> : null}
      {status}
    </span>
  ) : undefined;

  /** Клик по строке очереди. Веб-плеер умеет только «играть этот список с
   *  такого-то места», отдельного «перейти к N» у него нет — поэтому очередь
   *  перезапускается сама собой. Побочный эффект: перемешивание выключается.
   *  Уйдёт, когда у плеера появится переход по индексу. */
  const playFromQueue = (id: string) => {
    const i = p.queue.findIndex((x) => x.id === id);
    if (i >= 0) p.playContext(p.queue, i);
  };

  const miniSubtitle = p.error ?? (p.loading ? t("common.loading") : (current?.artist ?? t("web.player.queueHint")));

  return (
    <>
      {/* ── Широкий экран: общая полоса приложения ── */}
      <SharedPlayerBar
        // геометрию и безопасные зоны телефона держит CSS веба (.playerbar);
        // приложение живёт на инлайновых стилях самой полосы
        className="playerbar"
        progressStyle={{ width: "100%", maxWidth: 560 }}
        track={
          current
            ? {
                id: current.id,
                title: current.title,
                artist: current.artist,
                cover: current.coverUrl ?? null,
                duration: trackDuration,
              }
            : null
        }
        subtitle={statusNode}
        playing={p.playing}
        buffering={p.loading}
        onTogglePlay={p.toggle}
        onPrev={p.prev}
        onNext={p.next}
        pos={position}
        onSeek={p.seek}
        vol={p.muted ? 0 : Math.round(p.volume * 100)}
        onVol={(v) => p.setVolume(v / 100)}
        onMute={p.toggleMute}
        liked={current ? likedIds.has(current.id) : false}
        onLike={() => current && toggle(current)}
        shuffle={p.shuffle}
        onShuffle={p.toggleShuffle}
        repeat={p.repeat}
        onRepeat={p.cycleRepeat}
        queueOn={queueOpen}
        onQueue={() => setQueueOpen((v) => !v)}
        // боковая панель «Сейчас играет» — веб-специфика: в приложении её
        // место занимает режим прослушивания, кнопки такой в компоновке нет
        extraButtons={
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
        }
      />

      {/* Очередь — та же панель, что в приложении. Правки состава веб пока не
          умеет (у плеера нет ни удаления, ни перестановки), и панель просто
          не рисует этих кнопок. */}
      <QueuePanel
        open={queueOpen}
        tracks={p.queue.map((tr) => ({
          id: tr.id,
          title: tr.title,
          artist: tr.artist,
          cover: tr.coverUrl ?? null,
          duration: tr.durationSec,
        }))}
        currentIndex={p.index}
        playing={p.playing}
        canSave={false}
        onPlayTrack={playFromQueue}
        onClose={() => setQueueOpen(false)}
      />

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
          {/* Обложка — через Cover ДС, а не голый <img>: Cover знает про вшитые
              поля тумбов источника (кадр 4:3 с чёрными полосами сверху и
              снизу) и доворачивает геометрию сам. Сырой <img> с object-fit
              забирал эти полосы в кадр — отсюда была жалоба на «серые и
              чёрные грани». */}
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
              {miniSubtitle}
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
