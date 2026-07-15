import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, Icon, IconButton, Menu, SearchInput, TrackRow, Tooltip } from "@muza/ui";
import type { MuzaApi, PlaylistDetail, Track } from "@muza/api-client";
import { localList, localResolve } from "../lib/localFiles";
import { withSnapshot } from "../lib/offlineSnapshot";
import { fmtTime } from "../lib/format";
import { startTrackDrag } from "../lib/dnd";
import { exportCachedTrack, maybeAltFileDrag } from "../lib/dragOut";
import { playlistIconSrc } from "../lib/playlistIcon";
import { CollabDialog } from "../shell/CollabDialog";
import { useT } from "../i18n";

/** Страница серверного плейлиста (Stage 2, слайс 4): треки по позициям,
 *  переименование, удаление, убрать трек. Stage 3: клик — играет,
 *  очередь = плейлист. Stage 7: совместный доступ по инвайт-коду. */
export function PlaylistView({
  api,
  playlistId,
  userId,
  likes,
  currentId,
  playing,
  onPlayCatalog,
  onQueueCatalog,
  rowShow,
  onLike,
  onNotify,
  onVersions,
  onShare,
  onSaveOffline,
  onChanged,
  onDeleted,
  onChangeIcon,
}: {
  api: MuzaApi;
  playlistId: string;
  /** id текущего пользователя (Stage 7: «(ты)» и выход из совместного). */
  userId: string;
  likes: string[];
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  /** Играть трек в контексте плейлиста (Stage 3, движок). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** Дабл-клик = «в очередь» (настройка); нет — dblclick играет. */
  onQueueCatalog?: (t: Track) => void;
  /** Строка трека (настройка «Строка трека»): что показывать. */
  rowShow?: { cover: boolean; duration: boolean };
  onLike: (id: string) => void;
  onNotify: (text: string, icon?: string) => void;
  /** Открыть «Версии и источники» трека (Stage 4). */
  onVersions: (t: Track) => void;
  /** Шеринг-карточка плейлиста (Stage 7). */
  onShare: (detail: PlaylistDetail) => void;
  /** «Сохранить оффлайн» весь плейлист (Stage 4): пины + фоновая догрузка. */
  onSaveOffline: (tracks: Track[]) => void;
  /** Состав/имя изменились — сайдбару пора перечитать список. */
  onChanged: () => void;
  onDeleted: () => void;
  /** ПКМ на треке → «Сменить иконку плейлиста» (T47b): открывает пикер
   *  App-уровня для ТЕКУЩЕГО плейлиста (не трека). */
  onChangeIcon: () => void;
}) {
  const { t } = useT();
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stage 4: хэши локальных файлов, живых на ЭТОМ устройстве (смешанные
  // плейлисты: чужой локальный трек — серый, «нет на устройстве»)
  const [localHashes, setLocalHashes] = useState<Set<string>>(new Set());
  useEffect(() => {
    localList()
      .then((entries) => setLocalHashes(new Set(entries.filter((e) => e.available).map((e) => e.hash))))
      .catch(() => undefined);
  }, []);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Stage 7: диалог «Совместный доступ» (код, участники, выход)
  const [collabOpen, setCollabOpen] = useState(false);
  const [menu, setMenu] = useState<{ open: boolean; x: number; y: number; track: Track | null }>({
    open: false,
    x: 0,
    y: 0,
    track: null,
  });

  // Stage 4: сервер лёг — читаем последний снапшот (закреплённое играет из кэша)
  const [offline, setOffline] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data, offline: fromSnapshot } = await withSnapshot(`playlist:${playlistId}`, () =>
        api.getPlaylist(playlistId),
      );
      setDetail(data);
      setOffline(fromSnapshot);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("views.playlist.loadFailed"));
    }
  }, [api, playlistId, t]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  const rename = async () => {
    const name = renameValue.trim();
    if (!name || !detail) return;
    await api.renamePlaylist(playlistId, name).catch(() => onNotify(t("views.playlist.renameFailed"), "x"));
    setRenameOpen(false);
    await load();
    onChanged();
  };

  const remove = async () => {
    await api.deletePlaylist(playlistId).catch(() => onNotify(t("views.playlist.deleteFailed"), "x"));
    setDeleteOpen(false);
    onChanged();
    onDeleted();
  };

  const removeTrack = async (trackId: string) => {
    await api.removePlaylistTrack(playlistId, trackId).catch(() => onNotify(t("views.playlist.removeTrackFailed"), "x"));
    onNotify(t("views.playlist.removedFromPlaylist"), "list-x");
    await load();
    onChanged();
  };

  // T47b: иконка-обложка плейлиста в шапке — валидный icon манифеста @muza/core,
  // иначе прежний фолбэк "list-music". Смену иконки может запускать только
  // владелец живого (не оффлайн-снапшот) плейлиста — как переименование/удаление выше.
  const iconSrc = playlistIconSrc(detail?.icon);
  const canChangeIcon = detail !== null && detail.isOwner && !offline;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: "var(--r-md)",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            overflow: "hidden",
          }}
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" width={56} height={56} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Icon name="list-music" size={26} color="var(--accent-text)" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--fs-h1)",
              fontWeight: 700,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {detail?.name ?? "…"}
          </h1>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            {detail
              ? [
                  t("views.playlist.trackCount", { count: detail.tracks.length }),
                  detail.isOwner
                    ? detail.collaborators.length > 0
                      ? t("views.playlist.sharedCount", { count: detail.collaborators.length + 1 })
                      : null
                    : t("views.playlist.sharedFrom", { owner: detail.ownerUsername }),
                  offline ? t("views.playlist.offlineCopy") : t("views.playlist.syncing"),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("views.playlist.loadingLabel")}
          </div>
        </div>
        <Tooltip label={t("views.playlist.collabAccess")}>
          <IconButton icon="users" size="sm" label={t("views.playlist.collabAccess")} onClick={() => setCollabOpen(true)} />
        </Tooltip>
        <Tooltip label={t("views.playlist.share")}>
          <IconButton
            icon="share-2"
            size="sm"
            label={t("views.playlist.share")}
            onClick={() => {
              if (detail) onShare(detail);
            }}
          />
        </Tooltip>
        <IconButton
          icon="download"
          size="sm"
          label={t("menu.catalog.saveOffline")}
          onClick={() => {
            if (detail) onSaveOffline(detail.tracks);
          }}
        />
        {/* Райдер T16: при ошибке загрузки (detail=null, error) плейлиста может
            уже не существовать — владельческие кнопки скрываем, иначе они бьют
            по мёртвому id. Пока грузится (error=null) — ведём себя как раньше.
            Хвост T17-18: тот же мёртвый id приходит и через снапшот — открытый
            по истории удалённый плейлист рисуется из оффлайн-копии (detail есть,
            offline=true), а мутации (переименовать/удалить) оффлайн всё равно не
            буферизуются, — поэтому в оффлайне владельческие кнопки тоже прячем. */}
        {(detail ? detail.isOwner && !offline : error === null) ? (
          <>
            <IconButton
              icon="pencil"
              size="sm"
              label={t("menu.playlist.rename")}
              onClick={() => {
                setRenameValue(detail?.name ?? "");
                setRenameOpen(true);
              }}
            />
            <IconButton icon="trash-2" size="sm" label={t("menu.playlist.delete")} onClick={() => setDeleteOpen(true)} />
          </>
        ) : null}
      </div>

      {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-body)" }}>{error}</div> : null}

      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
        {(detail?.tracks ?? []).map((tr, i) => {
          // локальный трек с другого устройства: файла здесь нет — серый
          const missingLocal = tr.localHash !== null && !localHashes.has(tr.localHash) && tr.sources.every((s) => s === "local");
          // Stage 7: в совместных плейлистах видно, кто добавил трек
          const isShared = detail ? !detail.isOwner || detail.collaborators.length > 0 : false;
          const adder = isShared ? detail?.addedBy[tr.id] : undefined;
          const artistLine = [
            tr.artist,
            missingLocal ? t("views.playlist.localMissingSuffix") : null,
            adder ? t("views.playlist.addedBy", { name: adder }) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          // локальный трек: Alt+drag тащит сам файл с устройства, каталожный — экспорт из кэша
          const localOnly = tr.localHash !== null && tr.sources.every((s) => s === "local");
          return (
            // draggable: из плейлиста можно унести в другой плейлист сайдбара; Alt+drag — файл (T18)
            <div
              key={tr.id}
              draggable={!missingLocal}
              onDragStart={(e) => {
                if (
                  maybeAltFileDrag(
                    e,
                    localOnly
                      ? async () => {
                          const path = await localResolve(tr.localHash ?? "");
                          if (!path) throw new Error(t("views.playlist.fileNotOnDevice"));
                          return path;
                        }
                      : () => exportCachedTrack(tr.id, tr.artist, tr.title),
                    (m) => onNotify(m, "x"),
                  )
                )
                  return;
                startTrackDrag(e, tr.id, tr.title, tr.artist);
              }}
              style={missingLocal ? { opacity: 0.45 } : undefined}
            >
              <TrackRow
                index={i + 1}
                cover={tr.coverUrl}
                showCover={rowShow?.cover !== false}
                title={tr.title}
                artist={artistLine}
                duration={fmtTime(tr.durationSec)}
                showDuration={rowShow?.duration !== false}
                liked={likes.includes(tr.id)}
                active={currentId === tr.id}
                playing={currentId === tr.id && playing}
                onPlay={() => {
                  if (missingLocal) {
                    onNotify(t("views.playlist.localTrackNotOnDevice"), "x");
                    return;
                  }
                  onPlayCatalog(detail?.tracks ?? [], tr.id);
                }}
                onRowDoubleClick={onQueueCatalog && !missingLocal ? () => onQueueCatalog(tr) : undefined}
                onLike={() => onLike(tr.id)}
                onMore={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setMenu({
                    open: true,
                    x: Math.min(e.clientX, window.innerWidth - 250),
                    y: Math.min(e.clientY, window.innerHeight - 160),
                    track: tr,
                  });
                }}
              />
            </div>
          );
        })}
        {detail && detail.tracks.length === 0 ? (
          <div style={{ padding: "var(--sp-7) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
            {t("views.playlist.empty")}
          </div>
        ) : null}
      </div>

      <Menu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu((m) => ({ ...m, open: false }))}
        items={[
          {
            icon: "git-branch",
            label: t("menu.catalog.versions"),
            onClick: () => {
              if (menu.track) onVersions(menu.track);
            },
          },
          // T47b: ПКМ на треке ВНУТРИ плейлиста — тот же пикер, что и ПКМ на
          // самом плейлисте в сайдбаре/медиатеке; меняет иконку плейлиста,
          // не трека. Только владелец живого плейлиста (как выше в шапке).
          ...(canChangeIcon
            ? ([{ icon: "image", label: t("views.playlist.changePlaylistIcon"), onClick: () => onChangeIcon() }] as const)
            : []),
          "-",
          {
            icon: "list-x",
            label: t("views.playlist.removeFromPlaylist"),
            onClick: () => {
              if (menu.track) void removeTrack(menu.track.id);
            },
          },
        ]}
      />

      <CollabDialog
        api={api}
        open={collabOpen}
        playlistId={playlistId}
        detail={detail}
        myUserId={userId}
        onClose={() => setCollabOpen(false)}
        onNotify={onNotify}
        onChanged={() => {
          void load();
          onChanged();
        }}
        onLeft={() => {
          setCollabOpen(false);
          onChanged();
          onDeleted(); // страница закрывается, как при удалении
        }}
      />

      <Dialog
        open={renameOpen}
        title={t("app.renamePlaylistDialog.title")}
        onClose={() => setRenameOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="check" onClick={() => void rename()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <SearchInput value={renameValue} onChange={setRenameValue} placeholder={t("common.namePlaceholder")} icon="list-music" autoFocus />
      </Dialog>

      <Dialog
        open={deleteOpen}
        title={t("app.deletePlaylistDialog.title")}
        onClose={() => setDeleteOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="trash-2" onClick={() => void remove()}>
              {t("app.deletePlaylistDialog.confirm")}
            </Button>
          </>
        }
      >
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          {t("app.deletePlaylistDialog.bodyServer", { name: detail?.name ?? "" })}
        </div>
      </Dialog>
    </div>
  );
}
