"use client";

import { useState } from "react";
import { Dialog, Icon, Menu, TrackRow } from "@muza/ui";
import type { PlaylistMeta, Track } from "@muza/api-client";
import { getApi } from "../api";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { useToast } from "../toast";

/** Тип данных внутреннего DnD (строка трека → плейлист сайдбара). */
export const TRACK_DND_MIME = "application/x-muza-track";

/** Кастомный ghost для драга: мини-пилюля с названием вместо полупрозрачного
 *  скриншота строки. Убирается сам после старта драга. */
function setTrackDragImage(e: React.DragEvent, track: Track) {
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
 *  контекст, «⋯» и ПКМ — меню (в любимое / в плейлист / скачать), строка
 *  перетаскивается в плейлисты сайдбара. Локальные треки других устройств
 *  не играбельны на вебе — приглушены. */
export function TrackList({ tracks }: { tracks: Track[] }) {
  const { likedIds, toggle } = useLikes();
  const { current, playing, playContext } = usePlayer();
  const notify = useToast();
  const [menu, setMenu] = useState<{ x: number; y: number; track: Track; index: number } | null>(null);
  const [plPick, setPlPick] = useState<Track | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistMeta[] | null>(null);

  const openPlaylistPick = (track: Track) => {
    setPlPick(track);
    if (playlists === null) {
      getApi()
        .getPlaylists()
        .then(setPlaylists)
        .catch(() => setPlaylists([]));
    }
  };

  const addToPlaylist = async (pl: PlaylistMeta, track: Track) => {
    setPlPick(null);
    try {
      await getApi().addPlaylistTrack(pl.id, track.id);
      notify(`Добавлено в «${pl.name}»`, "list-music");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Не удалось добавить", "x");
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
      notify("Скачивание началось", "download");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Не удалось скачать", "x");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {tracks.map((t, i) => {
        const isLocal = Boolean(t.localHash);
        return (
          // вся строка — тач-таргет и драг-источник; клики по кнопкам внутри
          // (лайк/⋯) не перехватываем
          <div
            key={`${t.id}-${i}`}
            draggable={!isLocal}
            onDragStart={(e) => {
              e.dataTransfer.setData(TRACK_DND_MIME, JSON.stringify({ id: t.id, title: t.title }));
              e.dataTransfer.effectAllowed = "copy";
              setTrackDragImage(e, t);
            }}
            style={isLocal ? { opacity: 0.45, pointerEvents: "none" } : { cursor: "pointer" }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              playContext(tracks, i);
            }}
          >
            <TrackRow
              index={i + 1}
              cover={t.coverUrl ?? undefined}
              title={isLocal ? `${t.title} — файл на другом устройстве` : t.title}
              artist={t.artist}
              duration={fmtTime(t.durationSec)}
              active={current?.id === t.id}
              playing={current?.id === t.id && playing}
              liked={likedIds.has(t.id)}
              onPlay={() => playContext(tracks, i)}
              onLike={() => toggle(t)}
              onMore={(e) => {
                setMenu({ x: e.clientX, y: e.clientY, track: t, index: i });
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
                { icon: "play", label: "Играть", onClick: () => playContext(tracks, menu.index) },
                {
                  icon: "heart",
                  label: likedIds.has(menu.track.id) ? "Убрать из любимого" : "В любимое",
                  onClick: () => toggle(menu.track),
                },
                "-",
                { icon: "list-music", label: "В плейлист…", onClick: () => openPlaylistPick(menu.track) },
                { icon: "download", label: "Скачать", onClick: () => void download(menu.track) },
              ]
            : []
        }
      />

      {/* Выбор плейлиста для «В плейлист…» */}
      <Dialog open={plPick !== null} title="В какой плейлист?" onClose={() => setPlPick(null)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 300, maxHeight: 320, overflowY: "auto" }}>
          {playlists === null ? (
            <span style={{ fontFamily: "var(--font-ui)", color: "var(--text-3)", padding: "var(--sp-2)" }}>Загрузка…</span>
          ) : playlists.length === 0 ? (
            <span style={{ fontFamily: "var(--font-ui)", color: "var(--text-3)", padding: "var(--sp-2)" }}>
              Плейлистов пока нет — создаются в приложении для Windows.
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
