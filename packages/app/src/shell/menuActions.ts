import type { Track } from "@muza/api-client";
import type { useT } from "../i18n";
import type { ContextTarget } from "./contextTargets";

/** Сборка пунктов контекстного меню — чистая функция от цели и контекста.
 *
 *  Переехал из apps/desktop/src/shell/menuActions.ts 2026-08-02 (на старом
 *  месте — пенёк-ре-экспорт): меню стало общим для десктопа и веба.
 *
 *  До 2026-07-20 эти наборы жили JSX-массивами в четырёх местах (App.tsx
 *  catMenu/plMenu, PlaylistView, LibraryView) и не были тестируемы вовсе.
 *  Здесь матрица «роль × гость × Любимое × оффлайн» покрывается юнит-тестами
 *  без React (menuActions.test.ts).
 *
 *  Порядок пунктов трека: сперва действия НАД ОЧЕРЕДЬЮ (следующим/в очередь —
 *  самые частые), затем сборные (плейлист/Любимое/джем), затем справочные
 *  (версии/заменить версию), хвост — вьюшные extras плейлиста и плагины.
 *  (До чистки 13.08 между ними стояли радио, «поделиться» и оффлайн — см. ниже.)
 *
 *  ── ЧИСТКА МЕНЮ ТРЕКА 2026-08-13 (решение владельца) ──────────────────────
 *  Сняты три пункта: «Радио по треку», «Сохранить офлайн», «Поделиться»; у
 *  плейлиста — «Поделиться». Разбор сделан ПЕРЕД снятием, чтобы не оставить
 *  осиротевших функций и мёртвого кода. ЧТО ОСТАЛОСЬ ЖИВЫМ И ПОЧЕМУ:
 *
 *  startRadio (радио) — умение и обе реализации ЖИВЫ (App.tsx::startRadio,
 *    web/components/trackMenu.tsx). Меню было их ЕДИНСТВЕННЫМ входом, так что
 *    сейчас код недостижим. Не удалён намеренно: рядом стоит настройка
 *    «бесконечное радио» (settings.playback.radioEndless) и автопродолжение
 *    очереди (toast.radio.continuing) — сама подсистема радио продолжает
 *    работать, отвалился только ручной запуск от трека. Удалить её заодно с
 *    пунктом меню значило бы снести живую механику под видом уборки.
 *
 *  toggleOffline (офлайн) — жив и ДОСТИЖИМ: пачкой из панели выделения
 *    (pinMany, PlaylistView/SearchView), плейлистом целиком
 *    (savePlaylistOffline), и «Убрать из офлайна» осталось в меню трека для уже
 *    сохранённых (см. комментарий на месте: экрана со списком сохранённого в
 *    продукте нет, снять пин больше неоткуда).
 *
 *  shareTrack / sharePlaylist / ShareDialog — умения и диалог ЖИВЫ и достижимы
 *    из «Итогов года» (WrappedOverlay зовёт ту же карточку). Из меню трека и
 *    плейлиста входов больше нет.
 *    ⚠️ ФАКТ ДЛЯ БУДУЩЕГО РЕШЕНИЯ: ссылки на трек в Muza НЕ СУЩЕСТВУЕТ вовсе.
 *    Режим «Скопировать текст» у карточки кладёт в буфер строку вида
 *    «„Название“ — Артист · слушаю в Muza · https://muza.lol», то есть адрес
 *    ЛЕНДИНГА, а не трека. У плейлиста ссылки тоже нет: и совместный доступ
 *    (CollabDialog), и публикация (ShareVisibilityDialog) раздают КОДЫ
 *    (PL_… / @адрес), которые друг вбивает в поиск руками. Пока продукт не
 *    научится отдавать адрес вещи, «поделиться» нечем — потому пункты и сняты,
 *    а не переписаны.
 *
 *  ⚠️ ГЛАВНОЕ ПРАВИЛО НАБОРА (2026-08-02): пункт показывается, только если
 *  площадка УМЕЕТ это действие — то есть в MenuAbilities есть поле. Ничего
 *  серого и неработающего: в браузере нет очереди-вставки, радио, оффлайна и
 *  плагинов, и этих пунктов там просто НЕТ. Десктоп отдаёт полный набор
 *  (MenuContext = Required<MenuAbilities>), поэтому его меню не изменилось ни
 *  на пункт — это стережёт матрица menuActions.test.ts. */

