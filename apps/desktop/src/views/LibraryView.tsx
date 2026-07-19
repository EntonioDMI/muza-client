import { useEffect, useState } from "react";
import { Button, ChipGroup, EmptyState, Icon, Menu, Tile, TrackRow } from "@muza/ui";
import type { MuzaApi, PlaylistMeta, Track } from "@muza/api-client";
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
import { tileL10n, trackRowL10n } from "../lib/dsLabels";
import { gridInsertionIndex } from "../lib/dragEngine";
import { useLocalReorder } from "../lib/useLocalReorder";
import { useDrag, useDropZone } from "../shell/DragLayer";
import { maybeAltFileDrag } from "../lib/dragOut";
import { playlistIconSrc } from "@muza/core";
import { useT } from "../i18n";

/** «Любимое» — закреплённая ПЕРВАЯ плитка библиотеки (Spotify-паттерн, выбор
 *  владельца 2026-07-16): не пункт сайдбара, а особый плейлист. Вместо обложки
 *  — акцентный градиент с сердцем: выделяется среди обычных плиток без ломки
 *  сетки. Геометрия и текстовый блок повторяют Tile ДС. */
function FavoritesTile({ count, onOpen }: { count: number; onOpen: () => void }) {
  const { t } = useT();
  const [lit, setLit] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("views.favorites.title")}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => setLit(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onClick={onOpen}
      style={{
        padding: "var(--pad-tile)",
        borderRadius: "var(--r-md)",
        background: lit ? "var(--surface-3)" : "var(--surface-2)",
        cursor: "pointer",
        transition: "background var(--dur-base) var(--ease-out)",
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "1",
          marginBottom: "var(--sp-3)",
          borderRadius: "var(--r-sm)",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          // Градиент логотипа Музы (glyph.svg: #F76967 → #3B82F6, сверху вниз) —
          // «Любимое» носит фирменный цвет, а не общий акцент.
          background: "linear-gradient(160deg, #F76967 0%, #3B82F6 100%)",
        }}
      >
        {/* Крупное сердце — почти во всю обложку (жалоба 2026-07-16: сделать
            больше). vw-единица тянет его за размером плитки в текучей сетке. */}
        <Icon name="heart" size={96} color="#fff" filled style={{ width: "58%", height: "58%" }} />
      </div>
      <div
        style={{
          fontSize: "var(--fs-body)",
          fontWeight: "var(--fw-semibold)",
          color: "var(--text-1)",
          lineHeight: "var(--lh-ui)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {t("views.favorites.title")}
      </div>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2 }}>
        {t("views.library.playlistSubtitle", { count })}
      </div>
    </div>
  );
}

/** Плитка плейлиста: зона приёма трека и локального реордера. Отдельный
 *  компонент, потому что useDropZone — хук, а звать его внутри .map() нельзя.
 *  Реордер тянется ТОЛЬКО за ручку-⠿ (grip) — по самой плитке остаётся обычный
 *  клик «открыть», без мисс-кликов (T-drag, 2026-07-16). Тащится САМА плитка
 *  (useLocalReorder в LibraryView, соседи раздвигаются); зона DragLayer
 *  принимает только треки — плейлисты между областями не переносятся. */
