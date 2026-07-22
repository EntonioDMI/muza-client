"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Dialog, Icon, Menu, TrackRow } from "@muza/ui";
import type { GroupedSearchResult, GroupSearchResult, PlaylistMeta, Track } from "@muza/api-client";
import { useT } from "@muza/app";
import { getApi } from "../api";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { usePlaylists } from "../playlists";
import { useToast } from "../toast";
import { pluralVersions, variantLabel } from "../variantLabels";
import { TRACK_DND_MIME, setTrackDragImage } from "./TrackList";

/** Список результатов поиска с группировкой ремиксов/версий (T41, ?group=1
 *  сервера T36): "single" — обычная строка, "group" — карточка канона с
 *  разворотом вариантов. Лайк на карточке всегда бьёт по canonical; у
 *  развёрнутых вариантов — свой лайк (обычное поведение). Плейбек — общая
 *  для всей выдачи очередь (canonical и все variants по порядку карточек),
 *  чтобы «следующий трек» листал всю страницу, а не только один список. */
export function GroupedTrackList({ results }: { results: GroupedSearchResult[] }) {
  const { likedIds, toggle } = useLikes();
  const { current, playing, playContext } = usePlayer();
  const { playlists, loaded, refresh: refreshPlaylists } = usePlaylists();
  const notify = useToast();
  const { t, lang } = useT();
  const [menu, setMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const [plPick, setPlPick] = useState<Track | null>(null);
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

  const openPlaylistPick = (track: Track) => {
    setPlPick(track);
    if (!loaded) void refreshPlaylists();
  };

  const addToPlaylist = async (pl: PlaylistMeta, track: Track) => {
    setPlPick(null);
    try {
      await getApi().addPlaylistTrack(pl.id, track.id);
      notify(t("toast.playlist.addedTrack", { name: pl.name }), "list-music");
      void refreshPlaylists();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("toast.playlist.addFailed"), "x");
    }
  };

  const download = async (track: Track) => {
    try {
      const { url } = await getApi().getStreamUrl(track.id);
      const a = document.createElement("a");
      a.href = `${url}&dl=1`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      notify(t("web.trackList.downloadStarted"), "download");
    } catch (e) {
      notify(e instanceof Error ? e.message : t("web.trackList.downloadFailed"), "x");
    }
  };

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
      onPlay={() => playTrack(track)}
      onLike={() => toggle(track)}
      onMore={(e) => setMenu({ x: e.clientX, y: e.clientY, track })}
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
    <div style={{ display: "flex", flexDirection: "column" }}>
      {results.map((r, i) =>
        r.kind === "single" ? rowWrap(r.track, `s-${r.track.id}-${i}`, trackRowFor(r.track)) : groupCard(r, i),
      )}

      <Menu
        open={menu !== null}
        x={menu?.x}
        y={menu?.y}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                { icon: "play", label: t("menu.playlist.play"), onClick: () => playTrack(menu.track) },
                {
                  icon: "heart",
                  label: likedIds.has(menu.track.id) ? t("menu.catalog.unlike") : t("menu.catalog.like"),
                  onClick: () => toggle(menu.track),
                },
                "-",
                { icon: "list-music", label: t("menu.addToPlaylist"), onClick: () => openPlaylistPick(menu.track) },
                { icon: "download", label: t("common.download"), onClick: () => void download(menu.track) },
              ]
            : []
        }
      />

      <Dialog open={plPick !== null} title={t("web.trackList.choosePlaylist")} onClose={() => setPlPick(null)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 300, maxHeight: 320, overflowY: "auto", overflowX: "hidden" }}>
          {!loaded ? (
            <span style={{ fontFamily: "var(--font-ui)", color: "var(--text-3)", padding: "var(--sp-2)" }}>{t("common.loading")}</span>
          ) : playlists.length === 0 ? (
            <span style={{ fontFamily: "var(--font-ui)", color: "var(--text-3)", padding: "var(--sp-2)" }}>
              {t("web.trackList.noPlaylistsHint")}
            </span>
          ) : (
            playlists.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => plPick && void addToPlaylist(p, plPick)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                  padding: "var(--sp-2) var(--sp-3)",
                  border: "none",
                  borderRadius: "var(--r-sm)",
                  background: "transparent",
                  color: "var(--text-1)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-body)",
                  fontWeight: 500,
                  textAlign: "left",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Icon name="list-music" size={18} color="var(--accent-text)" />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{p.trackCount}</span>
              </button>
            ))
          )}
        </div>
      </Dialog>
    </div>
  );
}
