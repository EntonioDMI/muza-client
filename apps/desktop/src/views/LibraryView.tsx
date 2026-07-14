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
import { useT } from "../i18n";

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
  const { t } = useT();
  const chips = localAvailable()
    ? [
        { key: "playlists", label: t("views.library.chips.playlists") },
        { key: "local", label: t("views.library.chips.local") },
        { key: "albums", label: t("views.library.chips.albums") },
        { key: "artists", label: t("views.library.chips.artists") },
      ]
    : [
        { key: "playlists", label: t("views.library.chips.playlists") },
        { key: "albums", label: t("views.library.chips.albums") },
        { key: "artists", label: t("views.library.chips.artists") },
      ];
  const [chip, setChip] = useState("playlists");
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
    if (chip === "local") void reloadLocals();
  }, [chip]);

  const addLocal = async (kind: "files" | "folder") => {
    if (scanning) return;
    setScanning(true);
    try {
      const scanned = await localPickAndScan(kind);
      if (scanned === null) return; // передумал
      if (scanned.length === 0) {
        onNotify(t("views.library.noAudioFilesFound"), "x");
        return;
      }
      // серверная сессия: регистрируем теги+хэш — треки попадают в общую
      // библиотеку (плейлисты/лайки); файл никуда не загружается
      if (canSearch) await registerLocalTracks(api, scanned);
      onNotify(t("views.library.filesAdded", { count: scanned.length }), "hard-drive");
      await reloadLocals();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("views.library.addFilesFailed"), "x");
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
          {t("views.library.title")}
        </h1>
        {canSearch ? (
          <>
            <Button variant="secondary" icon="link" onClick={onAddLink}>
              {t("views.library.addLink")}
            </Button>
            <Button variant="secondary" icon="import" onClick={onImport}>
              {t("views.library.importPlaylist")}
            </Button>
            <Button variant="secondary" icon="users" onClick={onJoinCode}>
              {t("views.library.byCode")}
            </Button>
          </>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <ChipGroup items={chips} value={chip} onChange={setChip} />
      </div>

      {chip === "artists" ? (
        <div style={{ padding: "var(--sp-6) 0", color: "var(--text-2)" }}>
          {t("views.library.artistsPlaceholder")}
        </div>
      ) : chip === "local" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", paddingBottom: "var(--sp-6)" }}>
          <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
            <Button variant="secondary" icon="file-music" disabled={scanning} onClick={() => void addLocal("files")}>
              {scanning ? t("views.library.scanning") : t("views.library.addFiles")}
            </Button>
            <Button variant="secondary" icon="folder-open" disabled={scanning} onClick={() => void addLocal("folder")}>
              {t("views.library.addFolder")}
            </Button>
          </div>
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}>
            {canSearch ? t("views.library.localFilesHintSynced") : t("views.library.localFilesHintLocal")}
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
                        if (!path) throw new Error(t("views.library.fileNotOnDevice"));
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
                  artist={e.available ? e.artist : t("views.library.artistFileMissing", { artist: e.artist })}
                  duration={fmtTime(e.duration_sec)}
                  active={currentId === (serverIds[e.hash] ?? `local:${e.hash}`)}
                  playing={currentId === (serverIds[e.hash] ?? `local:${e.hash}`) && playing}
                  onPlay={() => {
                    if (!e.available) {
                      onNotify(t("views.library.fileNotOnDevice"), "x");
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
                {t("views.library.localFilesEmpty")}
              </div>
            ) : null}
          </div>
        </div>
      ) : chip === "playlists" && canSearch ? (
        <div style={grid}>
          {srvPlaylists.map((p) => (
            <Tile
              key={p.id}
              // T47b: иконка-обложка плейлиста (манифест @muza/core), фолбэк — прежняя демо-обложка
              cover={playlistIconSrc(p.icon) ?? NEW_PLAYLIST_COVER}
              title={p.name}
              subtitle={t("views.library.playlistSubtitle", { count: p.trackCount })}
              width="auto"
              onClick={() => onOpenPlaylist(p.id)}
              onPlay={() => onOpenPlaylist(p.id)}
              onMenu={onPlaylistMenu ? (e: React.MouseEvent) => onPlaylistMenu({ id: p.id, name: p.name }, e) : undefined}
            />
          ))}
          {srvPlaylists.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "var(--sp-6) 0", color: "var(--text-2)", lineHeight: 1.6 }}>
              {t("views.library.playlistsEmpty")}
            </div>
          ) : null}
        </div>
      ) : (
        <div style={grid}>
          {(chip === "albums" ? RELEASES : PLAYLISTS).map((p) => (
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
                  label: t("menu.addToPlaylist"),
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
            label: t("views.library.removeFromMuza"),
            onClick: () => {
              const e = menu.entry;
              if (!e) return;
              void localForget(e.hash).then(() => {
                onNotify(t("views.library.removedFromLocal"), "trash-2");
                void reloadLocals();
              });
            },
          },
        ]}
      />
    </div>
  );
}