type T = ReturnType<typeof useT>["t"];

export type MenuItem =
  | "-"
  | { header: string }
  | { icon?: string; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean; hint?: string };

/** Пункт меню, который добавил плагин. Структурная форма PluginMenuItem
 *  десктопа (apps/desktop/src/plugins/usePlugins.ts): подсистема плагинов —
 *  десктопная, в общий пакет не едет, а меню знает про неё ровно эти поля. */
export interface MenuPluginItem {
  pluginId: string;
  slotId: string;
  title: string;
  icon?: string;
}
export type MenuPluginSlot = "track" | "catalogTrack" | "playlist";

/** Что площадка УМЕЕТ. Все поля необязательны: отсутствует поле — отсутствует
 *  пункт (тот же принцип, что у PlatformAdapter в @muza/app/platform, только
 *  про действия, а не про системные умения). */
export interface MenuAbilities {
  // — трек каталога —
  /** Вставить сразу после текущего (usePlayback.insertInQueue). */
  playNext?: (tr: Track) => void;
  /** В конец очереди (queueCatalog). */
  queueTrack?: (tr: Track) => void;
  startRadio?: (tr: Track) => void;
  /** Диалог-пикер «В плейлист». */
  addToPlaylist?: (tr: Track) => void;
  isLiked?: (id: string) => boolean;
  toggleLike?: (id: string) => void;
  /** Гость jam: докинуть трек хосту; null — jam не активен или мы хост. */
  jamAdd?: ((tr: Track) => void) | null;
  shareTrack?: (tr: Track) => void;
  showVersions?: (tr: Track) => void;
  /** «Заменить версию» из Любимого (в плейлисте — свой путь через ctl). */
  replaceInFavorites?: (tr: Track) => void;
  isPinned?: (id: string) => boolean;
  toggleOffline?: (tr: Track) => void;
  /** Сохранить файл СРЕДСТВАМИ ПЛОЩАДКИ (браузер — обычная загрузка). У
   *  десктопа этого умения нет: там та же потребность закрыта «Сохранить
   *  офлайн», и лишнего пункта в приложении не появилось. */
  downloadTrack?: (tr: Track) => void;
  // — плейлист —
  openPlaylist?: (id: string) => void;
  /** Роль в плейлисте; не найден/аноним → "owner" (поведение T17 как было). */
  playlistRole?: (id: string) => "owner" | "collaborator" | "follower";
  playPlaylist?: (id: string) => void;
  queuePlaylistNext?: (id: string) => void;
  queuePlaylist?: (id: string) => void;
  sharePlaylist?: (id: string) => void;
  savePlaylistOffline?: (id: string) => void;
  renamePlaylist?: (pl: { id: string; name: string }) => void;
  changePlaylistIcon?: (id: string) => void;
  /** Закреп СВЕРХУ СПИСКА (2026-07-20). ⚠️ Не путать с офлайн-пином
   *  (isPinned/pinMany/toggleOffline — «Сохранить офлайн», другой смысл). */
  playlistPinned?: (id: string) => boolean;
  togglePlaylistPinned?: (id: string) => void;
  deletePlaylist?: (pl: { id: string; name: string }) => void;
  unfollowPlaylist?: (pl: { id: string; name: string }) => void;
  // — медиатека (пустое место) —
  openCreatePlaylist?: () => void;
  openAddLink?: () => void;
  openImport?: () => void;
  openJoinCode?: () => void;
  // — массовые действия над выделением (2026-07-20) —
  playNextMany?: (tracks: Track[]) => void;
  queueMany?: (tracks: Track[]) => void;
  addManyToPlaylist?: (tracks: Track[]) => void;
  /** Только ДОБАВЛЯЕТ в Любимое: toggle снимал бы лайк с уже лайкнутых
   *  (урок favoritesDrop 20.07). */
  likeMany?: (ids: string[]) => void;
  pinMany?: (tracks: Track[]) => void;
  // — текст песни (2026-07-21) —
  /** Копировать в буфер + тост подтверждения (панель «Сейчас играет» и
   *  режим прослушивания — одно действие на оба места). */
  copyText?: (text: string, doneToast: string) => void;
  // — плагины (T44) —
  pluginMenuItems?: (kind: MenuPluginSlot) => MenuPluginItem[];
  notifyPlugin?: (pluginId: string, slotId: string, payload: unknown) => void;
}

