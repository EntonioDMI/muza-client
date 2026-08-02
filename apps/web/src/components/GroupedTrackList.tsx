"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Icon, TrackRow } from "@muza/ui";
import type { GroupedSearchResult, GroupSearchResult, Track } from "@muza/api-client";
import { useT } from "@muza/app";
import { ContextMenuProvider } from "@muza/app/shell/ContextMenu";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { pluralVersions, variantLabel } from "../variantLabels";
import { TRACK_DND_MIME, setTrackDragImage, useWebTrackMenu } from "./TrackList";

/** Список результатов поиска с группировкой ремиксов/версий (T41, ?group=1
 *  сервера T36): "single" — обычная строка, "group" — карточка канона с
 *  разворотом вариантов. Лайк на карточке всегда бьёт по canonical; у
 *  развёрнутых вариантов — свой лайк (обычное поведение). Плейбек — общая
 *  для всей выдачи очередь (canonical и все variants по порядку карточек),
 *  чтобы «следующий трек» листал всю страницу, а не только один список.
 *
 *  ПКМ и множественный выбор — общие с приложением (useWebTrackMenu в
 *  TrackList.tsx): свой массив пунктов список больше не собирает. Выделение
 *  считается по ПОЛНОЙ выдаче (flat), включая свёрнутые варианты — иначе
 *  Shift-диапазон менялся бы от того, что человек развернул. */
export function GroupedTrackList({ results }: { results: GroupedSearchResult[] }) {
  const { likedIds, toggle } = useLikes();
  const { current, playing, playContext } = usePlayer();
  const { t, lang } = useT();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // новая выдача — сворачиваем всё заново (индексы прошлой выдачи не про то же)
  useEffect(() => setExpanded(new Set()), [results]);

  const flat = useMemo(() => {
    const list: Track[] = [];
    for (const r of results) {
      if (r.kind === "single") list.push(r.track);
      else {
        list.push(r.canonical);
        for (const v of r.variants) list.push(v.track);
      }
    }
    return list;
  }, [results]);

  // Выделение и меню считаются по ПОЛНОЙ выдаче (flat), а не по видимым
  // строкам: свёрнутые варианты — часть того же списка, и Shift-диапазон
  // обязан их захватывать так же, как в приложении (SearchView).
  const menu = useWebTrackMenu(flat);
  const { multi } = menu;

  const playTrack = (track: Track) => {
    const idx = flat.findIndex((t) => t.id === track.id);
    if (idx >= 0) playContext(flat, idx);
  };

  const toggleExpand = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  /** Общая обвязка строки — тач-таргет/драг-источник, как в TrackList. */
  const rowWrap = (track: Track, key: string, children: React.ReactNode) => {
    const isLocal = Boolean(track.localHash);
    return (
      <div
        key={key}
        draggable={!isLocal}
        onDragStart={(e) => {
          e.dataTransfer.setData(TRACK_DND_MIME, JSON.stringify({ id: track.id, title: track.title }));
          e.dataTransfer.effectAllowed = "copy";
          setTrackDragImage(e, track);
        }}
        style={isLocal ? { opacity: 0.45, pointerEvents: "none" } : { cursor: "pointer" }}
        onClickCapture={(e) => menu.eatSelectionClick(track.id, e)}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          playTrack(track);
        }}
      >
        {children}
      </div>
    );
  };

  const trackRowFor = (track: Track) => (
    <TrackRow
      cover={track.coverUrl ?? undefined}
      title={track.localHash ? t("web.trackList.fileOnOtherDevice", { title: track.title }) : track.title}
      artist={track.artist}
      duration={fmtTime(track.durationSec)}
      active={current?.id === track.id}
      playing={current?.id === track.id && playing}
      liked={likedIds.has(track.id)}
      selected={multi.has(track.id)}
      onPlay={() => playTrack(track)}
      onLike={() => toggle(track)}
      onMore={(e) => menu.openRowMenu(track, e)}
    />
  );

  const groupCard = (r: GroupSearchResult, i: number) => {
    const isExpanded = expanded.has(i);
    const versionCount = r.variants.length;
    const canonLabel = !r.hasOriginal ? variantLabel(r.canonicalVariantType, lang) : null;
    return (
      <div key={`g-${r.canonical.id}-${i}`}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>{rowWrap(r.canonical, `gh-${r.canonical.id}`, trackRowFor(r.canonical))}</div>
          <button
            type="button"
            onClick={() => toggleExpand(i)}
            aria-expanded={isExpanded}
            aria-label={`${versionCount} ${pluralVersions(versionCount, lang)} — ${isExpanded ? t("views.search.groupCard.collapse") : t("views.search.groupCard.expand")}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-1)",
              flex: "none",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "var(--sp-2)",
              borderRadius: "var(--r-sm)",
            }}
          >
            <Badge tone={r.hasOriginal ? "accent" : "neutral"}>
              {versionCount} {pluralVersions(versionCount, lang)}
            </Badge>
            <Icon
              name="chevron-down"
              size={16}
              color="var(--text-3)"
              style={{ transform: isExpanded ? "rotate(180deg)" : undefined, transition: "transform var(--dur-fast, 150ms)" }}
            />
          </button>
        </div>
        {canonLabel ? (
          <div
            style={{
              padding: "0 var(--sp-4) var(--sp-1) 82px",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-caption)",
              color: "var(--text-3)",
            }}
          >
            {t("views.search.groupCard.noOriginal", { label: canonLabel })}
          </div>
        ) : null}
        {isExpanded ? (
          <div style={{ display: "flex", flexDirection: "column", paddingLeft: 32 }}>
            {/* Подпись категории — СТРОКОЙ НАД TrackRow, не сбоку: на 375px
                TrackRow (index+обложка+лайк+длительность+«ещё» — фикс-ширина
                хрома) не сжимается ниже ~220px, а бейдж-сосед в один ряд
                отъедал ровно столько, чтобы вызвать горизонтальный скролл
                main (живая проверка T41, зафиксировано и исправлено). */}
            {r.variants.map((v, vi) => (
              <div key={`gv-${v.track.id}-${vi}`} style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--fs-caption)",
                    fontWeight: 600,
                    color: "var(--text-3)",
                    padding: "var(--sp-1) 0 0 var(--sp-2)",
                  }}
                >
                  {variantLabel(v.variantType, lang)}
                </span>
                {rowWrap(v.track, `gv-row-${v.track.id}`, trackRowFor(v.track))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    // Провайдер меню — свой у каждого списка (см. TrackList): у списка свои
    // умения и своё выделение, общего стора здесь не нужно.
    <ContextMenuProvider ctx={menu.abilities} apiRef={menu.apiRef} suppressNativeMenu={false}>
      <div style={{ display: "flex", flexDirection: "column" }} onContextMenu={menu.openBlankMenu}>
        {results.map((r, i) =>
          r.kind === "single" ? rowWrap(r.track, `s-${r.track.id}-${i}`, trackRowFor(r.track)) : groupCard(r, i),
        )}
      </div>
      {menu.overlay}
    </ContextMenuProvider>
  );
}