function PlaylistDropTile({
  playlist,
  subtitle,
  onOpen,
  onMenu,
  onDropTrack,
  grip,
  tileRef,
  shift,
  dragged = false,
  settling = false,
  dimmed = false,
}: {
  playlist: PlaylistMeta;
  subtitle: string;
  onOpen: () => void;
  onMenu?: (e: React.MouseEvent) => void;
  onDropTrack?: (playlistId: string, trackId: string) => void;
  /** Реордер (useLocalReorder): пропсы ручки-⠿; нет — плитка без ручки. */
  grip?: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  tileRef?: (el: HTMLElement | null) => void;
  /** Transform плитки во время реордера (сама или сосед); null — покой. */
  shift?: { x: number; y: number } | null;
  /** Тащат ИМЕННО эту плитку: едет за курсором, без transition, поверх соседей. */
  dragged?: boolean;
  /** Плитку отпустили — она доезжает до слота, transition нужен и ей. */
  settling?: boolean;
  /** 2026-07-17: подписка, скрытая владельцем, — гаснет (open перехвачен выше). */
  dimmed?: boolean;
}) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  const cover = playlist.iconCoverUrl ?? playlistIconSrc(playlist.icon);
  // Префикс места в id зоны: тот же плейлист — цель и в сайдбаре, и здесь;
  // плоская Map зон в DragLayer одинаковые id затёрла бы.
  const { over: litTarget, props } = useDropZone(
    onDropTrack ? `library-playlist:${playlist.id}` : null,
    (p) => onDropTrack?.(playlist.id, p.id),
  );
  return (
    <div
      {...props}
      ref={tileRef}
      aria-disabled={dimmed || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        borderRadius: "var(--r-md)",
        opacity: dimmed ? 0.45 : undefined,
        outline: litTarget ? "var(--focus-ring)" : undefined,
        outlineOffset: 2,
        // во время реордера сосед мягко съезжает на новое место; тащимая
        // плитка липнет к курсору без сглаживания, но при ПОСАДКЕ transition
        // получает и она — доезжает до слота, а не телепортируется
        transition: shift && (!dragged || settling) ? "transform 160ms var(--ease-out)" : "outline-color var(--dur-fast) var(--ease-out)",
        transform: shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined,
        zIndex: dragged ? 2 : undefined,
      }}
    >
      <Tile
        {...tileL10n(t)}
        // T47b: иконка-обложка плейлиста (манифест @muza/core); T47c: track-
        // иконка — готовой ссылкой iconCoverUrl; битая/чужая — null, и Tile
        // рисует плейсхолдер (раньше фолбэком была демо-обложка)
        cover={cover}
        title={playlist.name}
        subtitle={subtitle}
        width="auto"
        onClick={onOpen}
        onPlay={onOpen}
        onMenu={onMenu}
      />
      {grip ? (
        // Справа СНИЗУ карточки (уровень подписи), без плашки-фона и видима
        // ВСЕГДА (жалоба 2026-07-16: сверху с шариком — неудобно и прячется).
        // Правый низ ОБЛОЖКИ занят play-пилюлей Tile — сюда она не достаёт.
        <span
          {...grip}
          role="button"
          aria-label={t("views.library.reorderHandle")}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            display: "grid",
            placeItems: "center",
            width: 30,
            height: 30,
            color: hover || dragged ? "var(--text-1)" : "var(--text-3)",
            cursor: dragged ? "grabbing" : "grab",
            transition: "color var(--dur-fast) var(--ease-out)",
            touchAction: "none",
          }}
        >
          <Icon name="grip-vertical" size={18} />
        </span>
      ) : null}
    </div>
  );
}

/** «Твоя медиатека» (Stage 4): настоящие серверные плейлисты, локальные файлы
 *  (device-bound), добавление по ссылке и импорт. Плейлисты живут на сервере,
 *  поэтому у анонима их нет; «Альбомы» и «Артисты» — честные плейсхолдеры,
 *  пока для них нет серверных данных (раньше «Альбомы» показывали пять
 *  выдуманных релизов из макета Stage 1 ЛЮБОМУ пользователю). */