/** Умения, которых у настольного приложения НЕТ и быть не должно: сохранение
 *  файла средствами браузера. Вынесены из обязательного набора, иначе App.tsx
 *  требовал бы заглушек под то, чего в приложении не существует. */
type BrowserOnlyAbility = "downloadTrack";

/** ПОЛНЫЙ набор умений — то, что обязано отдать приложение-десктоп. Отдельный
 *  тип, а не Partial-объект: забыл поле в App.tsx → ошибка компиляции, а не
 *  молча пропавший пункт меню. */
export type MenuContext = Required<Omit<MenuAbilities, BrowserOnlyAbility>> &
  Pick<MenuAbilities, BrowserOnlyAbility>;

export function buildMenuItems(target: ContextTarget, ctx: MenuAbilities, t: T): MenuItem[] {
  switch (target.kind) {
    case "track":
      return trackItems(target, ctx, t);
    case "playlist":
      return playlistItems(target, ctx, t);
    case "queueTrack":
      return queueTrackItems(target, ctx, t);
    case "libraryBlank":
      return libraryBlankItems(target.ctl, ctx, t);
    case "playlistBlank":
      return [
        { icon: "square-check-big", label: t("menu.selection.enter"), onClick: target.ctl.enterSelect },
        { icon: "list-checks", label: t("menu.selection.all"), onClick: target.ctl.selectAll },
      ];
    case "selection":
      return selectionItems(target, ctx, t);
    case "playlistSelection":
      return playlistSelectionItems(target, t);
    case "localTrack":
      return localTrackItems(target.ctl, t);
    case "lyrics":
      return lyricsItems(target, ctx, t);
  }
}

/** ПКМ по тексту песни (2026-07-21): копировать весь текст — всегда; строку —
 *  когда ПКМ пришёлся на строку с текстом; «Смысл» — только у строк с
 *  объяснением (дубль двойного клика, для находимости).
 *
 *  ⚠️ ЗДЕСЬ ЖЕ ЖИВЁТ «ТЕКСТ НЕ ОТ ЭТОЙ ПЕСНИ» (14.08), и место выбрано, а не
 *  досталось. Отвергают ведь не абстрактную настройку, а ВОТ ЭТОТ текст на
 *  экране — путь от «это не оно» до действия должен идти через сам текст.
 *  Правый клик по тексту в Muza уже означает «сделать что-то с этим текстом»
 *  (копирование живёт только тут), поэтому второй, отдельный вход раздвоил бы
 *  одно знание. И главное: пункт меню не стоит ни пикселя, пока он не нужен, —
 *  а нужен он на одной песне из сотни. Кнопка в караоке ради такого случая
 *  портила бы сцену все остальные разы.
 *
 *  «Вернуть текст» — там же и по той же логике, но появляется, только когда
 *  есть что возвращать. Без него отказ был бы ловушкой: промахнулся по пункту —
 *  и трек навсегда без текста. */
