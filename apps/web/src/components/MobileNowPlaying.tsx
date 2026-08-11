"use client";

import { useEffect, useRef, useState } from "react";
import type { Track } from "@muza/api-client";
import { Cover, IconButton, Slider, useLayerState } from "@muza/ui";
import { useT } from "@muza/app";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer, usePosition } from "../player";
import { LyricsBlock } from "./LyricsPanel";

/** Полноэкранный now-playing телефона: открывается тапом по мини-бару.
 *  Два вида — обложка и текст (кнопка mic-vocal). Глубокое стекло поверх
 *  сценографии; Esc/шеврон закрывают.
 *
 *  Э7 веб-паритета: вид «текст» стал КАРАОКЕ — тем же окном строк вокруг
 *  активной, что в полноэкранном режиме приложения (@muza/app/shell/
 *  ListeningMode). Полный экран телефона — это и есть караоке-сцена: держать
 *  здесь панельный список, когда рядом в приложении окно, значило бы снова
 *  разъехаться. Размер окна, автопрокрутку, нотку и «смысл» LyricsBlock берёт
 *  из настроек сам (см. шапку LyricsPanel.tsx) — пропов у него для этого нет
 *  нарочно.
 *
 *  Сам ListeningMode сюда НЕ ставится намеренно: его сцена — две колонки
 *  (обложка слева, текст справа) под ландшафтное окно, на 375px это чужая
 *  раскладка. Общее у экранов — полотно текста и его настройки, и оно общее.
 *
 *  ⚠️ Это правило — ПРО ТЕЛЕФОН, и только про него. На широком окне общий
 *  ListeningMode с 2026-08-02 подключён (components/ListeningModeHost.tsx):
 *  там две колонки как раз есть, и раньше клик по обложке в полосе плеера не
 *  делал ничего, хотя в приложении открывал караоке. Два полноэкранных режима
 *  не пересекаются: хост не монтируется на телефонной раскладке, этот экран
 *  открывается только с мини-бара, которого на широком окне нет.
 *
 *  ⚠️ ЭКРАН ЖИВЁТ ПРОПОМ `open`, А НЕ УСЛОВНЫМ РЕНДЕРОМ РОДИТЕЛЯ. Раньше
 *  оболочка снимала его из дерева по клику — то есть полный экран телефона
 *  исчезал кадром, без ухода. Теперь жизненным циклом заведует useLayerState:
 *  узел остаётся в дереве, пока играет уход (.muza-layer--scene, поза и время —
 *  в globals.css → .np-overlay). Снять его раньше нельзя ни здесь, ни у
 *  родителя — уходить будет нечему. */
export function MobileNowPlaying({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePlayer();
  const { position, duration } = usePosition();
  const { likedIds, toggle } = useLikes();
  const { t } = useT();
  /** Вид переживает закрытие: узел теперь не размонтируется, и человек,
   *  вернувшийся в текст песни, застаёт текст, а не обложку. Ровно так же
   *  помнит себя караоке приложения (prefs.listeningLyricsShown). */
  const [view, setView] = useState<"cover" | "lyrics">("cover");
  const current = p.current;
  const { mounted, layerProps } = useLayerState(open);

  // Слушатель — ТОЛЬКО пока экран открыт: узел живёт всё время работы вкладки,
  // и безусловная подписка отбирала бы Esc у диалогов оболочки.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // трек кончился и очередь пуста — закрываемся сами
  useEffect(() => {
    if (open && !current) onClose();
  }, [open, current, onClose]);

  /** Что показывать, пока экран УХОДИТ. Очередь могла кончиться (см. эффект
   *  выше), и `current` уже null — без последнего известного трека сцена не
   *  ушла бы, а схлопнулась кадром, то есть ровно то, что мы и лечим. */
  const shownRef = useRef<Track | null>(null);
  if (current) shownRef.current = current;
  const track = current ?? shownRef.current;

  if (!mounted || !track) return null;

  const repeatLabel = p.repeat === "one" ? t("player.repeat.one") : p.repeat === "all" ? t("player.repeat.all") : t("player.repeat.off");

  return (
    <div className="np-overlay muza-layer muza-layer--scene" role="dialog" aria-label={t("nowPlaying.heading")} {...layerProps}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* «Свернуть» — общая строка режима прослушивания: та же кнопка выхода
            из полноэкранного «Сейчас играет», что в приложении. */}
        <IconButton icon="chevron-down" label={t("listeningMode.minimize")} onClick={onClose} />
        <span
          style={{
            fontSize: "var(--fs-caption)",
            fontWeight: 600,
            letterSpacing: "var(--ls-caps)",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          {t("nowPlaying.heading")}
        </span>
        <IconButton
          icon="mic-vocal"
          label={view === "cover" ? t("player.lyrics") : t("web.mobileNowPlaying.coverAria")}
          active={view === "lyrics"}
          onClick={() => setView((v) => (v === "cover" ? "lyrics" : "cover"))}
        />
      </div>

      {/* Центр: обложка или текст */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "var(--sp-4) 0" }}>
        {view === "cover" ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            {/* Обложка — только через Cover ДС: он один знает про вшитые поля
                тумбов источника и про то, какие варианты трогать нельзя. */}
            <Cover
              key={track.coverUrl ?? "none"}
              src={track.coverUrl}
              radius="var(--r-md)"
              className="muza-fade"
              style={{ width: "min(78vw, 46vh)" }}
            />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <LyricsBlock karaoke />
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
              fontWeight: 400,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.error ?? track.artist}
          </div>
        </div>
        <IconButton
          icon="heart"
          label={likedIds.has(track.id) ? t("menu.catalog.unlike") : t("menu.catalog.like")}
          filled={likedIds.has(track.id)}
          onClick={() => toggle(track)}
        />
      </div>

      {/* Прогресс */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", paddingBottom: "var(--sp-3)" }}>
        <Slider
          value={position}
          max={Math.max(duration, 1)}
          onChange={p.seek}
          rate={p.playing ? 1 : 0}
          ariaLabel={t("player.progress")}
          valueText={t("player.progressValueText", { pos: fmtTime(position), duration: fmtTime(duration) })}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
          <span>{fmtTime(position)}</span>
          <span>{fmtTime(duration)}</span>
        </div>
      </div>

      {/* Транспорт */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-4)" }}>
        <IconButton icon="shuffle" size="sm" label={t("player.shuffle")} active={p.shuffle} onClick={p.toggleShuffle} />
        <IconButton icon="skip-back" size="lg" label={t("player.previous")} onClick={p.prev} />
        <IconButton
          icon={p.playing ? "pause" : "play"}
          size="lg"
          variant="accent"
          label={p.playing ? t("player.pause") : t("player.play")}
          onClick={p.toggle}
        />
        <IconButton icon="skip-forward" size="lg" label={t("player.next")} onClick={p.next} />
        <IconButton
          icon={p.repeat === "one" ? "repeat-1" : "repeat"}
          size="sm"
          label={repeatLabel}
          active={p.repeat !== "off"}
          onClick={p.cycleRepeat}
        />
      </div>
    </div>
  );
}
