import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Icon, IconButton, SearchInput, TrackRow, cssZoom } from "@muza/ui";
import { humanError } from "@muza/api-client";
import type { MuzaApi, PlaylistDetail, Track } from "@muza/api-client";
import { fmtTime, primarySourceLabel } from "../lib/format";
import { cursorInsertionIndex, moveItem, reorderShift } from "../lib/dragEngine";
import { useCoverArt } from "../lib/coverArt";
import { useDrag, useDropZone } from "../shell/DragLayer";
import { useContextMenu } from "../shell/ContextMenu";
import type { MenuAbilities } from "../shell/menuActions";
import { SelectionBar } from "../shell/SelectionBar";
import { useMultiSelect } from "../lib/useMultiSelect";
import type { WarmRow } from "../lib/rowWarm";
import { useAltFileDrag, useLocalFiles, type LocalFileEntry } from "../platform";
import { playlistIconSrc } from "@muza/core";
import { trackRowL10n } from "../lib/dsLabels";
import { CollabDialog } from "../shell/CollabDialog";
import { ShareVisibilityDialog } from "../shell/ShareVisibilityDialog";
import { useT } from "../i18n";

/** Пустой список треков — ОДНА ссылка на всё время жизни модуля. `?? []`
 *  создавал бы новый массив каждым рендером, а он уходит в зависимости
 *  эффекта onTracksChange: площадка ставила бы себе состояние с новым
 *  массивом, оно вызывало бы рендер — и так по кругу. */
const NO_TRACKS: Track[] = [];