function lyricsItems(target: Extract<ContextTarget, { kind: "lyrics" }>, ctx: MenuAbilities, t: T): MenuItem[] {
  const { allText, lineText, lineIndex, hasNote, canReject, canRestore, ctl } = target;
  const copyText = ctx.copyText;
  const reject = ctl.reject;
  const restore = ctl.restore;
  const wrong: MenuItem[] = [
    ...(canReject && reject
      ? [{ icon: "unlink", label: t("menu.lyrics.wrongSong"), onClick: reject }]
      : []),
    ...(canRestore && restore
      ? [{ icon: "link", label: t("menu.lyrics.restore"), onClick: restore }]
      : []),
  ];
  return [
    ...(copyText
      ? [{ icon: "copy", label: t("menu.lyrics.copyAll"), onClick: () => copyText(allText, t("toast.lyrics.copiedAll")) }]
      : []),
    ...(copyText && lineText !== null
      ? [{ icon: "text", label: t("menu.lyrics.copyLine"), onClick: () => copyText(lineText, t("toast.lyrics.copiedLine")) }]
      : []),
    ...(hasNote && lineIndex !== null
      ? [{ icon: "sparkles", label: t("menu.lyrics.meaning"), onClick: () => ctl.explain(lineIndex) }]
      : []),
    // Разделитель — не украшение: выше пункты про содержимое текста, ниже про
    // то, тот ли это текст вообще. Разные вопросы не должны стоять встык.
    // Пустой блок разделителя не рисует (иначе у веба, где отказа пока нет,
    // меню кончалось бы чертой).
    ...(wrong.length > 0 ? ["-" as const, ...wrong] : []),
  ];
}

/** Меню выделения (ПКМ по выделенному): заголовок-счётчик + массовые
 *  действия. «Убрать…» — только где есть что убирать (ctl.remove). */
function selectionItems(target: Extract<ContextTarget, { kind: "selection" }>, ctx: MenuAbilities, t: T): MenuItem[] {
  const { tracks, place, ctl } = target;
  // Считаем по count, а не по длине каталожного списка: локальные файлы в
  // tracks не попадают, но убираются наравне со всеми.
  const n = target.count;
  const playNextMany = ctx.playNextMany;
  const queueMany = ctx.queueMany;
  const addManyToPlaylist = ctx.addManyToPlaylist;
  const likeMany = ctx.likeMany;
  const pinMany = ctx.pinMany;
  return [
    { header: t("menu.selection.count", { count: n }) },
    // очередь: playNext/queue добавляли бы КОПИИ уже стоящих в очереди треков
    ...(place === "list" && playNextMany
      ? [{ icon: "list-start", label: t("menu.catalog.playNext"), onClick: () => playNextMany(tracks) }]
      : []),
    ...(place === "list" && queueMany
      ? [{ icon: "list-end", label: t("menu.catalog.queue"), onClick: () => queueMany(tracks) }]
      : []),
    ...(addManyToPlaylist
      ? [{ icon: "plus", label: t("menu.addToPlaylist"), onClick: () => addManyToPlaylist(tracks) }]
      : []),
    ...(likeMany
      ? [{ icon: "heart", label: t("menu.catalog.like"), onClick: () => likeMany(tracks.map((x) => x.id)) }]
      : []),
    ...(pinMany
      ? [{ icon: "download", label: t("menu.catalog.saveOffline"), onClick: () => pinMany(tracks) }]
      : []),
    ...(ctl.remove
      ? ([
          "-",
          {
            icon: "list-x",
            label: ctl.remove.scope === "queue" ? t("menu.queue.remove") : t("views.playlist.removeFromPlaylist"),
            danger: true,
            hint: String(n),
            onClick: ctl.remove.run,
          },
        ] as const)
      : []),
    "-",
    { icon: "x", label: t("menu.selection.clear"), onClick: ctl.clear },
  ];
}