export function LibraryView({
  api,
  canSearch,
  srvPlaylists,
  currentId,
  playing,
  favoritesCount,
  onOpenFavorites,
  onOpenPlaylist,
  onPlaylistMenu,
  onPlayLocal,
  onAddToPlaylist,
  onAddLink,
  onImport,
  onJoinCode,
  onNotify,
  onDropTrack,
  onReorderPlaylists,
}: {
  api: MuzaApi;
  /** false у анонима: серверная библиотека недоступна (локальные — работают). */
  canSearch: boolean;
  srvPlaylists: PlaylistMeta[];
  /** Трек брошен на плитку плейлиста (undefined = плитки не цели). */
  onDropTrack?: (playlistId: string, trackId: string) => void;
  /** Плейлист перетащили за ручку на другой — переставить перед ним. */
  /** Реордер за ручку-⠿ (локальный, только внутри сетки Библиотеки): id
   *  встаёт на toIndex (splice-индекс) — тот же контракт, что в сайдбаре. */
  onReorderPlaylists?: (draggedId: string, toIndex: number) => void;
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  /** «Любимое» — закреплённая первая плитка вкладки «Плейлисты». */
  favoritesCount: number;
  onOpenFavorites: () => void;
  onOpenPlaylist: (id: string) => void;
  /** T17: ПКМ по плитке серверного плейлиста — то же меню, что в сайдбаре. */
  onPlaylistMenu?: (p: { id: string; name: string }, e: React.MouseEvent) => void;
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
  const { dragSource } = useDrag();
  // Реордер плейлистов — локальный жест СЕТКИ: плитка следует за курсором в
  // пределах сетки, соседи съезжают на будущие места (useLocalReorder +
  // gridInsertionIndex). «Любимое» закреплено первым и в ids не входит;
  // подписки (role follower, 2026-07-17) — тоже: их позиции сервер не хранит.
  const reorder = useLocalReorder({
    ids: srvPlaylists.filter((p) => p.role !== "follower").map((p) => p.id),
    resolveTo: (rects, _from, x, y) => gridInsertionIndex(rects, x, y),
    onCommit: (id, to) => onReorderPlaylists?.(id, to),
  });
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
    // Минимум колонки = настройка «Размер плитки» (--w-tile, зона 4 спеки
    // 19.07): в текучей сетке ручка задаёт нижнюю границу, тянуться дальше
    // колонкам никто не мешает.
    gridTemplateColumns: "repeat(auto-fill, minmax(var(--w-tile, 176px), 1fr))",
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
            {(locals ?? []).map((e, i) => {
              // T18: drag — в плейлист (нужен серверный id), Alt+drag — сам
              // локальный файл на рабочий стол / в проводник.
              const sid = serverIds[e.hash];
              return (
              <div
                key={e.hash}
                draggable={e.available}
                onDragStart={(ev) => {
                  // Только Alt: для остального dragSource гасит draggable. Файл
                  // без серверного id тоже сюда доходит — dragSource ему не
                  // повешен, класть в плейлист нечего; native drag гасим.
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
                  ev.preventDefault();
                }}
                {...(sid && e.available ? dragSource({ id: sid, title: e.title, artist: e.artist, kind: "track" }) : {})}
                style={e.available ? undefined : { opacity: 0.45 }}
              >
                <TrackRow
                  {...trackRowL10n(t)}
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
              );
            })}
            {locals !== null && locals.length === 0 ? (
              <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
                {t("views.library.localFilesEmpty")}
              </div>
            ) : null}
          </div>
        </div>
      ) : chip === "playlists" && canSearch ? (
        <div style={grid}>
          {/* «Любимое» закреплено первым — Spotify-паттерн (2026-07-16) */}
          <FavoritesTile count={favoritesCount} onOpen={onOpenFavorites} />
          {srvPlaylists.map((p) => {
            // Подписка (2026-07-17): чужой read-only плейлист. Скрытый
            // владельцем — гаснет; открыть нельзя, только убрать через меню.
            const followed = p.role === "follower";
            const hidden = followed && p.available === false;
            return (
              <PlaylistDropTile
                key={p.id}
                playlist={p}
                subtitle={
                  hidden
                    ? t("views.library.followedHidden")
                    : followed
                      ? t("views.library.followedSubtitle", { count: p.trackCount, owner: p.ownerUsername })
                      : t("views.library.playlistSubtitle", { count: p.trackCount })
                }
                dimmed={hidden}
                onOpen={() => {
                  if (hidden) {
                    onNotify(t("views.library.followedHiddenToast"), "x");
                    return;
                  }
                  onOpenPlaylist(p.id);
                }}
                onMenu={onPlaylistMenu ? (e: React.MouseEvent) => onPlaylistMenu({ id: p.id, name: p.name }, e) : undefined}
                onDropTrack={followed ? undefined : onDropTrack}
                grip={onReorderPlaylists && !followed ? reorder.grip(p.id) : undefined}
                tileRef={followed ? undefined : reorder.itemRef(p.id)}
                shift={followed ? null : reorder.shiftFor(p.id)}
                dragged={!followed && reorder.draggingId === p.id}
                settling={reorder.settling}
              />
            );
          })}
          {srvPlaylists.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "var(--sp-6) 0", color: "var(--text-2)", lineHeight: 1.6 }}>
              {t("views.library.playlistsEmpty")}
            </div>
          ) : null}
        </div>
      ) : chip === "playlists" ? (
        // Аноним: плейлисты живут на сервере. Раньше здесь показывались три
        // выдуманных плейлиста из макета, которые вдобавок не переживали
        // перезапуск и не умели держать треки.
        <EmptyState icon="user" title={t("views.library.anon.title")} hint={t("views.library.anon.hint")} />
      ) : (
        // «Альбомы»: серверных данных под них пока нет — честный плейсхолдер,
        // как у «Артистов» выше. Раньше здесь лежали пять выдуманных релизов
        // из макета Stage 1, и видел их ЛЮБОЙ пользователь.
        <div style={{ padding: "var(--sp-6) 0", color: "var(--text-2)" }}>
          {t("views.library.albumsPlaceholder")}
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