/** Страница серверного плейлиста (Stage 2, слайс 4): треки по позициям,
 *  переименование, удаление, убрать трек. Stage 3: клик — играет,
 *  очередь = плейлист. Stage 7: совместный доступ по инвайт-коду.
 *
 *  ⚠️ ПЕРЕЕХАЛО из apps/desktop/src/views/PlaylistView.tsx (волна экранов
 *  веб-паритета, 2026-08-02): страницу плейлиста рисует теперь ОДИН экран в
 *  обеих программах. Приложение не изменилось ни на пиксель — на старом месте
 *  тонкая обёртка (apps/desktop/src/views/PlaylistView.tsx), которая
 *  подставляет всё десктопное.
 *
 *  ЧТО ЗДЕСЬ НЕОБЯЗАТЕЛЬНО И ПОЧЕМУ. Умение проверяется наличием, а не
 *  площадкой (правило розетки, packages/app/src/platform/types.ts):
 *  - `readWithSnapshot` — чтение через оффлайн-копию устройства. Нет —
 *    читаем прямо с сервера, и подписи «оффлайн-копия» не бывает;
 *  - `warmRow` — прогрев строк (см. выше);
 *  - `localFiles` — музыка с диска этого устройства. Форма — подмножество
 *    порта LocalFilesPort; когда вилка приложения начнёт отдавать этот порт
 *    целиком, проп станет не нужен (см. также usePlatform().localFiles);
 *  - `onSaveOffline` — «Сохранить оффлайн». Нет умения — НЕТ КНОПКИ (а не
 *    серая): в браузере файлы на устройстве не живут;
 *  - `onReplaceVersion` — «Заменить версию» в меню трека.
 *  Вынос файла на рабочий стол (Alt+перетаскивание) идёт через розетку
 *  (useAltFileDrag): в браузере жест просто не срабатывает. */
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
  onReplaceVersion,
  onShare,
  onSaveOffline,
  onChanged,
  onDeleted,
  onChangeIcon,
  onDropTrack,
  readWithSnapshot,
  warmRow,
  localFiles,
  onTracksChange,
  style,
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
  rowShow?: { cover: boolean; duration: boolean; album: boolean; source: boolean };
  onLike: (id: string) => void;
  onNotify: (text: string, icon?: string) => void;
  /** «Заменить версию» (2026-07-18): подменить трек другой загрузкой той же
   *  песни. reload — чтобы диалог App-уровня перечитал ЭТУ страницу после
   *  замены (без ремаунта plBump — скролл сохраняется).
   *  Нет — пункта в меню трека нет. */
  onReplaceVersion?: (t: Track, reload: () => void) => void;
  /** Шеринг-карточка плейлиста (Stage 7). */
  onShare: (detail: PlaylistDetail) => void;
  /** «Сохранить оффлайн» весь плейлист (Stage 4): пины + фоновая догрузка.
   *  Нет — кнопки нет (браузер музыку на устройстве не держит). */
  onSaveOffline?: (tracks: Track[]) => void;
  /** Состав/имя изменились — сайдбару пора перечитать список. */
  onChanged: () => void;
  onDeleted: () => void;
  /** ПКМ на треке → «Сменить иконку плейлиста» (T47b): открывает пикер
   *  App-уровня для ТЕКУЩЕГО плейлиста (не трека). T47c: трек клика едет
   *  параметром — пикер предлагает его обложку первой плиткой. */
  onChangeIcon: (fromTrack?: { id: string; coverUrl: string | null }) => void;
  /** Чтение плейлиста через оффлайн-копию устройства: приложение подставляет
   *  своё (последний удачный ответ сервера лежит на устройстве), браузер —
   *  нет, и тогда читаем прямо с сервера. */
  readWithSnapshot?: (
    key: string,
    fetch: () => Promise<PlaylistDetail>,
  ) => Promise<{ data: PlaylistDetail; offline: boolean }>;
  /** Готовит трек заранее — умение приложения: пока курсор над строкой, оно уже
   *  разбирает, откуда возьмётся звук. Пропа нет (браузер) — на обёртку строки
   *  просто ничего не вешается. Форма общая для всех экранов (lib/rowWarm.ts):
   *  раньше она была тут расписана инлайном — одной из пяти копий. */
  warmRow?: WarmRow;
  /** Музыка с диска устройства: что здесь есть и где лежит. Подмножество
   *  порта localFiles розетки — как только вилка приложения начнёт отдавать
   *  порт, проп можно снять (он перекрывает порт, значения одинаковые). */
  localFiles?: {
    list(): Promise<LocalFileEntry[]>;
    resolvePath(hash: string): Promise<string | null>;
  };
  /** Показанные треки сменились (в порядке строк). Нужен площадке, которая
   *  собирает меню по треку, а не по id (веб: лайк принимает Track целиком).
   *  Ссылка должна быть стабильной — иначе эффект зациклится. */
  onTracksChange?: (tracks: Track[]) => void;
  /** Стили корня экрана. Веб гасит ими собственные отступы: его зона контента
   *  уже с полями, иначе поля удвоились бы (тот же проп у общего поиска). */
  style?: React.CSSProperties;
}) {
  const { t, lang } = useT();
  const altFileDrag = useAltFileDrag();
  const portLocalFiles = useLocalFiles();
  const local = localFiles ?? portLocalFiles;
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stage 4: хэши локальных файлов, живых на ЭТОМ устройстве (смешанные
  // плейлисты: чужой локальный трек — серый, «нет на устройстве»)
  const [localHashes, setLocalHashes] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Площадка не знает файлов с диска (браузер) — множество остаётся пустым,
    // и ни один трек не помечается «нет на устройстве»: локальных треков там
    // и не бывает.
    local
      ?.list()
      .then((entries) => setLocalHashes(new Set(entries.filter((e) => e.available).map((e) => e.hash))))
      .catch(() => undefined);
    // Порт/проп на время жизни страницы неизменны — список читаем один раз,
    // как читали до переезда.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Stage 7: диалог «Совместный доступ» (код, участники, выход)
  const [collabOpen, setCollabOpen] = useState(false);
  // 2026-07-17: диалог «Поделиться плейлистом» (лесенка видимости + код PL_…)
  const [shareVisOpen, setShareVisOpen] = useState(false);
  // контекстное меню трека — общий механизм (shell/ContextMenu.tsx, 2026-07-20);
  // вьюшно-локальные действия уезжают в target.ctl замыканиями
  // Умения меню — НЕПОЛНЫЙ набор (MenuAbilities), а не десктопный MenuContext:
  // в браузере вставок в очередь и оффлайна нет, и читать их отсюда нельзя.
  const { openMenu, menuCtxRef } = useContextMenu<MenuAbilities>();

  // Stage 4: сервер лёг — читаем последнюю копию с устройства (закреплённое
  // играет с диска). Площадка так не умеет — просто идём на сервер.
  const [offline, setOffline] = useState(false);
  /** Номер актуальной загрузки страницы. Клик по плейлисту A, сразу по B, ответ
   *  A пришёл вторым — и на экране оказывались имя и треки A под открытым B, а
   *  «убрать трек»/перестановка били уже по B. Ответ с чужим номером не пишет
   *  НИЧЕГО (тот же приём, что seqRef в общем поиске). */
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const fetchDetail = () => api.getPlaylist(playlistId);
      const { data, offline: fromSnapshot } = readWithSnapshot
        ? await readWithSnapshot(`playlist:${playlistId}`, fetchDetail)
        : { data: await fetchDetail(), offline: false };
      if (loadSeq.current !== seq) return;
      setDetail(data);
      setOffline(fromSnapshot);
      setError(null);
    } catch (e) {
      if (loadSeq.current !== seq) return;
      setError(humanError(e, t("views.playlist.loadFailed")));
    }
    // ⚠️ readWithSnapshot обязан быть СТАБИЛЬНОЙ ссылкой (модульная функция
    // или useCallback у вызывателя): новая функция на каждый рендер пересоздаёт
    // load, а тот перезапускает эффект ниже — страница ушла бы в вечную
    // перезагрузку.
  }, [api, playlistId, t, readWithSnapshot]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  // Правило для всех трёх обработчиков ниже (правка 2026-08-02): после
  // проглоченной ошибки НЕЛЬЗЯ делать шаги успешной ветки. Раньше `.catch()`
  // показывал тост об ошибке, а следом безусловно выполнялась успешная часть:
  // тост «Убрано из плейлиста» затирал сообщение об ошибке в том же кадре
  // (тост в приложении один, showToast перезаписывает его), трек оставался на
  // месте, а при удалении плейлиста нас ещё и уводило на Главную — как будто
  // всё получилось. Образец правильного поведения был рядом, в toggleFollow.
  const rename = async () => {
    const name = renameValue.trim();
    if (!name || !detail) return;
    try {
      await api.renamePlaylist(playlistId, name);
    } catch {
      onNotify(t("views.playlist.renameFailed"), "x");
      return;
    }
    setRenameOpen(false);
    await load();
    onChanged();
  };

  const remove = async () => {
    try {
      await api.deletePlaylist(playlistId);
    } catch {
      onNotify(t("views.playlist.deleteFailed"), "x");
      return;
    }
    setDeleteOpen(false);
    onChanged();
    onDeleted();
  };

  const removeTrack = async (trackId: string) => {
    try {
      await api.removePlaylistTrack(playlistId, trackId);
    } catch {
      onNotify(t("views.playlist.removeTrackFailed"), "x");
      return;
    }
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
      onNotify(humanError(e, t("views.search.somethingWrong")), "x");
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
  const tracks = detail?.tracks ?? NO_TRACKS;

  // Площадка, собирающая меню по треку (веб), узнаёт список отсюда.
  useEffect(() => {
    onTracksChange?.(tracks);
  }, [tracks, onTracksChange]);

  // ── множественное выделение (2026-07-20) ──
  // Ctrl/Shift-клик всегда; режим (обычный клик выделяет) — из меню пустого
  // места. Матрица жестов — lib/selection.ts.
  const multi = useMultiSelect(tracks.map((tr) => tr.id));
  const canEditRows = !readOnly && !offline;
  const selectedTracks = () => tracks.filter((tr) => multi.has(tr.id));

  /** Убрать выделенное: по одному (пакетного метода нет; серверный reorder
   *  подмножеством НЕ удаляет — он лишь переписывает позиции перечисленных). */
  const removeSelected = async (ids: string[]) => {
    try {
      for (const id of ids) await api.removePlaylistTrack(playlistId, id);
      onNotify(t("views.playlist.removedFromPlaylist"), "list-x");
    } catch {
      onNotify(t("views.playlist.removeTrackFailed"), "x");
    }
    multi.clear();
    await load();
    onChanged();
  };
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
      ? cursorInsertionIndex(rectsRef.current, from, drag.y)
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
      onNotify(humanError(e, t("views.playlist.reorderFailed")), "x");
    }
  };

  /** «В начало/конец плейлиста» из контекстного меню (2026-07-20): тот же
   *  оптимистичный путь, что commitReorder, только цель — край списка. */
  const moveTrackEdge = async (trackId: string, edge: "start" | "end") => {
    if (!detail) return;
    const f = detail.tracks.findIndex((tr) => tr.id === trackId);
    const target = edge === "start" ? 0 : detail.tracks.length - 1;
    if (f < 0 || f === target) return;
    const prev = detail.tracks;
    const next = moveItem(prev, f, target);
    setDetail({ ...detail, tracks: next });
    try {
      await api.reorderPlaylist(
        playlistId,
        next.map((tr) => tr.id),
      );
      onChanged();
    } catch (e) {
      setDetail({ ...detail, tracks: prev });
      onNotify(humanError(e, t("views.playlist.reorderFailed")), "x");
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

  /** Кнопки панели массовых действий — ровно по умениям площадки (см. рендер
   *  панели ниже). Читается menuCtxRef.current: ссылка стабильна, содержимое
   *  обновляется каждым рендером хозяина умений. */
  const bulk = menuCtxRef.current;
  type SelectionAction = { icon: string; label: string; onClick: () => void; danger?: boolean };
  const selectionActions = ([
    bulk.playNextMany && {
      icon: "list-start",
      label: t("menu.catalog.playNext"),
      onClick: () => menuCtxRef.current.playNextMany?.(selectedTracks()),
    },
    bulk.queueMany && {
      icon: "list-end",
      label: t("menu.catalog.queue"),
      onClick: () => menuCtxRef.current.queueMany?.(selectedTracks()),
    },
    bulk.addManyToPlaylist && {
      icon: "plus",
      label: t("menu.addToPlaylist"),
      onClick: () => menuCtxRef.current.addManyToPlaylist?.(selectedTracks()),
    },
    bulk.likeMany && {
      icon: "heart",
      label: t("menu.catalog.like"),
      onClick: () => menuCtxRef.current.likeMany?.(multi.ids),
    },
    bulk.pinMany && {
      icon: "download",
      label: t("menu.catalog.saveOffline"),
      onClick: () => menuCtxRef.current.pinMany?.(selectedTracks()),
    },
    canEditRows && {
      icon: "list-x",
      label: t("views.playlist.removeFromPlaylist"),
      danger: true,
      onClick: () => void removeSelected(multi.ids),
    },
  ] as (SelectionAction | false | undefined)[]).filter((a): a is SelectionAction => Boolean(a));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-5)",
        padding: "var(--sp-6) var(--sp-6) 0",
        ...style,
      }}
      // ПКМ по пустому месту страницы (2026-07-20): вход в выбор треков.
      // Строки гасят всплытие в openMenu — сюда долетает только пустота.
      onContextMenu={
        tracks.length > 0
          ? (e) =>
              openMenu(e, {
                kind: "playlistBlank",
                ctl: { enterSelect: multi.enterMode, selectAll: multi.selectAll },
              })
          : undefined
      }
    >
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
        {/* «Сохранить оффлайн» — только там, где музыка может лежать на
            устройстве; нет умения — нет кнопки (правило розетки). */}
        {onSaveOffline ? (
          <IconButton
            icon="download"
            size="sm"
            label={t("menu.catalog.saveOffline")}
            onClick={() => {
              if (detail) onSaveOffline(detail.tracks);
            }}
          />
        ) : null}
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
              // два потребителя одного ref: DnD-замеры строк и прогрев
              // (IntersectionObserver). React 19 ref-cleanup: возврат функции
              // означает, что ref(null) на размонтировании НЕ придёт — обе
              // отписки живут в cleanup.
              ref={(el) => {
                if (!el) {
                  rowsRef.current.delete(tr.id);
                  return;
                }
                rowsRef.current.set(tr.id, el);
                const unwarm = localOnly ? undefined : warmRow?.(tr.id).ref?.(el);
                return () => {
                  rowsRef.current.delete(tr.id);
                  unwarm?.();
                };
              }}
              onMouseEnter={localOnly ? undefined : warmRow?.(tr.id).onMouseEnter}
              draggable={!missingLocal}
              onDragStart={(e) => {
                // Только Alt: для остального dragSource гасит draggable (иначе
                // native drag убил бы pointer-перенос через pointercancel).
                // Площадка не умеет выносить файл (браузер) — жеста нет вовсе,
                // и дальше отрабатывает обычный перенос в плейлист.
                if (
                  altFileDrag(
                    e,
                    localOnly
                      ? async () => {
                          // Трек с диска: тащим САМ файл, а не подготовленную
                          // копию. Площадка без файлов с диска до сюда не
                          // доходит — localOnly бывает только там, где они есть.
                          const path = (await local?.resolvePath(tr.localHash ?? "")) ?? null;
                          if (!path) throw new Error(t("views.playlist.fileNotOnDevice"));
                          return path;
                        }
                      : (dragOut) => dragOut.exportTrackFile(tr),
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
              // Выделение перехватывает клик В CAPTURE-фазе: Ctrl/Shift или
              // режим — клик наш (включая play/лайк), иначе строка живёт
              // обычной жизнью (играть). Матрица — lib/selection.ts.
              onClickCapture={(e) => {
                if (multi.onItemClick(tr.id, e)) {
                  e.preventDefault();
                  e.stopPropagation();
                }
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
                      /* 160 мс числом было ТРЕТЬИМ законом одного и того же
                         жеста: соседи в ленте ехали 220 мс пружиной, посадка —
                         200 мс другой пружиной, а здесь — 160 мс кривой.
                         Теперь разъезд соседей везде один (--dur-transit). */
                      transition: dragged
                        ? "opacity var(--dur-state) var(--ease-standard)"
                        : "transform var(--dur-transit) var(--spring-snap, var(--ease-out))",
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
                album={rowShow?.album ? (tr.album ?? undefined) : undefined}
                duration={fmtTime(tr.durationSec)}
                showDuration={rowShow?.duration !== false}
                source={rowShow?.source ? primarySourceLabel(tr.sources, lang) : undefined}
                liked={likes.includes(tr.id)}
                active={currentId === tr.id}
                playing={currentId === tr.id && playing}
                selected={multi.has(tr.id)}
                onPlay={() => {
                  if (missingLocal) {
                    onNotify(t("views.playlist.localTrackNotOnDevice"), "x");
                    return;
                  }
                  onPlayCatalog(detail?.tracks ?? [], tr.id);
                }}
                onRowDoubleClick={onQueueCatalog && !missingLocal && !multi.active ? () => onQueueCatalog(tr) : undefined}
                onLike={() => onLike(tr.id)}
                onMore={(e: React.MouseEvent) => {
                  // ПКМ по выделенному — меню выделения; по невыделенному —
                  // выделение сбрасывается на обычное меню этого трека
                  if (multi.count > 0 && multi.has(tr.id)) {
                    openMenu(e, {
                      kind: "selection",
                      tracks: selectedTracks(),
                      count: multi.count,
                      place: "list",
                      ctl: {
                        remove: canEditRows
                          ? { scope: "playlist", run: () => void removeSelected(multi.ids) }
                          : undefined,
                        clear: multi.clear,
                      },
                    });
                    return;
                  }
                  if (multi.count > 0) multi.clear();
                  openMenu(e, {
                    kind: "track",
                    track: tr,
                    place: "playlist",
                    ctl: {
                      // T47c: обложка кликнутого трека уезжает в пикер первой плиткой
                      changeIcon: () => onChangeIcon({ id: tr.id, coverUrl: tr.coverUrl }),
                      // Нет умения — нет пункта (не серого): см. шапку файла
                      replaceVersion: onReplaceVersion ? () => onReplaceVersion(tr, () => void load()) : undefined,
                      removeTrack: () => void removeTrack(tr.id),
                      moveToStart: () => void moveTrackEdge(tr.id, "start"),
                      moveToEnd: () => void moveTrackEdge(tr.id, "end"),
                      canChangeIcon,
                      canEdit: canEditRows,
                    },
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

      {/* Панель массовых действий: те же действия, что в меню выделения
          (menuCtxRef — живые умения площадки, читаются в обработчиках).
          Пункт есть, только если умение у площадки существует: у приложения
          есть все пять (его панель не изменилась ни на пиксель), у браузера
          нет ни очереди-вставки, ни хранения на устройстве — там останется
          меньше. Правило розетки: нет умения — нет пункта, а не серый. */}
      {multi.count > 0 ? (
        <SelectionBar
          label={t("menu.selection.count", { count: multi.count })}
          clearLabel={t("menu.selection.clear")}
          onClear={multi.clear}
          actions={selectionActions}
        />
      ) : null}

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