/** Меню выделенных ПЛИТОК плейлистов (медиатека). */
function playlistSelectionItems(
  target: Extract<ContextTarget, { kind: "playlistSelection" }>,
  t: T,
): MenuItem[] {
  const { playlists, ctl } = target;
  const saveOffline = ctl.saveOffline;
  return [
    { header: t("menu.selection.count", { count: playlists.length }) },
    // умения нет (браузер) — пункта нет вовсе, а не серым
    ...(saveOffline ? [{ icon: "download", label: t("menu.catalog.saveOffline"), onClick: saveOffline }] : []),
    "-",
    {
      icon: "trash-2",
      label: t("menu.playlist.delete"),
      danger: true,
      hint: String(playlists.length),
      onClick: ctl.requestDelete,
    },
    "-",
    { icon: "x", label: t("menu.selection.clear"), onClick: ctl.clear },
  ];
}

/** Меню трека — единое для всех мест (поиск/хоум/Любимое/статистика/плейлист/
 *  плеер-бар); место решает добавки: «Заменить версию» — только Любимое,
 *  правка состава — только плейлист (через ctl), у играющего сейчас нет
 *  «Играть следующим». */
function trackItems(target: Extract<ContextTarget, { kind: "track" }>, ctx: MenuAbilities, t: T): MenuItem[] {
  const { track: tr, place, ctl } = target;
  // слоты плагинов track и catalogTrack схлопнуты в один список: с уходом
  // демо-каталога «трек» и «каталожный трек» стали одним и тем же, а
  // menus.track используют уже написанные плагины (examples/hello-plugin)
  const pluginItems = ctx.pluginMenuItems
    ? [...ctx.pluginMenuItems("catalogTrack"), ...ctx.pluginMenuItems("track")]
    : [];
  const notifyPlugin = ctx.notifyPlugin;
  const liked = ctx.isLiked?.(tr.id) ?? false;
  const pinned = ctx.isPinned?.(tr.id) ?? false;
  const jamAdd = ctx.jamAdd;
  const toggleLike = ctx.toggleLike;
  const toggleOffline = ctx.toggleOffline;
  const downloadTrack = ctx.downloadTrack;

  // вьюшные extras плейлиста собираются заранее: разделитель ставится только
  // если из-под гейтов canEdit/canChangeIcon хоть что-то выжило (viewer — ничего)
  const playlistExtras: MenuItem[] =
    ctl && place === "playlist"
      ? [
          ...(ctl.canEdit && ctl.moveToStart
            ? [{ icon: "arrow-up-to-line", label: t("menu.playlistTrack.toStart"), onClick: ctl.moveToStart }]
            : []),
          ...(ctl.canEdit && ctl.moveToEnd
            ? [{ icon: "arrow-down-to-line", label: t("menu.playlistTrack.toEnd"), onClick: ctl.moveToEnd }]
            : []),
          ...(ctl.canChangeIcon && ctl.changeIcon
            ? [{ icon: "image", label: t("views.playlist.changePlaylistIcon"), onClick: ctl.changeIcon }]
            : []),
          ...(ctl.canEdit && ctl.replaceVersion
            ? [{ icon: "refresh-cw", label: t("menu.catalog.replaceVersion"), onClick: ctl.replaceVersion }]
            : []),
          ...(ctl.canEdit && ctl.removeTrack
            ? [{ icon: "list-x", label: t("views.playlist.removeFromPlaylist"), onClick: ctl.removeTrack }]
            : []),
        ]
      : [];

  return [
    ...(place !== "player" && ctx.playNext
      ? [{ icon: "list-start", label: t("menu.catalog.playNext"), onClick: () => ctx.playNext?.(tr) }]
      : []),
    ...(place !== "player" && ctx.queueTrack
      ? [{ icon: "list-end", label: t("menu.catalog.queue"), onClick: () => ctx.queueTrack?.(tr) }]
      : []),
    // ⚠️ «Радио по треку» УБРАНО ИЗ МЕНЮ 13.08 (решение владельца: «это вообще
    //    никто не использует»). Умение startRadio НЕ удалено — см. блок
    //    «ЧТО ОСТАЛОСЬ ЖИВЫМ» в шапке файла.
    ...(ctx.addToPlaylist
      ? [{ icon: "plus", label: t("menu.addToPlaylist"), onClick: () => ctx.addToPlaylist?.(tr) }]
      : []),
    ...(toggleLike
      ? [
          {
            icon: liked ? "heart-off" : "heart",
            label: liked ? t("menu.catalog.unlike") : t("menu.catalog.like"),
            onClick: () => toggleLike(tr.id),
          },
        ]
      : []),
    ...(jamAdd ? [{ icon: "radio-tower", label: t("menu.catalog.addToJam"), onClick: () => jamAdd(tr) }] : []),
    // ⚠️ «Поделиться» УБРАНО ИЗ МЕНЮ 13.08. Пункт открывал ShareDialog, а тот
    //    отдаёт КАРТИНКУ трека (canvas-PNG). Владелец: «если делиться, то
    //    буквально самим треком или ссылкой на него». Ссылки на трек в продукте
    //    нет ВООБЩЕ (см. блок «ЧТО ОСТАЛОСЬ ЖИВЫМ»), поэтому пункт снят целиком,
    //    а не переделан: чинить нечего, пока нечем делиться.
    ...(ctx.showVersions
      ? [{ icon: "git-branch", label: t("menu.catalog.versions"), onClick: () => ctx.showVersions?.(tr) }]
      : []),
    ...(place === "favorites" && ctx.replaceInFavorites
      ? [{ icon: "refresh-cw", label: t("menu.catalog.replaceVersion"), onClick: () => ctx.replaceInFavorites?.(tr) }]
      : []),
    // ⚠️ «Сохранить офлайн» УБРАНО ИЗ МЕНЮ ТРЕКА 13.08 (решение владельца: файл
    //    и так достаётся перетаскиванием трека на рабочий стол).
    //
    //    НО ВЫХОД ОСТАВЛЕН: ветка «Убрать из офлайна» показывается, когда трек
    //    УЖЕ сохранён. Это не полумера, а единственный способ не запереть
    //    человека: списка сохранённого в интерфейсе НЕТ ВООБЩЕ (isPinned читает
    //    только это меню, экрана «офлайн» не существует), и сняв пункт целиком,
    //    мы отняли бы у всех, кто успел что-то сохранить, любой способ это
    //    отменить. Пункт-вход исчез, пункт-выход живёт, пока живут пины.
    //    Сохранить пачкой по-прежнему можно из панели выделения (pinMany).
    ...(toggleOffline && pinned
      ? [
          {
            icon: "cloud-off",
            label: t("menu.catalog.removeOffline"),
            onClick: () => toggleOffline(tr),
          },
        ]
      : []),
    ...(downloadTrack
      ? [{ icon: "download", label: t("common.download"), onClick: () => downloadTrack(tr) }]
      : []),
    ...(playlistExtras.length ? (["-"] as const) : []),
    ...playlistExtras,
    ...(pluginItems.length ? (["-"] as const) : []),
    ...pluginItems.map((mi) => ({
      icon: mi.icon || "puzzle",
      label: mi.title,
      onClick: () => notifyPlugin?.(mi.pluginId, mi.slotId, { id: tr.id, title: tr.title, artist: tr.artist }),
    })),
  ];
}

