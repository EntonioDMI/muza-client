import { useEffect, useState } from "react";
import { Button, ChipGroup, Menu, Tile, TrackRow } from "@muza/ui";
import type { MuzaApi, PlaylistMeta, Track } from "@muza/api-client";
import { NEW_PLAYLIST_COVER, PLAYLISTS, RELEASES, TRACKS } from "../data/demo";
import {
  loadServerIds,
  localAvailable,
  localForget,
  localList,
  localPickAndScan,
  localResolve,
  registerLocalTracks,
  type LocalEntry,
} from "../lib/localFiles";
import { fmtTime } from "../lib/format";
import { startTrackDrag } from "../lib/dnd";
import { maybeAltFileDrag } from "../lib/dragOut";
import { playlistIconSrc } from "../lib/playlistIcon";

/** «Твоя медиатека» (Stage 4): настоящие серверные плейлисты, локальные файлы
 *  (device-bound), добавление по ссылке и импорт; демо-контент остаётся
 *  у анонима и на вкладке «Альбомы». */
export function LibraryView({
  api,
  canSearch,
  srvPlaylists,
  currentId,
  playing,
  onOpenPlaylist,
  onPlaylistMenu,
  onPlayTrack,
  onPlayLocal,
  onAddToPlaylist,
  onAddLink,
  onImport,
  onJoinCode,
  onNotify,
}: {
  api: MuzaApi;
  /** false у анонима: серверная библиотека недоступна (локальные — работают). */
  canSearch: boolean;
  srvPlaylists: PlaylistMeta[];
  currentId: string;
  playing: boolean;
  onOpenPlaylist: (id: string) => void;
  /** T17: ПКМ по плитке серверного плейлиста — то же меню, что в сайдбаре. */
  onPlaylistMenu?: (p: { id: string; name: string }, e: React.MouseEvent) => void;
  onPlayTrack: (id: string) => void;
  /** Играть локальные файлы (очередь = вкладка «Локальные»). */
  onPlayLocal: (entries: LocalEntry[], hash: string) => void;
  /** «В плейлист» для локального трека с серверным id. */
  onAddToPlaylist: (t: Track) => void;
  /** «Добавить по ссылке» (Stage 4, прямые источники). */
  onAddLink: () => void;
  /** «Импорт плейлиста» (Stage 4, Spotify/YT/Apple). */
  onImport: () => void;
  /** Вход в совместный плейлист по инвайт-коду (Stage 7). */
  onJoinCode: () => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  const chips = localAvailable()
    ? ["Плейлисты", "Локальные", "Альбомы", "Артисты"]
    : ["Плейлисты", "Альбомы", "Артисты"];
  const [chip, setChip] = useState("Плейлисты");
  const [locals, setLocals] = useState<LocalEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [menu, setMenu] = useState<{ open: boolean; x: number; y: number; entry: LocalEntry | null }>({
    open: false,
    x: 0,
    y: 0,
    entry: null,
  });

  const reloadLocals = () => localList().then(setLocals).catch(() => setLocals([]));
  useEffect(() => {
    if (chip === "Локальные") void reloadLocals();
  }, [chip]);

  const addLocal = async (kind: "files" | "folder") => {
    if (scanning) return;
    setScanning(true);
    try {
      const scanned = await localPickAndScan(kind);
      if (scanned === null) return; // передумал
      if (scanned.length === 0) {
        onNotify("Аудиофайлов не нашлось", "x");
        return;
      }
      // серверная сессия: регистрируем теги+хэш — треки попадают в общую
      // библиотеку (плейлисты/лайки); файл никуда не загружается
      if (canSearch) await registerLocalTracks(api, scanned);
      onNotify(`Добавлено: ${scanned.length} файл(ов)`, "hard-drive");
      await reloadLocals();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Не удалось добавить файлы", "x");
    } finally {
      setScanning(false);
    }
  };

  const serverIds = loadServerIds();
  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(176px, 1fr))",
    gap: "var(--sp-4)",
    paddingBottom: "var(--sp-6)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "var(--fs-h1)", fontWeight: 700, color: "var(--text-1)", flex: 1 }}>
          Твоя медиатека
        </h1>
        {canSearch ? (
          <>
            <Button variant="secondary" icon="link" onClick={onAddLink}>
              По ссылке
            </Button>
            <Button variant="secondary" icon="import" onClick={onImport}>
              Импорт плейлиста
            </Button>
            <Button variant="secondary" icon="users" onClick={onJoinCode}>
              По коду
            </Button>
          </>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <ChipGroup items={chips} value={chip} onChange={setChip} />
      </div>

      {chip === "Артисты" ? (
        <div style={{ padding: "var(--sp-6) 0", color: "var(--text-2)" }}>
          Здесь появятся артисты, на которых ты подпишешься.
        </div>
      ) : chip === "Локальные" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", paddingBottom: "var(--sp-6)" }}>
          <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
            <Button variant="secondary" icon="file-music" disabled={scanning} onClick={() => void addLocal("files")}>
              {scanning ? "Сканируем…" : "Добавить файлы"}
            </Button>
            <Button variant="secondary" icon="folder-open" disabled={scanning} onClick={() => void addLocal("folder")}>
              Добавить папку
            </Button>
          </div>
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}>
            Файлы остаются на этом устройстве — на сервер уходят только название и отпечаток
            {canSearch ? " (в плейлистах на других устройствах такие треки будут серыми)" : ""}.
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {(locals ?? []).map((e, i) => (
              // T18 draggable: drag — в плейлист сайдбара (нужен серверный id),
              // Alt+drag — сам локальный файл на рабочий стол / в проводник
              <div
                key={e.hash}
                draggable={e.available}
                onDragStart={(ev) => {
                  if (
                    maybeAltFileDrag(
                      ev,
                      async () => {
                        const path = await localResolve(e.hash);
                        if (!path) throw new Error("Файла нет на этом устройстве");
                        return path;
                      },
                      (m) => onNotify(m, "x"),
                    )
                  )
                    return;
                  const sid = serverIds[e.hash];
                  if (!sid) {
                    ev.preventDefault(); // без серверного id класть в плейлист нечего
                    return;
                  }
                  startTrackDrag(ev, sid, e.title, e.artist);
                }}
                style={e.available ? undefined : { opacity: 0.45 }}
              >
                <TrackRow
                  index={i + 1}
                  title={e.title}
                  artist={e.available ? e.artist : `${e.artist} · файла нет на этом устройстве`}
                  duration={fmtTime(e.duration_sec)}
                  active={currentId === (serverIds[e.hash] ?? `local:${e.hash}`)}
                  playing={currentId === (serverIds[e.hash] ?? `local:${e.hash}`) && playing}
                  onPlay={() => {
                    if (!e.available) {
                      onNotify("Файла нет на этом устройстве", "x");
                      return;
                    }
                    onPlayLocal(locals ?? [], e.hash);
                  }}
                  onMore={(ev: React.MouseEvent) => {
                    ev.stopPropagation();
                    setMenu({
                      open: true,
                      x: Math.min(ev.clientX, window.innerWidth - 250),
                      y: Math.min(ev.clientY, window.innerHeight - 160),
                      entry: e,
                    });
                  }}
                />
              </div>
            ))}
            {locals !== null && locals.length === 0 ? (
              <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
                Пока пусто. Добавь файлы или папку с музыкой — они заиграют вместе с каталожными
                треками, в том числе в одном плейлисте.
              </div>
            ) : null}
          </div>
        </div>
      ) : chip === "Плейлисты" && canSearch ? (
        <div style={grid}>
          {srvPlaylists.map((p) => (
            <Tile
              key={p.id}
              // T47b: иконка-обложка плейлиста (манифест @muza/core), фолбэк — прежняя демо-обложка
              cover={playlistIconSrc(p.icon) ?? NEW_PLAYLIST_COVER}
              title={p.name}
              subtitle={`${p.trackCount} тр. · синхронизируется`}
              width="auto"
              onClick={() => onOpenPlaylist(p.id)}
              onPlay={() => onOpenPlaylist(p.id)}
              onMenu={onPlaylistMenu ? (e: React.MouseEvent) => onPlaylistMenu({ id: p.id, name: p.name }, e) : undefined}
            />
          ))}
          {srvPlaylists.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "var(--sp-6) 0", color: "var(--text-2)", lineHeight: 1.6 }}>
              Плейлистов пока нет. Создай первый кнопкой «+» в сайдбаре, импортируй из
              Spotify/YouTube/Apple Music или добавь треки по ссылке.
            </div>
          ) : null}
        </div>
      ) : (
        <div style={grid}>
          {(chip === "Альбомы" ? RELEASES : PLAYLISTS).map((p) => (
            <Tile key={p.id} cover={p.cover} title={p.name} subtitle={p.meta} width="auto" onPlay={() => onPlayTrack(TRACKS[0].id)} />
          ))}
        </div>
      )}

      {/* Меню локального трека */}
      <Menu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu((m) => ({ ...m, open: false }))}
        items={[
          ...(menu.entry && canSearch && serverIds[menu.entry.hash]
            ? [
                {
                  icon: "plus",
                  label: "В плейлист",
                  onClick: () => {
                    const e = menu.entry;
                    if (!e) return;
                    onAddToPlaylist({
                      id: serverIds[e.hash],
                      artist: e.artist,
                      title: e.title,
                      durationSec: e.duration_sec,
                      coverUrl: null,
                      isCached: false,
                      sources: ["local"],
                      loudness: null,
                      localHash: e.hash,
                    });
                  },
                },
              ]
            : []),
          {
            icon: "trash-2",
            label: "Убрать из Muza (файл останется)",
            onClick: () => {
              const e = menu.entry;
              if (!e) return;
              void localForget(e.hash).then(() => {
                onNotify("Убрано из локальных", "trash-2");
                void reloadLocals();
              });
            },
          },
        ]}
      />
    </div>
  );
}
