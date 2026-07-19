import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Icon, IconButton, Menu, SearchInput, TrackRow, cssZoom } from "@muza/ui";
import type { MuzaApi, PlaylistDetail, Track } from "@muza/api-client";
import { localList, localResolve } from "../lib/localFiles";
import { withSnapshot } from "../lib/offlineSnapshot";
import { fmtTime } from "../lib/format";
import { insertionIndex, moveItem, reorderShift } from "../lib/dragEngine";
import { useCoverArt } from "../lib/coverArt";
import { useDrag, useDropZone } from "../shell/DragLayer";
import { exportCachedTrack, maybeAltFileDrag } from "../lib/dragOut";
import { playlistIconSrc } from "@muza/core";
import { trackRowL10n } from "../lib/dsLabels";
import { CollabDialog } from "../shell/CollabDialog";
import { ShareVisibilityDialog } from "../shell/ShareVisibilityDialog";
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
  onReplaceVersion,
  onShare,
  onSaveOffline,
  onChanged,
  onDeleted,
  onChangeIcon,
  onDropTrack,
}: {
  api: MuzaApi;
  playlistId: string;
  /** Трек из другого вью брошен на эту страницу (undefined = не цель). */
  onDropTrack?: (playlistId: string, trackId: string) => void;
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
  /** «Заменить версию» (2026-07-18): подменить трек другой загрузкой той же
   *  песни. reload — чтобы диалог App-уровня перечитал ЭТУ страницу после
   *  замены (без ремаунта plBump — скролл сохраняется). */
  onReplaceVersion: (t: Track, reload: () => void) => void;
  /** Шеринг-карточка плейлиста (Stage 7). */
  onShare: (detail: PlaylistDetail) => void;
  /** «Сохранить оффлайн» весь плейлист (Stage 4): пины + фоновая догрузка. */
  onSaveOffline: (tracks: Track[]) => void;
  /** Состав/имя изменились — сайдбару пора перечитать список. */
  onChanged: () => void;
  onDeleted: () => void;
  /** ПКМ на треке → «Сменить иконку плейлиста» (T47b): открывает пикер
   *  App-уровня для ТЕКУЩЕГО плейлиста (не трека). T47c: трек клика едет
   *  параметром — пикер предлагает его обложку первой плиткой. */
  onChangeIcon: (fromTrack?: { id: string; coverUrl: string | null }) => void;
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
  // 2026-07-17: диалог «Поделиться плейлистом» (лесенка видимости + код PL_…)
  const [shareVisOpen, setShareVisOpen] = useState(false);
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

  /** Подписка viewer-а (2026-07-17): живая «ссылка» в библиотеке.
   *  Состояние честно перечитывается с сервера (isFollowing в detail). */
  const toggleFollow = async () => {
    if (!detail) return;
    try {
      if (detail.isFollowing) {
        await api.unfollowPlaylist(playlistId);
        onNotify(t("views.search.publicPlaylist.removed"), "list-x");
      } else {
        await api.followPlaylist(playlistId);
        onNotify(t("views.search.publicPlaylist.added"), "list-music");
      }
      await load();
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("views.search.somethingWrong"), "x");
    }
  };

  // T47b: иконка-обложка плейлиста в шапке — валидный icon манифеста @muza/core,
  // иначе прежний фолбэк "list-music". T47c: track-иконка приходит готовой
  // ссылкой iconCoverUrl (сервер разрешил "track:<id>" в cover_url трека).
  // Смену иконки может запускать только владелец живого (не оффлайн-снапшот)
  // плейлиста — как переименование/удаление выше.
  const iconSrc = detail?.iconCoverUrl ?? playlistIconSrc(detail?.icon);
  // Track-иконка — сырой ytimg-URL: срезаем вшитые поля тем же canvas-кропом,
  // что у плеера (не-ytimg и локальные иконки проходят насквозь как есть).
  const cleanIconSrc = useCoverArt(iconSrc ?? null);
  const canChangeIcon = detail !== null && detail.isOwner && !offline;
  // 2026-07-17: чужой открытый плейлист (role viewer) — read-only: слушать и
  // лайкать можно, любые правки состава/имени/порядка — нет (сервер их всё
  // равно отобьёт через own/accessible, но кнопки прячем честно).
  const readOnly = detail?.role === "viewer";

  // ---------- реордер треков перетаскиванием ----------
  // Доступен владельцу И соавтору — ровно как на сервере: PUT
  // /me/playlists/:id/tracks идёт через playlistsAccess.accessible(). Viewer
  // (2026-07-17) читает detail тем же GET, но в accessible не пролезает —
  // реордер ему не рисуем. Оффлайн — снапшот, писать некуда.
  const canReorder = detail !== null && !offline && !readOnly;
  const tracks = detail?.tracks ?? [];
  const { drag, dragSource } = useDrag();
  const rowsRef = useRef(new Map<string, HTMLElement>());
  /** Прямоугольники строк, снятые на pointerdown — ДО подъёма карточки.
   *  Держатся статичными весь перенос НАМЕРЕННО: соседи разъезжаются
   *  transform'ом, а transform входит в getBoundingClientRect. Пересчёт по
   *  живым прямоугольникам раскачивал бы сам себя — сдвинули соседа, индекс
   *  вставки изменился, сдвинули обратно, и строка дрожит под курсором. */
  const rectsRef = useRef<{ top: number; bottom: number }[]>([]);
  const measureRows = () => {
    rectsRef.current = tracks.map((tr) => {
      const r = rowsRef.current.get(tr.id)?.getBoundingClientRect();
      return { top: r?.top ?? 0, bottom: r?.bottom ?? 0 };
    });
  };

  const selfReorder =
    drag !== null && drag.payload.kind === "playlist-track" && drag.payload.fromPlaylistId === playlistId;
  const from = selfReorder ? tracks.findIndex((tr) => tr.id === drag.payload.id) : -1;
  // Экранные пиксели (rects) → зум-единицы transform'а: при prefs.uiScale ≠
  // 100% движок умножает transform на zoom, и без деления соседи разъезжались
  // бы дальше/ближе, чем нужно (тот же класс бага, что попапы, 2026-07-17).
  const reorderZoom = selfReorder ? cssZoom(rowsRef.current.get(drag.payload.id) ?? null) : 1;
  // Считается ПРЯМО В РЕНДЕРЕ из статичных прямоугольников и живого drag.y:
  // чистая функция, лишнего состояния и лишнего ререндера на кадр не нужно.
  const to =
    selfReorder && from >= 0 && rectsRef.current.length === tracks.length
      ? insertionIndex(rectsRef.current, from, drag.y)
      : -1;
  // onDrop зовётся из DragLayer уже ПОСЛЕ setDrag(null), поэтому финальный
  // индекс берём из рефа последнего рендера, а не из drag внутри колбэка.
  const toRef = useRef(-1);
  toRef.current = to;

  const commitReorder = async (movedId: string) => {
    const f = tracks.findIndex((tr) => tr.id === movedId);
    const target = toRef.current;
    if (!detail || f < 0 || target < 0 || target === f) return;
    const prev = detail.tracks;
    const next = moveItem(prev, f, target);
    setDetail({ ...detail, tracks: next }); // оптимистично: список встаёт сразу
    try {
      await api.reorderPlaylist(
        playlistId,
        next.map((tr) => tr.id),
      );
      onChanged();
    } catch (e) {
      setDetail({ ...detail, tracks: prev }); // сервер отказал — возвращаем как было
      onNotify(e instanceof Error ? e.message : t("views.playlist.reorderFailed"), "x");
    }
  };

  const { over: pageOver, props: pageDropProps } = useDropZone(
    canReorder ? `playlist-page:${playlistId}` : null,
    (p) => {
      if (p.kind === "playlist-track" && p.fromPlaylistId === playlistId) {
        void commitReorder(p.id);
        return;
      }
      // Трек из поиска/ленты/медиатеки, брошенный на страницу — добавить сюда.
      // Раньше единственной зоной приёма была строка сайдбара, и бросить трек
      // на открытый плейлист было нельзя.
      onDropTrack?.(playlistId, p.id);
    },
  );

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
          {cleanIconSrc ? (
            <img src={cleanIconSrc} alt="" width={56} height={56} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                  // @Адрес (2026-07-17) — первым: им хвастаются
                  detail.handle ? `@${detail.handle}` : null,
                  t("views.playlist.trackCount", { count: detail.tracks.length }),
                  detail.isOwner
                    ? detail.collaborators.length > 0
                      ? t("views.playlist.sharedCount", { count: detail.collaborators.length + 1 })
                      : null
                    : readOnly
                      ? t("views.playlist.publicFrom", { owner: detail.ownerUsername })
                      : t("views.playlist.sharedFrom", { owner: detail.ownerUsername }),
                  detail.followersCount > 0
                    ? t("views.playlist.followerCount", { count: detail.followersCount })
                    : null,
                  offline ? t("views.playlist.offlineCopy") : t("views.playlist.syncing"),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("views.playlist.loadingLabel")}
          </div>
        </div>
        {/* 2026-07-17: viewer подписывается/отписывается прямо из шапки. */}
        {detail && readOnly && !offline ? (
          <Button
            variant="secondary"
            icon={detail.isFollowing ? "check" : "plus"}
            onClick={() => void toggleFollow()}
          >
            {detail.isFollowing ? t("views.playlist.followRemove") : t("views.playlist.followAdd")}
          </Button>
        ) : null}
        {/* Без внешнего <Tooltip>: IconButton сам тултипит свой label — обёртка
            давала ДВЕ одинаковые подсказки на кнопке (косяк волны 0.1.4).
            Совместный доступ — не для viewer-а (2026-07-17): он не участник. */}
        {!readOnly ? (
          <IconButton icon="users" size="sm" label={t("views.playlist.collabAccess")} onClick={() => setCollabOpen(true)} />
        ) : null}
        {/* 2026-07-17: лесенка видимости — только владелец живого плейлиста */}
        {detail?.isOwner && !offline ? (
          <IconButton
            icon="globe"
            size="sm"
            label={t("views.playlist.publicAccess")}
            onClick={() => setShareVisOpen(true)}
          />
        ) : null}
        <IconButton
          icon="share-2"
          size="sm"
          label={t("views.playlist.share")}
          onClick={() => {
            if (detail) onShare(detail);
          }}
        />
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

      <div
        {...pageDropProps}
        style={{
          display: "flex",
          flexDirection: "column",
          paddingBottom: "var(--sp-6)",
          borderRadius: "var(--r-md)",
          // подсветка только когда несут ЧУЖОЙ трек: при реордере на месте
          // рамка вокруг всего списка — визуальный шум, там говорят соседи
          outline: pageOver && !selfReorder ? "var(--focus-ring)" : undefined,
          outlineOffset: 4,
        }}
      >
        {tracks.map((tr, i) => {
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
          const shift = reorderShift(rectsRef.current, from, to, i) / reorderZoom;
          const dragged = i === from;
          const rowDrag = dragSource({
            id: tr.id,
            title: tr.title,
            artist: tr.artist,
            cover: tr.coverUrl,
            // «playlist-track» + fromPlaylistId — по ним DragLayer-потребители
            // отличают реордер на месте от переноса в ЧУЖОЙ плейлист
            kind: canReorder ? "playlist-track" : "track",
            fromPlaylistId: playlistId,
          });
          return (
            // draggable: из плейлиста можно унести в другой плейлист; Alt+drag — файл (T18)
            <div
              key={tr.id}
              ref={(el) => {
                if (el) rowsRef.current.set(tr.id, el);
                else rowsRef.current.delete(tr.id);
              }}
              draggable={!missingLocal}
              onDragStart={(e) => {
                // Только Alt: для остального dragSource гасит draggable (иначе
                // native drag убил бы pointer-перенос через pointercancel).
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
                e.preventDefault();
              }}
              onPointerDown={(e) => {
                // Мерим строки ЗДЕСЬ: список ещё статичен, трансформов нет.
                if (!missingLocal) measureRows();
                rowDrag.onPointerDown(e);
              }}
              style={{
                ...(missingLocal ? { opacity: 0.45 } : null),
                ...(shift !== 0 || dragged
                  ? {
                      transform: `translateY(${shift}px)`,
                      // тащимая строка гаснет: она уже висит под курсором в
                      // превью, а тут остаётся местом, куда встанет
                      opacity: dragged ? 0.35 : undefined,
                      // соседи едут плавно, сама тащимая — мгновенно за курсором
                      transition: dragged ? "opacity var(--dur-fast) var(--ease-out)" : "transform 160ms var(--ease-out)",
                      position: "relative",
                      zIndex: dragged ? 1 : undefined,
                    }
                  : null),
              }}
            >
              <TrackRow
                {...trackRowL10n(t)}
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
                    // 200: меню подросло на «Заменить версию» (2026-07-18)
                    y: Math.min(e.clientY, window.innerHeight - 200),
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
            ? ([
                {
                  icon: "image",
                  label: t("views.playlist.changePlaylistIcon"),
                  // T47c: обложка кликнутого трека уезжает в пикер первой плиткой
                  onClick: () =>
                    onChangeIcon(menu.track ? { id: menu.track.id, coverUrl: menu.track.coverUrl } : undefined),
                },
              ] as const)
            : []),
          // 2026-07-17: viewer состав не правит — «Убрать из плейлиста» и
          // «Заменить версию» не его
          ...(readOnly
            ? []
            : ([
                "-",
                {
                  icon: "refresh-cw",
                  label: t("menu.catalog.replaceVersion"),
                  onClick: () => {
                    if (menu.track) onReplaceVersion(menu.track, () => void load());
                  },
                },
                {
                  icon: "list-x",
                  label: t("views.playlist.removeFromPlaylist"),
                  onClick: () => {
                    if (menu.track) void removeTrack(menu.track.id);
                  },
                },
              ] as const)),
        ]}
      />

      <ShareVisibilityDialog
        api={api}
        open={shareVisOpen}
        playlistId={playlistId}
        detail={detail}
        onClose={() => setShareVisOpen(false)}
        onNotify={onNotify}
        onChanged={() => {
          void load();
          onChanged();
        }}
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