/** Меню трека в ОЧЕРЕДИ: операции по id (PlayerTrack не возит каталожную
 *  форму); «В Любимое» — только каталожным трекам, локальный без серверного
 *  id лайкать некуда. */
function queueTrackItems(target: Extract<ContextTarget, { kind: "queueTrack" }>, ctx: MenuAbilities, t: T): MenuItem[] {
  const { track: tr, ctl } = target;
  const liked = ctx.isLiked?.(tr.id) ?? false;
  const toggleLike = ctx.toggleLike;
  return [
    { icon: "play", label: t("menu.queue.play"), onClick: ctl.play },
    { icon: "list-start", label: t("menu.queue.playNext"), onClick: ctl.playNext, disabled: !ctl.canPlayNext },
    ...(tr.kind === "catalog" && toggleLike
      ? [
          {
            icon: liked ? "heart-off" : "heart",
            label: liked ? t("menu.catalog.unlike") : t("menu.catalog.like"),
            onClick: () => toggleLike(tr.id),
          },
        ]
      : []),
    "-",
    { icon: "list-x", label: t("menu.queue.remove"), onClick: ctl.remove },
    { icon: "eraser", label: t("menu.queue.clearAfter"), onClick: ctl.clearAfter, disabled: !ctl.canClearAfter },
  ];
}

