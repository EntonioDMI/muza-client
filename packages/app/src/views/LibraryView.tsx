import { useEffect, useState } from "react";
import { Button, ChipGroup, Dialog, EmptyState, Icon, Tile, TrackRow } from "@muza/ui";
import type { Genre, HistoryItem, MuzaApi, PlaylistMeta, Track } from "@muza/api-client";
import { fmtTime } from "../lib/format";
import { tileL10n, trackRowL10n } from "../lib/dsLabels";
import { applyVisibleOrder, gridInsertionIndex } from "../lib/dragEngine";
import { useLocalReorder } from "../lib/useLocalReorder";
import { useDrag, useDropZone } from "../shell/DragLayer";
import { useLayout } from "../shell/LayoutContext";
import { useContextMenu } from "../shell/ContextMenu";
import type { MenuAbilities } from "../shell/menuActions";
import { SelectionBar } from "../shell/SelectionBar";
import { useMultiSelect } from "../lib/useMultiSelect";
import { useAltFileDrag, useLocalFiles, type LocalFileEntry } from "../platform";
import { playlistIconSrc } from "@muza/core";
import { useT } from "../i18n";

/* Вкладка «История» и её пустое состояние берут строки из views.library.* —
 * как остальные подписи экрана. Здесь была пара «новый ключ, а пока его нет —
 * прежний web.library.*»: общий компонент не должен ходить в раздел словаря
 * ОДНОЙ площадки (приложение показывало бы «веб»-строки). Волна 8 завела
 * строки под правильными именами — временная пара снята. */

/** «Любимое» — закреплённая ПЕРВАЯ плитка библиотеки (Spotify-паттерн, выбор
 *  владельца 2026-07-16): не пункт сайдбара, а особый плейлист. Вместо обложки
 *  — акцентный градиент с сердцем: выделяется среди обычных плиток без ломки
 *  сетки. Геометрия и текстовый блок повторяют Tile ДС.
 *
 *  ⚠️ ПОДСВЕТКА — ТЕМ ЖЕ КАНАЛОМ, ЧТО У ПЛИТКИ ДС (13.08.2026). Здесь стоял
 *  свой useState `lit` и свои surface-2/surface-3, и это уже один раз стреляло:
 *  правка 12.08 попала только в «Любимое», и два соседних кафеля в медиатеке
 *  стояли разными весами шрифта (сторож — Tile.test.jsx). Когда покой плитки
 *  стал прозрачным, копия материала выстрелила бы снова — «Любимое» осталось
 *  бы единственной карточкой в безрамочной сетке. Теперь класс .muza-tile и
 *  var(--tile-bg): закон один, живёт в interactions.css, копий нет. */
