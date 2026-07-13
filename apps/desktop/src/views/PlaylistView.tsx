import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, Icon, IconButton, Menu, SearchInput, TrackRow, Tooltip } from "@muza/ui";
import type { MuzaApi, PlaylistDetail, Track } from "@muza/api-client";
import { localList, localResolve } from "../lib/localFiles";
import { withSnapshot } from "../lib/offlineSnapshot";
import { fmtTime } from "../lib/format";
import { startTrackDrag } from "../lib/dnd";
import { exportCachedTrack, maybeAltFileDrag } from "../lib/dragOut";
import { CollabDialog } from "../shell/CollabDialog";

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
}: {
  api: MuzaApi;
  playlistId: string;
  /** id текущего пользователя (Stage 7: «(ты)» и выход из совместного). */
  userId: string;
  likes: string[];
  currentId: string;
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
}) {
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
      setError(e instanceof Error ? e.message : "Не удалось загрузить плейлист");
    }
  }, [api, playlistId]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  const rename = async () => {
    const name = renameValue.trim();
    if (!name || !detail) return;
    await api.renamePlaylist(playlistId, name).catch(() => onNotify("Не удалось переименовать", "x"));
    setRenameOpen(false);
    await load();
    onChanged();
  };

  const remove = async () => {
    await api.deletePlaylist(playlistId).catch(() => onNotify("Не удалось удалить", "x"));
    setDeleteOpen(false);
    onChanged();
    onDeleted();
  };

  const removeTrack = async (trackId: string) => {
    await api.removePlaylistTrack(playlistId, trackId).catch(() => onNotify("Не удалось убрать трек", "x"));
    onNotify("Убрано из плейлиста", "list-x");
    await load();
    onChanged();
  };

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
          }}
        >
          <Icon name="list-music" size={26} color="var(--accent-text)" />
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
                  `${detail.tracks.length} тр.`,
                  detail.isOwner
                    ? detail.collaborators.length > 0
                      ? `совместный · ${detail.collaborators.length + 1} уч.`
                      : null
                    : `совместный · от ${detail.ownerUsername}`,
                  offline ? "оффлайн-копия" : "синхронизируется",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "загрузка"}
          </div>
        </div>
        <Tooltip label="Совместный доступ">
          <IconButton icon="users" size="sm" label="Совместный доступ" onClick={() => setCollabOpen(true)} />
        </Tooltip>
        <Tooltip label="Поделиться">
          <IconButton
            icon="share-2"
            size="sm"
            label="Поделиться"
            onClick={() => {
              if (detail) onShare(detail);
            }}
          />
        </Tooltip>
        <IconButton
          icon="download"
          size="sm"
          label="Сохранить оффлайн"
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
              label="Переименовать"
              onClick={() => {
                setRenameValue(detail?.name ?? "");
                setRenameOpen(true);
              }}
            />
            <IconButton icon="trash-2" size="sm" label="Удалить плейлист" onClick={() => setDeleteOpen(true)} />
          </>
        ) : null}
      </div>

      {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-body)" }}>{error}</div> : null}

      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
        {(detail?.tracks ?? []).map((t, i) => {
          // локальный трек с другого устройства: файла здесь нет — серый
          const missingLocal = t.localHash !== null && !localHashes.has(t.localHash) && t.sources.every((s) => s === "local");
          // Stage 7: в совместных плейлистах видно, кто добавил трек
          const isShared = detail ? !detail.isOwner || detail.collaborators.length > 0 : false;
          const adder = isShared ? detail?.addedBy[t.id] : undefined;
          const artistLine = [
            t.artist,
            missingLocal ? "локальный, нет на этом устройстве" : null,
            adder ? `добавил ${adder}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          // локальный трек: Alt+drag тащит сам файл с устройства, каталожный — экспорт из кэша
          const localOnly = t.localHash !== null && t.sources.every((s) => s === "local");
          return (
            // draggable: из плейлиста можно унести в другой плейлист сайдбара; Alt+drag — файл (T18)
            <div
              key={t.id}
              draggable={!missingLocal}
              onDragStart={(e) => {
                if (
                  maybeAltFileDrag(
                    e,
                    localOnly
                      ? async () => {
                          const path = await localResolve(t.localHash ?? "");
                          if (!path) throw new Error("Файла нет на этом устройстве");
                          return path;
                        }
                      : () => exportCachedTrack(t.id, t.artist, t.title),
                    (m) => onNotify(m, "x"),
                  )
                )
                  return;
                startTrackDrag(e, t.id, t.title, t.artist);
              }}
              style={missingLocal ? { opacity: 0.45 } : undefined}
            >
              <TrackRow
                index={i + 1}
                cover={rowShow?.cover === false ? undefined : (t.coverUrl ?? undefined)}
                title={t.title}
                artist={artistLine}
                duration={fmtTime(t.durationSec)}
                showDuration={rowShow?.duration !== false}
                liked={likes.includes(t.id)}
                active={currentId === t.id}
                playing={currentId === t.id && playing}
                onPlay={() => {
                  if (missingLocal) {
                    onNotify("Локальный трек: файла нет на этом устройстве", "x");
                    return;
                  }
                  onPlayCatalog(detail?.tracks ?? [], t.id);
                }}
                onRowDoubleClick={onQueueCatalog && !missingLocal ? () => onQueueCatalog(t) : undefined}
                onLike={() => onLike(t.id)}
                onMore={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setMenu({
                    open: true,
                    x: Math.min(e.clientX, window.innerWidth - 250),
                    y: Math.min(e.clientY, window.innerHeight - 160),
                    track: t,
                  });
                }}
              />
            </div>
          );
        })}
        {detail && detail.tracks.length === 0 ? (
          <div style={{ padding: "var(--sp-7) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
            Пусто. Добавляй треки из поиска: «⋯ → В плейлист».
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
            label: "Версии и источники",
            onClick: () => {
              if (menu.track) onVersions(menu.track);
            },
          },
          "-",
          {
            icon: "list-x",
            label: "Убрать из плейлиста",
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
        title="Переименовать плейлист"
        onClose={() => setRenameOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="check" onClick={() => void rename()}>
              Сохранить
            </Button>
          </>
        }
      >
        <SearchInput value={renameValue} onChange={setRenameValue} placeholder="Название" icon="list-music" autoFocus />
      </Dialog>

      <Dialog
        open={deleteOpen}
        title="Удалить плейлист?"
        onClose={() => setDeleteOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="trash-2" onClick={() => void remove()}>
              Удалить
            </Button>
          </>
        }
      >
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          «{detail?.name}» исчезнет со всех устройств. Треки останутся в каталоге.
        </div>
      </Dialog>
    </div>
  );
}