/** Меню плейлиста (сайдбар/плитка медиатеки): игровые действия — всем ролям,
 *  владельческие пункты — только owner; подписке — «Убрать из библиотеки».
 *  Разделители зависят от НЕПУСТОТЫ групп: в браузере половины умений нет, и
 *  «висящая» полоска между пустыми группами выглядела бы сбоем. */
function playlistItems(pl: { id: string; name: string }, ctx: MenuAbilities, t: T): MenuItem[] {
  const role = ctx.playlistRole?.(pl.id) ?? "owner";
  const pluginItems = ctx.pluginMenuItems?.("playlist") ?? [];
  const notifyPlugin = ctx.notifyPlugin;

  const open: MenuItem[] = [
    ...(ctx.openPlaylist ? [{ icon: "list-music", label: t("menu.playlist.open"), onClick: () => ctx.openPlaylist?.(pl.id) }] : []),
    ...(ctx.playPlaylist ? [{ icon: "play", label: t("menu.playlist.play"), onClick: () => ctx.playPlaylist?.(pl.id) }] : []),
    ...(ctx.queuePlaylistNext
      ? [{ icon: "list-start", label: t("menu.playlist.playNext"), onClick: () => ctx.queuePlaylistNext?.(pl.id) }]
      : []),
    ...(ctx.queuePlaylist ? [{ icon: "list-end", label: t("menu.playlist.queue"), onClick: () => ctx.queuePlaylist?.(pl.id) }] : []),
  ];

  const card: MenuItem[] = [
    // ⚠️ «Поделиться» УБРАНО И ЗДЕСЬ 13.08 — той же правкой, что у трека, и по
    //    той же причине: sharePlaylist открывает ShareDialog, то есть отдаёт
    //    КАРТИНКУ плейлиста. Расходиться этим двум пунктам нельзя: болезнь у
    //    них одна, и «у трека убрали, у плейлиста осталось» читалось бы как
    //    недоделка, а не как решение.
    //    ⚠️ НЕ ПУТАТЬ с настоящим шерингом плейлиста: право ЧТЕНИЯ раздаёт
    //    ShareVisibilityDialog (лесенка private → код → public + @адрес), и он
    //    открывается СО СТРАНИЦЫ плейлиста, а не отсюда. Он не тронут.
    ...(ctx.savePlaylistOffline
      ? [{ icon: "download", label: t("menu.catalog.saveOffline"), onClick: () => ctx.savePlaylistOffline?.(pl.id) }]
      : []),
    ...(role === "owner" && ctx.togglePlaylistPinned
      ? [
          // закреп сверху списка (НЕ офлайн): фиксирует от случайного сдвига/дропа
          ctx.playlistPinned?.(pl.id)
            ? { icon: "pin-off", label: t("menu.playlist.unpin"), onClick: () => ctx.togglePlaylistPinned?.(pl.id) }
            : { icon: "pin", label: t("menu.playlist.pin"), onClick: () => ctx.togglePlaylistPinned?.(pl.id) },
        ]
      : []),
    ...(role === "owner" && ctx.renamePlaylist
      ? [{ icon: "pencil", label: t("menu.playlist.rename"), onClick: () => ctx.renamePlaylist?.(pl) }]
      : []),
    ...(role === "owner" && ctx.changePlaylistIcon
      ? [{ icon: "image", label: t("menu.playlist.changeIcon"), onClick: () => ctx.changePlaylistIcon?.(pl.id) }]
      : []),
  ];

  const destructive: MenuItem[] = [
    ...(role === "owner" && ctx.deletePlaylist
      ? [{ icon: "trash-2", label: t("menu.playlist.delete"), danger: true, onClick: () => ctx.deletePlaylist?.(pl) }]
      : []),
    ...(role === "follower" && ctx.unfollowPlaylist
      ? [{ icon: "list-x", label: t("menu.playlist.unfollow"), onClick: () => ctx.unfollowPlaylist?.(pl) }]
      : []),
  ];

  return [
    ...open,
    ...(open.length && card.length ? (["-"] as const) : []),
    ...card,
    ...((open.length || card.length) && destructive.length ? (["-"] as const) : []),
    ...destructive,
    ...(pluginItems.length ? (["-"] as const) : []),
    ...pluginItems.map((mi) => ({
      icon: mi.icon || "puzzle",
      label: mi.title,
      onClick: () => notifyPlugin?.(mi.pluginId, mi.slotId, { id: pl.id, name: pl.name }),
    })),
  ];
}