function FavoritesTile({ count, onOpen }: { count: number; onOpen: () => void }) {
  const { t } = useT();
  return (
    <div
      className="muza-tile"
      role="button"
      tabIndex={0}
      aria-label={t("views.favorites.title")}
      // глотаем ПКМ: своего меню у «Любимого» пока нет, а меню пустого места
      // медиатеки на конкретной плитке выглядело бы враньём (2026-07-20)
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
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
        background: "var(--tile-bg)",
        cursor: "pointer",
        // transition НЕ инлайном: он объявлен на .muza-tile (interactions.css)
        // вместе с transform нажатия — инлайновый перекрыл бы его целиком.
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "1",
          marginBottom: "var(--sp-3)",
          // --r-md, как обложка Tile: у безрамочной плитки силуэт задаёт арт,
          // а «Любимое» обязано быть той же формы, что соседи по сетке.
          borderRadius: "var(--r-md)",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          // Градиент логотипа Музы — «Любимое» носит фирменный цвет, а не
          // общий акцент. Значение живёт в токене (--brand-gradient): тот же
          // градиент рисует плитка в сайдбаре, и вручную они уже разъезжались.
          background: "var(--brand-gradient)",
        }}
      >
        {/* Крупное сердце — почти во всю обложку (жалоба 2026-07-16: сделать
            больше). vw-единица тянет его за размером плитки в текучей сетке. */}
        <Icon name="heart" size={96} color="#fff" filled style={{ width: "58%", height: "58%" }} />
      </div>
      <div
        style={{
          fontSize: "var(--fs-body)",
          /* ⚠️ БЕЗ ЖИРНОГО (12.08, жалоба владельца). Название плитки И ТАК
             выделено — цветом `--text-1` на фоне серых подписей. Вес поверх
             цвета ничего не добавлял: две «сильные» приметы на одном элементе
             читаются не как акцент, а как шум. */
          fontWeight: "var(--fw-text)",
          color: "var(--text-1)",
          lineHeight: "var(--lh-ui)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {t("views.favorites.title")}
      </div>
      {/* Усечение — как у подписи Tile (Tile.jsx): без него длинная подпись
          («0 тр. · синхронизируется») в узкой колонке рвётся на две строки,
          «Любимое» становится выше соседей по ряду и тянет за собой их
          обёртки — ручка-⠿ уезжает вниз (баг владельца 2026-07-24). */}
      <div
        style={{
          fontSize: "var(--fs-caption)",
          color: "var(--text-2)",
          marginTop: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
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
  dragged = false,
  dimmed = false,
  selected = false,
  onClickCapture,
}: {
  playlist: PlaylistMeta;
  subtitle: string;
  onOpen: () => void;
  onMenu?: (e: React.MouseEvent) => void;
  onDropTrack?: (playlistId: string, trackId: string) => void;
  /** Плитка в множественном выделении (2026-07-20). */
  selected?: boolean;
  /** Capture-перехват клика для выделения (Ctrl/Shift/режим). */
  onClickCapture?: (e: React.MouseEvent) => void;
  /** Реордер (useLocalReorder): обработчик жеста — вешается на ВСЮ плитку;
   *  нет — плитка не переставляется и точек у неё нет. */
  grip?: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  tileRef?: (el: HTMLElement | null) => void;
  /** Тащат ИМЕННО эту плитку — курсор «grabbing», точки в полную яркость. */
  dragged?: boolean;
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
      // ХВАТАЕТСЯ ВСЯ ПЛИТКА (владелец 04.08: «было бы удобнее хвататься за
      // весь блок»). ⚠️ Это отмена решения 16.07 «реордер только за ручку-⠿,
      // по плитке — обычный клик»: жест поднимается лишь после удержания
      // HOLD_MS или сдвига на DRAG_THRESHOLD, поэтому обычный клик «открыть»
      // остаётся кликом. Точки — подсказка «это переставляется» и единственная
      // зона с touchAction: none, чтобы палец не потерял прокрутку сетки.
      {...(grip ?? {})}
      ref={tileRef}
      aria-disabled={dimmed || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClickCapture={onClickCapture}
      style={{
        position: "relative",
        borderRadius: "var(--r-md)",
        opacity: dimmed ? 0.45 : undefined,
        outline: litTarget ? "var(--focus-ring)" : undefined,
        outlineOffset: 2,
        transition: "outline-color var(--dur-state) var(--ease-standard)",
        // ⚠️ transform/zIndex здесь НЕТ намеренно: движение перестановки пишет
        // в DOM сам движок (lib/useLocalReorder.ts), запись отсюда стирала бы
        // его через кадр.
        cursor: grip && dragged ? "grabbing" : undefined,
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
        selected={selected}
        onClick={onOpen}
        onPlay={onOpen}
        onMenu={onMenu}
      />
      {grip ? (
        // Справа СНИЗУ карточки (уровень подписи), без плашки-фона и видима
        // ВСЕГДА (жалоба 2026-07-16: сверху с шариком — неудобно и прячется).
        // Правый низ ОБЛОЖКИ занят play-пилюлей Tile — сюда она не достаёт.
        <span
          aria-hidden="true"
          data-testid="reorder-grip"
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
            transition: "color var(--dur-state) var(--ease-standard)",
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
 *  выдуманных релизов из макета Stage 1 ЛЮБОМУ пользователю).
 *
 *  ЭКРАН ОБЩИЙ (волна экранов веб-паритета, 2026-08-02): его рисуют обе
 *  программы, на старом месте приложения — тонкая обёртка
 *  (apps/desktop/src/views/LibraryView.tsx), в вебе — страница /library.
 *  Разница площадок выражена ТОЛЬКО отсутствием умений, а не развилкой «веб/
 *  десктоп»:
 *  - нет порта localFiles (браузер) → вкладки «Локальные» нет вовсе, не серой;
 *  - нет обработчика (onAddLink/onImport/onJoinCode/onCreatePlaylist) → нет и
 *    кнопки в шапке. Приложение передаёт свои три — его шапка не изменилась;
 *  - нет обработчика onPlayHistory → нет и вкладки «История» (тем же правилом:
 *    список слушать нечем, значит показывать его нечестно). */
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
  onCreatePlaylist,
  onPlayHistory,
  onNotify,
  onDropTrack,
  onReorderPlaylists,
  onPlaylistsChanged,
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
  /** Играть локальные файлы (очередь = вкладка «Локальные»). Нужен только
   *  площадке с портом localFiles: без него вкладки нет, и звать нечего. */
  onPlayLocal?: (entries: LocalFileEntry[], hash: string) => void;
  /** «В плейлист» для локального трека с серверным id (см. onPlayLocal). */
  onAddToPlaylist?: (t: Track) => void;
  /** «Добавить по ссылке» (Stage 4, прямые источники). */
  onAddLink?: () => void;
  /** «Импорт плейлиста» (Stage 4, Spotify/YT/Apple). */
  onImport?: () => void;
  /** Вход в совместный плейлист по инвайт-коду (Stage 7). */
  onJoinCode?: () => void;
  /** Создать плейлист прямо из шапки. Кнопка — запасная дверь, а не вторая:
   *  обычно создание живёт в боковой панели, и там, где панель есть, шапке
   *  дублировать её незачем (в приложении такой кнопки никогда и не было).
   *  Поэтому проп передают ТОЛЬКО когда другой двери на экране нет — веб
   *  делает это на телефоне, где панель спрятана (apps/web .../library/
   *  page.tsx → useSidebarVisible). На широком экране обе программы
   *  показывают одну и ту же шапку. */
  onCreatePlaylist?: () => void;
  /** Слушать трек из «Истории»: весь список + позиция, как в любом контексте
   *  воспроизведения. Экран сам историю НЕ играет — очередь заводит программа
   *  (в приложении playCatalog, в вебе playContext). Нет обработчика — нет и
   *  вкладки. */
  onPlayHistory?: (tracks: Track[], startIndex: number) => void;
  onNotify: (text: string, icon?: string) => void;
  /** Массовое удаление плиток прошло — App перечитывает список (2026-07-20). */
  onPlaylistsChanged?: () => void;
}) {
  const { t } = useT();
  const { phone } = useLayout();
  const { dragSource } = useDrag();
  // Умения площадки: файлы с диска (вкладка «Локальные») и вынос файла
  // Alt+перетаскиванием. Нет умения — нет вкладки и нет жеста.
  const local = useLocalFiles();
  const altFileDrag = useAltFileDrag();
  // Реордер плейлистов — локальный жест СЕТКИ: плитка следует за курсором в
  // пределах сетки, соседи съезжают на будущие места (useLocalReorder +
  // gridInsertionIndex). «Любимое» закреплено первым и в ids не входит;
  // подписки (role follower, 2026-07-17) — тоже: их позиции сервер не хранит.
  const reorder = useLocalReorder({
    // закреплённые (2026-07-20) тоже вне реордера: смысл закрепа —
    // «случайно не сдвинуть»; серверная сортировка держит их сверху
    ids: srvPlaylists.filter((p) => p.role !== "follower" && !p.pinned).map((p) => p.id),
    resolveTo: (rects, from, x, y) => gridInsertionIndex(rects, from, x, y),
    onCommit: (id, to) => onReorderPlaylists?.(id, to),
  });
  // Набор вкладок собирается из умений, а не из площадки: «Локальные» держит
  // порт файлов, «История» — обработчик воспроизведения. Отсутствующая вкладка
  // не рисуется вовсе (правило розетки), поэтому список и складывается из
  // кусков, а не выбирается готовым.
  const historyTab = Boolean(onPlayHistory) && canSearch;
  const chips = [
    { key: "playlists", label: t("views.library.chips.playlists") },
    ...(local ? [{ key: "local", label: t("views.library.chips.local") }] : []),
    ...(historyTab ? [{ key: "history", label: t("views.library.chips.history") }] : []),
    { key: "albums", label: t("views.library.chips.albums") },
    { key: "artists", label: t("views.library.chips.artists") },
    // Жанры (13.08). Стоят В ОДНОМ РЯДУ с альбомами и артистами намеренно: это
    // третий способ нарезать ту же библиотеку, а не отдельный экран. Владелец
    // просил именно «распределять музыку по жанрам» — то есть смотреть на своё,
    // а не искать новое.
    ...(canSearch ? [{ key: "genres", label: t("views.library.chips.genres") }] : []),
  ];
  const [chip, setChip] = useState("playlists");
  /** Жанры: null — ещё не спрашивали. Пустой массив — спросили, их нет
   *  (теги проставляются фоном, у свежей библиотеки их может не быть). */
  const [genres, setGenres] = useState<Genre[] | null>(null);
  /** Открытый жанр и его треки. Ноль состояний «загружается» отдельно:
   *  tracks === null при выбранном жанре и есть «идёт загрузка». */
  const [openGenre, setOpenGenre] = useState<Genre | null>(null);
  const [genreTracks, setGenreTracks] = useState<Track[] | null>(null);
  const [locals, setLocals] = useState<LocalFileEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  /** История прослушиваний: null — ещё не спрашивали (или спрашиваем). */
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  // контекстные меню — общий механизм (shell/ContextMenu.tsx, 2026-07-20):
  // локальные файлы + пустое место медиатеки (создать/по ссылке/импорт/код).
  // Тип — MenuAbilities (не полный набор десктопа): у браузера половины умений
  // нет, и вью обязана спрашивать про каждое, а не считать их данностью.
  const { openMenu, menuCtxRef } = useContextMenu<MenuAbilities>();
  // «Сохранить офлайн» пачкой — умение площадки: в браузере его нет, и пункта
  // в панели выделения быть не должно (не серого — никакого).
  const canSaveOffline = menuCtxRef.current.savePlaylistOffline !== undefined;

  // ── множественное выделение плиток (2026-07-20) ──
  // Подписки (role follower) вне выделения — та же граница, что у реордера:
  // массовые действия (оффлайн/удаление) — про СВОИ плейлисты.
  const selectable = srvPlaylists.filter((p) => p.role !== "follower");
  const multi = useMultiSelect(selectable.map((p) => p.id));
  const selectedPls = () => selectable.filter((p) => multi.has(p.id));
  const [bulkDelete, setBulkDelete] = useState<{ id: string; name: string }[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const saveSelectedOffline = () => {
    for (const x of selectedPls()) menuCtxRef.current.savePlaylistOffline?.(x.id);
  };

  const runBulkDelete = async () => {
    const targets = bulkDelete;
    if (!targets || bulkBusy) return;
    setBulkBusy(true);
    let ok = 0;
    try {
      // пакетного метода нет — по одному, как addToPlaylist/saveOfflinePlaylist
      for (const p of targets) {
        await api.deletePlaylist(p.id);
        ok += 1;
      }
      onNotify(t("views.library.bulkDeleted", { count: ok }), "trash-2");
    } catch {
      onNotify(t("views.library.bulkDeleteFailed"), "x");
    } finally {
      setBulkBusy(false);
      setBulkDelete(null);
      multi.clear();
      onPlaylistsChanged?.();
    }
  };

  /** ПКМ по плитке: по выделенной — меню выделения, иначе сброс + меню плейлиста. */
  const tileMenu = (p: PlaylistMeta) => (e: React.MouseEvent) => {
    if (multi.count > 0 && multi.has(p.id)) {
      openMenu(e, {
        kind: "playlistSelection",
        playlists: selectedPls().map((x) => ({ id: x.id, name: x.name })),
        ctl: {
          // умения нет — поля нет, и пункт «Сохранить офлайн» не рисуется
          saveOffline: canSaveOffline ? saveSelectedOffline : undefined,
          requestDelete: () => setBulkDelete(selectedPls().map((x) => ({ id: x.id, name: x.name }))),
          clear: multi.clear,
        },
      });
      return;
    }
    if (multi.count > 0) multi.clear();
    onPlaylistMenu?.({ id: p.id, name: p.name }, e);
  };

  const reloadLocals = () => (local ? local.list().then(setLocals).catch(() => setLocals([])) : Promise.resolve());
  useEffect(() => {
    if (chip === "local") void reloadLocals();
  }, [chip]);

  // История приходит с сервера и одна на все устройства. Спрашиваем её один
  // раз — при первом открытии вкладки: пока человек листает плитки, ходить за
  // ней незачем, а перечитывать при каждом возврате — дёргать сервер зря.
  useEffect(() => {
    if (chip !== "history" || history !== null) return;
    void api
      .getHistory(50)
      .then(setHistory)
      .catch(() => setHistory([])); // не ответила — покажем «пусто», а не белый экран
  }, [chip, history, api]);

  // Жанры — тем же приёмом, что история: спрашиваем один раз при первом
  // открытии вкладки. Список меняется медленно (теги проставляются фоном), и
  // перечитывать его на каждый возврат значило бы дёргать сервер зря.
  useEffect(() => {
    if (chip !== "genres" || genres !== null) return;
    void api
      .genres()
      .then(setGenres)
      .catch(() => setGenres([])); // не ответил — покажем «пусто», а не белый экран
  }, [chip, genres, api]);

  // Треки открытого жанра. Сбрасываются в null ПЕРЕД запросом, иначе на экране
  // оставался бы прошлый жанр, пока едет новый, — и человек успевал бы нажать
  // на трек, которого в открытом разделе нет.
  useEffect(() => {
    if (!openGenre) return;
    let alive = true;
    setGenreTracks(null);
    void api
      .genreTracks(openGenre.slug, { limit: 100 })
      .then((tracks) => {
        if (alive) setGenreTracks(tracks);
      })
      .catch(() => {
        if (alive) setGenreTracks([]);
      });
    return () => {
      alive = false;
    };
  }, [openGenre, api]);

  // Уход с вкладки закрывает открытый жанр: вернувшись, человек ждёт список
  // жанров, а не тот раздел, в котором был десять минут назад.
  useEffect(() => {
    if (chip !== "genres" && openGenre !== null) setOpenGenre(null);
  }, [chip, openGenre]);

  const addLocal = async (kind: "files" | "folder") => {
    if (scanning || !local) return;
    setScanning(true);
    try {
      const scanned = await local.pickAndScan(kind);
      if (scanned === null) return; // передумал
      const entries = scanned.entries;
      if (entries.length === 0) {
        // Разводим «в папке нечего брать» и «файлы есть, но не читаются»:
        // во втором случае человеку надо менять формат, а не папку, и старый
        // общий тост уводил его искать музыку там, где она уже лежала.
        onNotify(
          scanned.found > 0
            ? t("views.library.filesUnreadable", { count: scanned.found })
            : t("views.library.noAudioFilesFound"),
          "x",
        );
        return;
      }
      // серверная сессия: регистрируем теги+хэш — треки попадают в общую
      // библиотеку (плейлисты/лайки); файл никуда не загружается.
      // Цикл здесь, а не в порту: сеть — дело общего кода, а порт знает про
      // устройство (близнец — registerLocalTracks в apps/desktop/src/lib/
      // localFiles.ts: тем же путём регистрируются файлы, брошенные в окно).
      if (canSearch) {
        for (const entry of entries) {
          try {
            const track = await api.addLocalTrack({
              artist: entry.artist,
              title: entry.title,
              durationSec: entry.duration_sec,
              hash: entry.hash,
            });
            local.rememberServerId(entry.hash, track.id);
          } catch {
            /* один файл не зарегистрировался — остальные важнее */
          }
        }
      }
      onNotify(
        scanned.truncated
          ? t("views.library.filesAddedPartial", { count: entries.length })
          : t("views.library.filesAdded", { count: entries.length }),
        "hard-drive",
      );
      await reloadLocals();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("views.library.addFilesFailed"), "x");
    } finally {
      setScanning(false);
    }
  };

  const serverIds = local ? local.serverIds() : {};
  const grid: React.CSSProperties = {
    display: "grid",
    // Минимум колонки = настройка «Размер плитки» (--w-tile, зона 4 спеки
    // 19.07): в текучей сетке ручка задаёт нижнюю границу, тянуться дальше
    // колонкам никто не мешает.
    /* ⚠️ НА ТЕЛЕФОНЕ КОЛОНОК РОВНО ДВЕ, И ЭТО ПОЧИНКА ЖАЛОБЫ «огромные
       плашки» (10.08). `auto-fill` с минимумом 176px на строке 353px не
       набирает второй колонки (двум нужно 176·2 + 16 = 368) и честно отдаёт
       ОДНУ — растянутую во всю ширину. Так «Любимое» и занимало у владельца
       весь экран: настройка «Размер плитки» задумана как нижняя граница для
       большого окна, а на телефоне она сама себе противоречит. Ниже планшета
       ручка перестаёт быть минимумом и становится тем, чем должна быть на
       узком экране, — ничем: колонок две, ширина делится поровну. */
    gridTemplateColumns: phone ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(var(--w-tile, 176px), 1fr))",
    // Плитки живут своей высотой, а не высотой самой высокой в ряду: при
    // stretch (умолчание grid) обёртка PlaylistDropTile растягивалась под
    // соседа, Tile внутри оставался прежним — и абсолютная ручка-⠿
    // (bottom: 8 от ОБЁРТКИ) висела ниже видимой карточки (баг 2026-07-24).
    alignItems: "start",
    gap: "var(--sp-4)",
    paddingBottom: "var(--sp-6)",
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: phone ? "var(--sp-4)" : "var(--sp-5)", padding: phone ? "var(--sp-4) var(--sp-4) 0" : "var(--sp-6) var(--sp-6) 0" }}
      // ПКМ по пустому месту (2026-07-20): плитки и строки гасят всплытие в
      // openMenu, так что сюда долетает только пустота. Анониму меню не
      // показываем — все пункты требуют серверной сессии.
      onContextMenu={
        canSearch
          ? (e) =>
              openMenu(e, {
                kind: "libraryBlank",
                ctl:
                  selectable.length > 0
                    ? { enterSelect: multi.enterMode, selectAll: multi.selectAll }
                    : undefined,
              })
          : undefined
      }
    >
      {/* ⚠️ ШАПКА НА ТЕЛЕФОНЕ — ЗАГОЛОВОК, ПОТОМ СЕТКА ДЕЙСТВИЙ (10.08).
          Четыре кнопки с `flexWrap` рядом с заголовком складывались в рваную
          лесенку: «Твоя медиатека» ужималось до двух слов в столбик, а кнопки
          разъезжались по три строки разной длины (снимок владельца). Ряд
          работает, пока кнопки помещаются в остаток строки; на 353px остатка
          нет вовсе. Внизу — честная сетка 2×2: главное действие («Создать
          плейлист») занимает всю ширину первой строки, три вспомогательных
          делят вторую и третью пополам. Ни одна подпись не режется. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        {/* ⚠️ БЕЗ minWidth: 0. Заголовок обязан держать свою ширину: у ряда
            стоит flexWrap, и когда кнопки перестают помещаться, уехать на
            следующую строку должны ОНИ, а не буквы заголовка. С minWidth: 0
            «Твоя медиатека» ужималось до 82px из нужных 150 и наезжало на
            первую кнопку (замер 10.08 на планшете и ноутбуке). */}
        <h1 style={{ margin: 0, fontSize: phone ? "var(--fs-title)" : "var(--fs-h1)", fontWeight: 600, color: "var(--text-1)", flex: 1 }}>
          {t("views.library.title")}
        </h1>
        {canSearch && !phone ? (
          <>
            {onAddLink ? (
              <Button variant="secondary" icon="link" onClick={onAddLink}>
                {t("views.library.addLink")}
              </Button>
            ) : null}
            {onImport ? (
              <Button variant="secondary" icon="import" onClick={onImport}>
                {t("views.library.importPlaylist")}
              </Button>
            ) : null}
            {onJoinCode ? (
              <Button variant="secondary" icon="users" onClick={onJoinCode}>
                {t("views.library.byCode")}
              </Button>
            ) : null}
            {onCreatePlaylist ? (
              <Button variant="primary" icon="plus" onClick={onCreatePlaylist}>
                {/* тот же ключ, что у пункта «Создать плейлист» в меню пустого
                    места медиатеки — одно действие подписано одинаково */}
                {t("menu.library.createPlaylist")}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {canSearch && phone ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--sp-2)" }}>
          {onCreatePlaylist ? (
            <Button variant="primary" icon="plus" onClick={onCreatePlaylist} style={{ gridColumn: "1 / -1" }}>
              {t("menu.library.createPlaylist")}
            </Button>
          ) : null}
          {/* Порядок и ширины — по ДЛИНЕ ПОДПИСИ, а не по важности: «Импорт
              плейлиста» в половине строки (168px) ломается на две строки и
              делает кнопку выше соседки, из-за чего ряд читается как сбой.
              Длинная подпись получает всю ширину, две короткие делят строку. */}
          {onImport ? (
            <Button variant="secondary" icon="import" onClick={onImport} style={{ gridColumn: "1 / -1" }}>
              {t("views.library.importPlaylist")}
            </Button>
          ) : null}
          {onAddLink ? (
            <Button variant="secondary" icon="link" onClick={onAddLink}>
              {t("views.library.addLink")}
            </Button>
          ) : null}
          {onJoinCode ? (
            <Button variant="secondary" icon="users" onClick={onJoinCode}>
              {t("views.library.byCode")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* Вкладки на телефоне листаются вбок: четыре чипа («Плейлисты»,
          «История», «Альбомы», «Артисты») в 353px не влезают — последний
          вылезал за край на 30px и обрезался кромкой экрана. Прятать вкладку
          нельзя, ужимать подписи — врать о содержимом. */}
      <div
        style={{
          display: "flex",
          gap: "var(--sp-2)",
          ...(phone ? { overflowX: "auto", scrollbarWidth: "none", margin: "0 calc(-1 * var(--sp-4))", padding: "0 var(--sp-4)" } : null),
        }}
      >
        <ChipGroup items={chips} value={chip} onChange={setChip} />
      </div>

      {chip === "genres" ? (
        openGenre ? (
          <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-4) 0" }}>
              <Button variant="ghost" icon="arrow-left" onClick={() => setOpenGenre(null)}>
                {t("views.library.genres.back")}
              </Button>
              <div style={{ fontSize: "var(--fs-title)", fontWeight: "var(--fw-bold)", color: "var(--text-1)" }}>
                {openGenre.label}
              </div>
            </div>
            {genreTracks === null ? (
              <div style={{ padding: "var(--sp-6) 0", color: "var(--text-3)" }}>{t("common.loading")}</div>
            ) : genreTracks.length === 0 ? (
              <EmptyState icon="music-2" title={t("views.library.genres.emptyOne.title")} hint={t("views.library.genres.emptyOne.hint")} />
            ) : (
              genreTracks.map((tr, i) => (
                <TrackRow
                  key={tr.id}
                  {...trackRowL10n(t)}
                  compact={phone}
                  index={i + 1}
                  cover={tr.coverUrl}
                  title={tr.title}
                  artist={tr.artist}
                  duration={fmtTime(tr.durationSec)}
                  active={currentId === tr.id}
                  playing={currentId === tr.id && playing}
                  // Жанр — такой же контекст воспроизведения, как история или
                  // плейлист: включаем ВЕСЬ раздел с этой позиции, дальше
                  // очередь идёт по нему. Колбэк общий на «сыграй этот список»,
                  // историей он назван по первому потребителю.
                  onPlay={() => onPlayHistory?.(genreTracks, i)}
                />
              ))
            )}
          </div>
        ) : genres === null ? (
          <div style={{ padding: "var(--sp-6) 0", color: "var(--text-3)" }}>{t("common.loading")}</div>
        ) : genres.length === 0 ? (
          <EmptyState icon="tag" title={t("views.library.genres.empty.title")} hint={t("views.library.genres.empty.hint")} />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", padding: "var(--sp-4) 0" }}>
            {genres.map((g) => (
              // Число НА кнопке, а не отдельной подписью: «сколько» — это часть
              // ответа на «что тут есть», и разносить их значит заставлять глаз
              // сводить две колонки.
              <Button key={g.slug} variant="ghost" onClick={() => setOpenGenre(g)}>
                {g.label} · {g.count}
              </Button>
            ))}
          </div>
        )
      ) : chip === "artists" ? (
        <div style={{ padding: "var(--sp-6) 0", color: "var(--text-2)" }}>
          {t("views.library.artistsPlaceholder")}
        </div>
      ) : chip === "history" && historyTab ? (
        // «История» — последние 50 прослушиваний с сервера, общие для всех
        // устройств. Одна и та же песня попадает в список столько раз, сколько
        // её слушали, поэтому ключ строки — трек ПЛЮС момент прослушивания:
        // по одному id React склеил бы повторы в одну строку.
        history === null ? (
          <div style={{ padding: "var(--sp-6) 0", color: "var(--text-3)" }}>{t("common.loading")}</div>
        ) : history.length === 0 ? (
          <EmptyState
            icon="history"
            title={t("views.library.historyEmpty.title")}
            hint={t("views.library.historyEmpty.hint")}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
            {history.map((h, i) => (
              <TrackRow
                key={`${h.track.id}:${h.playedAt}`}
                {...trackRowL10n(t)}
                compact={phone}
                index={i + 1}
                cover={h.track.coverUrl}
                title={h.track.title}
                artist={h.track.artist}
                duration={fmtTime(h.track.durationSec)}
                active={currentId === h.track.id}
                playing={currentId === h.track.id && playing}
                // Играем ВЕСЬ список с этой позиции: история — такой же
                // контекст, как плейлист, и дальше очередь идёт по нему.
                onPlay={() => onPlayHistory?.(history.map((x) => x.track), i)}
              />
            ))}
          </div>
        )
      ) : chip === "local" && local ? (
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
                    altFileDrag(
                      ev,
                      async () => {
                        const path = await local.resolvePath(e.hash);
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
                  compact={phone}
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
                    onPlayLocal?.(locals ?? [], e.hash);
                  }}
                  onMore={(ev: React.MouseEvent) =>
                    openMenu(ev, {
                      kind: "localTrack",
                      entry: e,
                      ctl: {
                        // класть в плейлист можно только зарегистрированный на
                        // сервере файл (серверная сессия + известный id)
                        addToPlaylist:
                          canSearch && serverIds[e.hash] && onAddToPlaylist
                            ? () =>
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
                                })
                            : null,
                        // файл есть на устройстве И площадка умеет открыть
                        // папку → пункт «Показать в папке»
                        reveal:
                          e.available && local.reveal
                            ? () =>
                                void local.resolvePath(e.hash).then((path) => {
                                  if (path) return local.reveal?.(path);
                                  onNotify(t("views.library.fileNotOnDevice"), "x");
                                })
                            : null,
                        forget: () =>
                          void local.forget(e.hash).then(() => {
                            onNotify(t("views.library.removedFromLocal"), "trash-2");
                            void reloadLocals();
                          }),
                      },
                    })
                  }
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
          {/* Живой порядок жеста ложится на СЛОТЫ подвижных плиток: подписки и
              закреплённые в перестановку не входят и остаются на местах. */}
          {applyVisibleOrder(srvPlaylists, (p) => p.id, reorder.order).map((p) => {
            // Подписка (2026-07-17): чужой read-only плейлист. Скрытый
            // владельцем — гаснет; открыть нельзя, только убрать через меню.
            const followed = p.role === "follower";
            const hidden = followed && p.available === false;
            // закреплён (2026-07-20): не тащится и не принимает случайный дроп,
            // как follower; намеренные действия (меню, выделение) — работают
            const locked = followed || p.pinned;
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
                onMenu={tileMenu(p)}
                selected={multi.has(p.id)}
                onClickCapture={
                  followed
                    ? undefined
                    : (e: React.MouseEvent) => {
                        if (multi.onItemClick(p.id, e)) {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }
                }
                onDropTrack={locked ? undefined : onDropTrack}
                grip={onReorderPlaylists && !locked ? reorder.grip(p.id) : undefined}
                tileRef={locked ? undefined : reorder.itemRef(p.id)}
                dragged={!locked && reorder.draggingId === p.id}
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

      {/* Панель массовых действий выделенных плиток (2026-07-20) */}
      
        <SelectionBar
          // Уход играет ТОЛЬКО у того, кто передаёт open (2026-08-05): узел, снятый
          // условием, вырывается кадром — анимировать нечего. Подпись и кнопки на
          // кадре ухода уже пусты, но панель показывает последний открытый вид сама.
          open={multi.count > 0}
          label={t("menu.selection.count", { count: multi.count })}
          clearLabel={t("menu.selection.clear")}
          onClear={multi.clear}
          actions={[
            ...(canSaveOffline
              ? [
                  {
                    icon: "download",
                    label: t("menu.catalog.saveOffline"),
                    onClick: saveSelectedOffline,
                  },
                ]
              : []),
            {
              icon: "trash-2",
              label: t("menu.playlist.delete"),
              danger: true,
              onClick: () => setBulkDelete(selectedPls().map((x) => ({ id: x.id, name: x.name }))),
            },
          ]}
        />

      {/* Подтверждение массового удаления: перечисляем имена — владелец должен
          видеть, ЧТО исчезнет, прежде чем нажать */}
      <Dialog
        open={bulkDelete !== null}
        title={t("views.library.bulkDeleteTitle")}
        onClose={() => (bulkBusy ? undefined : setBulkDelete(null))}
        actions={
          <>
            <Button variant="ghost" onClick={() => setBulkDelete(null)} disabled={bulkBusy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="trash-2" disabled={bulkBusy} onClick={() => void runBulkDelete()}>
              {t("views.library.bulkDeleteConfirm", { count: bulkDelete?.length ?? 0 })}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 280, maxWidth: 380 }}>
          <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.5 }}>
            {t("views.library.bulkDeleteHint")}
          </div>
          <div style={{ color: "var(--text-1)", fontSize: "var(--fs-body)", lineHeight: 1.7 }}>
            {(bulkDelete ?? []).map((p) => (
              <div key={p.id} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </div>
            ))}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
