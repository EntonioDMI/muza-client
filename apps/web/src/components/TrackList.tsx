"use client";

import { useState } from "react";
import { Dialog, Icon, Menu, TrackRow } from "@muza/ui";
import type { PlaylistMeta, Track } from "@muza/api-client";
import { useT } from "@muza/app";
import { getApi } from "../api";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { usePlaylists } from "../playlists";
import { useToast } from "../toast";

/** Тип данных внутреннего DnD (строка трека → плейлист сайдбара). */
export const TRACK_DND_MIME = "application/x-muza-track";

/** Кастомный ghost для драга: мини-пилюля с названием вместо полупрозрачного
 *  скриншота строки. Убирается сам после старта драга. Экспортирован —
 *  переиспользуется GroupedTrackList.tsx (T41), чтобы не дублировать. */
export function setTrackDragImage(e: React.DragEvent, track: Track) {
  const ghost = document.createElement("div");
  ghost.textContent = `${track.artist} — ${track.title}`;
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-100px",
    left: "-100px",
    maxWidth: "260px",
    padding: "8px 14px",
    borderRadius: "999px",
    background: "var(--glass-panel)",
    color: "var(--text-1)",
    font: "600 13px var(--font-ui)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    pointerEvents: "none",
    zIndex: "100",
  } as CSSStyleDeclaration);
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 16, 16);
  setTimeout(() => ghost.remove(), 0);
}

/** Список треков на TrackRow ДС: клик/даблклик — playContext, лайк — общий
 *  контекст, «⋯» и ПКМ — меню (в любимое / в плейлист / скачать / убрать из
 *  плейлиста — только когда передан onRemoveFromPlaylist), строка
 *  перетаскивается в плейлисты сайдбара. Локальные треки других устройств
 *  не играбельны на вебе — приглушены. */
export function TrackList({
  tracks,
  onRemoveFromPlaylist,
}: {
  tracks: Track[];
  /** Передаётся только со страницы плейлиста: добавляет в меню пункт
   *  «Убрать из плейлиста» (список — не общий контекст, только владелец
   *  страницы знает playlistId и умеет перезагрузить detail). */
  onRemoveFromPlaylist?: (track: Track) => void;
}) {
  const { likedIds, toggle } = useLikes();
  const { current, playing, playContext } = usePlayer();
  const { playlists, loaded, refresh: refreshPlaylists } = usePlaylists();
  const notify = useToast();
  const { t } = useT();
  const [menu, setMenu] = useState<{ x: number; y: number; track: Track; index: number } | null>(null);
  const [plPick, setPlPick] = useState<Track | null>(null);

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

  /** Скачать: сервер отдаёт файл с Content-Disposition (?dl=1). Холодный трек
   *  сервер сперва добывает — браузер честно покажет ожидание в загрузках. */
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

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {tracks.map((tr, i) => {
        const isLocal = Boolean(tr.localHash);
        return (
          // вся строка — тач-таргет и драг-источник; клики по кнопкам внутри
          // (лайк/⋯) не перехватываем
          <div
            key={`${tr.id}-${i}`}
            draggable={!isLocal}
            onDragStart={(e) => {
              e.dataTransfer.setData(TRACK_DND_MIME, JSON.stringify({ id: tr.id, title: tr.title }));
              e.dataTransfer.effectAllowed = "copy";
              setTrackDragImage(e, tr);
            }}
            style={isLocal ? { opacity: 0.45, pointerEvents: "none" } : { cursor: "pointer" }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              playContext(tracks, i);
            }}
          >
            <TrackRow
              index={i + 1}
              cover={tr.coverUrl ?? undefined}
              title={isLocal ? t("web.trackList.fileOnOtherDevice", { title: tr.title }) : tr.title}
              artist={tr.artist}
              duration={fmtTime(tr.durationSec)}
              active={current?.id === tr.id}
              playing={current?.id === tr.id && playing}
              liked={likedIds.has(tr.id)}
              onPlay={() => playContext(tracks, i)}
              onLike={() => toggle(tr)}
              onMore={(e) => {
                setMenu({ x: e.clientX, y: e.clientY, track: tr, index: i });
              }}
            />
          </div>
        );
      })}

      <Menu
        open={menu !== null}
        x={menu?.x}
        y={menu?.y}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                { icon: "play", label: t("menu.playlist.play"), onClick: () => playContext(tracks, menu.index) },
                {
                  icon: "heart",
                  label: likedIds.has(menu.track.id) ? t("menu.catalog.unlike") : t("menu.catalog.like"),
                  onClick: () => toggle(menu.track),
                },
                "-",
                { icon: "list-music", label: t("menu.addToPlaylist"), onClick: () => openPlaylistPick(menu.track) },
                { icon: "download", label: t("common.download"), onClick: () => void download(menu.track) },
                ...(onRemoveFromPlaylist
                  ? [
                      "-" as const,
                      { icon: "list-x", label: t("views.playlist.removeFromPlaylist"), onClick: () => onRemoveFromPlaylist(menu.track) },
                    ]
                  : []),
              ]
            : []
        }
      />

      {/* Выбор плейлиста для «В плейлист…» */}
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