/** ПКМ по пустому месту медиатеки: всё, что раньше пряталось по кнопкам шапки
 *  и сайдбару, плюс вход в выбор плиток. Показывается только серверной
 *  сессии (LibraryView гейтит): анониму нечего предложить, а пустое меню
 *  хуже, чем ничего. */
function libraryBlankItems(
  ctl: Extract<ContextTarget, { kind: "libraryBlank" }>["ctl"],
  ctx: MenuAbilities,
  t: T,
): MenuItem[] {
  const head: MenuItem[] = [
    ...(ctx.openCreatePlaylist
      ? [{ icon: "plus", label: t("menu.library.createPlaylist"), onClick: ctx.openCreatePlaylist }]
      : []),
    ...(ctx.openAddLink ? [{ icon: "link", label: t("menu.library.addLink"), onClick: ctx.openAddLink }] : []),
    ...(ctx.openImport ? [{ icon: "import", label: t("menu.library.importPlaylist"), onClick: ctx.openImport }] : []),
    ...(ctx.openJoinCode ? [{ icon: "key-round", label: t("menu.library.joinCode"), onClick: ctx.openJoinCode }] : []),
  ];
  return [
    ...head,
    ...(ctl
      ? ([
          ...(head.length ? (["-"] as const) : []),
          { icon: "square-check-big", label: t("menu.selection.enterPlaylists"), onClick: ctl.enterSelect },
          { icon: "list-checks", label: t("menu.selection.all"), onClick: ctl.selectAll },
        ] as const)
      : []),
  ];
}

/** Меню локального файла (медиатека → «Локальные»). */
function localTrackItems(ctl: Extract<ContextTarget, { kind: "localTrack" }>["ctl"], t: T): MenuItem[] {
  return [
    ...(ctl.addToPlaylist
      ? [{ icon: "plus", label: t("menu.addToPlaylist"), onClick: ctl.addToPlaylist }]
      : []),
    ...(ctl.reveal
      ? [{ icon: "folder-open", label: t("menu.library.showInFolder"), onClick: ctl.reveal }]
      : []),
    { icon: "trash-2", label: t("views.library.removeFromMuza"), onClick: ctl.forget },
  ];
}
