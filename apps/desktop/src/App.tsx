import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Icon, SearchInput, Toast, Tooltip } from "@muza/ui";
import { pickRandomPlaylistIcon, playlistIconSrc } from "@muza/core";
import {
  HttpMuzaApi,
  resolveApiBaseUrl,
  type MuzaApi,
  type PlaylistMeta,
  type Session,
  type Track as CatalogTrack,
} from "@muza/api-client";
import { type Prefs, type View } from "./types";
import { loadPrefs, PREFS_KEY } from "@muza/app/prefs/load";
import { usePrefsSync } from "@muza/app/prefs/usePrefsSync";
import { DEFAULT_PLAYER_STATE, loadPlayerState, savePlayerState } from "@muza/app/lib/playerState";
// Общий движок темы: профиль настроек → CSS-переменные корня, одни и те же
// формулы у приложения и у веба (см. шапку themeVars.ts).
import { buildThemeVars } from "@muza/app/theme/themeVars";
import { backdropViewFromPrefs } from "@muza/app/prefs/backdrop";
import { useViewTransition } from "@muza/app/shell/useViewTransition";
import { LanguageProvider, translate, type TParams, type TranslationKey } from "./i18n";
import { compactForAuth, expandAfterAuth, shouldAnimateStage } from "./lib/authWindowStage";
import { devApiHost } from "./lib/devApiHost";
import { dominantColor } from "./lib/coverTint";
import { applySourcePolicy } from "./lib/sources";
import { resumeStore } from "./lib/resumeStore";
import { miniHide, miniListen, miniSendState, miniShow, type MiniCommand, type MiniState } from "./lib/miniBridge";
import { useMediaQuery } from "./lib/useMediaQuery";
import { useWindowVisible } from "./lib/windowVisible";
import { applyRecipe, engineAvailable, enginePin, enginePins, resolvePlayable, setCacheLimit } from "./lib/engine";
import { exportCachedTrack } from "./lib/dragOut";
import { syncAutostart, trayConfigure } from "./lib/system";
import { autoCheckForUpdate, UPDATE_CHECK_INTERVAL_MS } from "./lib/updater";
import { setSnapshotScope, withSnapshot } from "./lib/offlineSnapshot";
import { clearDiscordActivity, discordCoverUrl, formatTemplate, updateDiscordActivity } from "./lib/discord";
import { useTelemetry, type PlayCounters } from "./lib/useTelemetry";
import { useErrorTelemetry } from "./lib/useErrorTelemetry";
import { useVisitPing } from "./lib/useVisitPing";
import { useCoverArt } from "./lib/coverArt";
import { moveItem } from "./lib/dragEngine";
import { comboFromEvent, matchAction, formatCombo, HOTKEY_ACTIONS, hotkeyActionLabel } from "./lib/hotkeys";
import {
  canGoBack,
  canGoForward,
  createHistory,
  currentEntry,
  goBack,
  goForward,
  pushHistory,
  type HistoryEntry,
  type HistoryPayload,
  type HistoryState,
} from "./lib/historyStack";
import { loadServerIds, localScanPaths, registerLocalTracks, type LocalEntry } from "./lib/localFiles";
import { usePlayback } from "./player/usePlayback";
// Позиция воспроизведения живёт ВНЕ состояния React (03.08). Почему именно
// так и что ломает наивная версия — в шапке player/positionStore.ts.
import { DerivedPositionScope, PositionScope } from "./player/positionStore";
import { activeLyricLine } from "./player/activeLine";
import { useWarmer, WarmerProvider } from "./player/useWarmer";
import { useWheelScroll } from "./lib/useWheelScroll";
import { applyCustomFont } from "./lib/customFont";
import { useLyrics } from "./player/useLyrics";
import { useTrackVideo } from "./player/useTrackVideo";
import { useAnnotations } from "./player/useAnnotations";
import { decorateLyrics, shouldFetchAnnotations } from "./player/annotations";
import { useMediaSession } from "./player/useMediaSession";
import { useJam } from "./player/useJam";
import { fromCatalog, fromLocalEntry, toCatalog, type PlayerTrack } from "./player/types";
import type { ShareData } from "./lib/shareCard";
import { LoginScreen } from "./auth/LoginScreen";
import { Sidebar, type SidebarUpdate } from "./shell/Sidebar";
import { favoritesDropAction } from "./shell/favoritesDrop";
import { NowPlayingPanel } from "./shell/NowPlayingPanel";
import { LookEditLayer } from "@muza/app/shell/LookEditLayer";
import { LookEditProvider, type LookEditApi } from "@muza/app/shell/lookReorder";
import { normalizeHomeSections } from "@muza/app/lib/homeSections";
import { PlayerBar } from "./shell/PlayerBar";
import { QueuePanel } from "./shell/QueuePanel";
import { ListeningMode } from "./shell/ListeningMode";
import { MeaningDialog } from "./shell/MeaningDialog";
import { VersionsDialog } from "./shell/VersionsDialog";
import { ReplaceVersionDialog, type ReplaceCtx } from "./shell/ReplaceVersionDialog";
import { DragLayer } from "./shell/DragLayer";
// Своя полоса заголовка вместо системной рамки Windows (03.08). Сам компонент
// общий и про Tauri не знает — действия окна ему передаём отсюда, из
// lib/windowControls.ts. Почему у окна ОБЯЗАН стоять shadow:true — в шапке
// packages/app/src/shell/TitleBar.tsx (углы + зоны изменения размера).
import { TitleBar } from "@muza/app/shell/TitleBar";
import { closeWindow, minimizeWindow, toggleMaximizeWindow, useMaximized } from "./lib/windowControls";
import { ErrorBoundary, ViewCrash } from "./shell/ErrorBoundary";
import { ContextMenuProvider, type ContextMenuApi } from "./shell/ContextMenu";
import type { MenuContext } from "./shell/menuActions";
import { AddLinkDialog } from "./shell/AddLinkDialog";
import { ImportDialog } from "./shell/ImportDialog";
import { JamDialog } from "./shell/JamDialog";
import { JoinPlaylistDialog } from "./shell/JoinPlaylistDialog";
import { PlaylistIconPicker } from "@muza/app";
import { PlatformProvider } from "@muza/app/platform";
import { createDesktopPlatform } from "./platform/desktopAdapter";
import { ShareDialog } from "./shell/ShareDialog";
import { HomeFeed } from "./views/HomeFeed";
import { SearchView } from "./views/SearchView";
import { ExternalPlaylistView } from "./views/ExternalPlaylistView";
import { FavoritesView } from "./views/FavoritesView";
import { PlaylistView } from "./views/PlaylistView";
import { LibraryView } from "./views/LibraryView";
import { AdminView } from "./views/AdminView";
import { SettingsView, type SettingsIntent } from "./views/SettingsView";
import { StatsView } from "./views/StatsView";
import { WrappedOverlay } from "./views/WrappedOverlay";
import { usePlugins } from "./plugins/usePlugins";
import { PluginFrames } from "./plugins/PluginFrames";
import { pluginHost } from "./plugins/host";
import { createPluginBridge, type PluginBridgeLive } from "./plugins/appBridge";

/** ПРИХОД И УХОД «СЕЙЧАС ИГРАЕТ». Держим кадры здесь, а не в animations.css:
 *  панель приходит и уходит только в оболочке приложения, дизайн-системе это
 *  движение не нужно. Двигаем ТОЛЬКО transform и opacity — оба свойства
 *  композитор считает без пересчёта раскладки, и панель не дёргает соседей.
 *
 *  ⚠️ Своё имя кадров осталось с тех пор, когда общий кадр muzaMenuIn жил ВНУТРИ
 *  смонтированного <Menu> и молча не играл, пока меню закрыто. Самого muzaMenuIn
 *  больше нет (снят 2026-08-05 вместе с последними потребителями), а эта панель
 *  до сих пор на кейфреймах, а не на .muza-layer — переезд не сделан, потому что
 *  у неё две несимметричные позы (вход с 24px, уход на 110%) и своя страховка
 *  закрытия. Возьмётесь переводить — .muza-layer--panel умеет ровно это.
 *
 *  Уменьшенное движение гасит переход полностью: base.css сводит длительность к
 *  1мс, но `forwards` у ухода оставил бы панель уехавшей — поэтому правило ниже
 *  снимает анимацию совсем, а само закрытие в этом режиме идёт без ожидания
 *  (см. reducedMotion в блоке npClosing). */
const NOWPLAYING_ANIM_CSS =
  "@keyframes muzaNowPlayingIn{from{opacity:0;transform:translateX(24px)}}" +
  "@keyframes muzaNowPlayingOut{to{opacity:0;transform:translateX(110%)}}" +
  '@media (prefers-reduced-motion: reduce){[data-zone="nowplaying"]{animation:none!important}}';

/** Э2 веб-паритета (2026-08-02): вилка площадки вставляется в самом корне —
 *  ВЫШЕ экрана входа (умения площадки от входа не зависят) и выше языка.
 *  Обёртка ничего не рисует: в дереве появляется только провайдер контекста,
 *  ни одного DOM-узла, ни одного стиля — картинка приложения не меняется. */
export function App() {
  // Один раз за жизнь окна: вилка спрашивает у площадки, что она умеет.
  const platform = useMemo(() => createDesktopPlatform(), []);
  return (
    <PlatformProvider adapter={platform}>
      <AppRoot />
    </PlatformProvider>
  );
}

function AppRoot() {
  const apiBaseUrl = useMemo(
    () =>
      resolveApiBaseUrl(
        import.meta.env.VITE_API_URL,
        import.meta.env.PROD ? "production" : "development",
        import.meta.env.DEV ? "http://localhost:8000/api" : undefined,
      ),
    [],
  );
  const api = useMemo(() => new HttpMuzaApi(apiBaseUrl), [apiBaseUrl]);
  // Дев-сборке подписываем бэкенд в диалогах ввода кода: коды плейлиста и jam
  // живут в базе КОНКРЕТНОГО сервера и с прода на локалхост не переезжают.
  const apiHost = useMemo(() => devApiHost(apiBaseUrl, import.meta.env.DEV), [apiBaseUrl]);
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);

  // Сцены окна: на входе оно размером с карточку, после входа разворачивается
  // во все стороны (заказ владельца 03.08; механика — lib/authWindowStage.ts и
  // src-tauri/src/window_stage.rs).
  //
  // Разворачиваем ТОЛЬКО если экран входа в этом запуске реально показывали.
  // Простого «появилась сессия» мало: у вошедшего человека она появляется и на
  // старте, после восстановления, — и окно дёргалось бы анимацией при каждом
  // запуске, хотя оно уже нужного размера (поймано тестом, а не глазами).
  //
  // Пока restoring — не трогаем вовсе: сжать окно на долю секунды ради мигания
  // нельзя, а разворачивать ещё нечего.
  const sawLoginRef = useRef(false);
  useEffect(() => {
    if (restoring) return;
    if (!session) {
      sawLoginRef.current = true;
      void compactForAuth();
      return;
    }
    if (sawLoginRef.current) {
      sawLoginRef.current = false;
      void expandAfterAuth(shouldAnimateStage(loadPrefs().anims));
    }
  }, [session, restoring]);

  useEffect(() => {
    // Отзыв входа на ходу: старт больше не ходит в сеть, поэтому просроченный
    // вход вскрывается первым же 401. Без этого окно оставалось бы
    // «залогиненным» с падающими запросами до перезапуска (поймано живым
    // запуском 20.07 — «сервер недоступен» на каждой ленте).
    api.onSessionRevoked(() => setSession(null));
    api
      .restoreSession()
      .then((s) => setSession(s))
      // Ремень безопасности: отказ здесь раньше подвешивал restoring
      // навсегда — ЧЁРНЫЙ ЭКРАН вместо приложения (сейчас restoreSession
      // локальный и не бросает, но экран входа лучше вечной пустоты)
      .catch(() => setSession(null))
      .finally(() => setRestoring(false));
  }, [api]);

  // ПОЛОСА ЗАГОЛОВКА ДО ВХОДА (жалоба владельца 04.08: «на странице логина нет
  // кнопок закрыть и свернуть, и перетаскивать окно там нельзя»).
  //
  // Причина была в ранних возвратах ниже: до появления сессии AppRoot отдавал
  // LoginScreen (или пустую заливку на время восстановления) МИМО всей
  // оболочки, а полоса заголовка живёт внутри Player. Окно у нас без системной
  // рамки (tauri.conf.json: decorations false) — значит без неё у человека нет
  // ни кнопок, ни области перетаскивания вообще. Закрыть приложение с экрана
  // входа было можно только с панели задач.
  //
  // Отдельная полоса, а не вынос Player: до входа нет ни настроек темы, ни
  // сессии, и тащить сюда оболочку целиком значит тащить и всё, что она грузит.
  // Язык берём из сохранённого профиля — подписи кнопок окна переводятся.
  // Живой признак «развёрнуто», как у полосы внутри Player: захардкоженный
  // false показывал на развёрнутом окне глиф «развернуть» вместо
  // «восстановить» (ревизия 04.08).
  const authMaximized = useMaximized();
  const authTitleBar = (
    <LanguageProvider lang={loadPrefs().language}>
      <TitleBar
        maximized={authMaximized}
        onMinimize={minimizeWindow}
        onToggleMaximize={toggleMaximizeWindow}
        onClose={closeWindow}
      />
    </LanguageProvider>
  );

  if (restoring) {
    // Провал в первые миллисекунды запуска — тот же самый: окно уже нарисовано,
    // а управлять им нечем.
    return (
      <div style={{ position: "absolute", inset: 0, background: "var(--bg-0)" }}>{authTitleBar}</div>
    );
  }
  if (!session) {
    return (
      <>
      {authTitleBar}
      <LoginScreen
        api={api}
        onSession={setSession}
        lang={loadPrefs().language}
        // Выбор «анонимная статистика» при создании аккаунта → prefs.telemetry
        // ДО монтирования Player (он читает prefs один раз, loadPrefs в useState)
        onTelemetry={(enabled) => {
          localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), telemetry: enabled }));
        }}
      />
      </>
    );
  }
  return (
    <Player
      api={api}
      apiHost={apiHost}
      userId={session.user.id}
      canSearch={!session.user.anonymous}
      greetName={session.user.anonymous ? null : session.user.username}
      isAnonymous={session.user.anonymous}
      rawUsername={session.user.anonymous ? null : (session.user.username ?? "")}
      onLogout={async () => {
        await api.logout();
        setSession(null);
      }}
    />
  );
}

/* PREFS_KEY и loadPrefs переехали в @muza/app (`@muza/app/prefs/load`, импорт
 * наверху файла): тем же ключом `muza.prefs.v1` и с теми же миграциями теперь
 * читает профиль веб-клиент. Вторая реализация слияния означала бы, что часть
 * миграций в браузере не отрабатывает и человек теряет оформление. Поведение
 * здесь не изменилось ни на шаг — имена оставлены прежними намеренно, чтобы у
 * пяти мест вызова не было диффа. */

/* Таблицы оформления (пресеты базового фона, шкала радиусов, дефолтные
   --bg-0/1, формулы плотности и кривые движения) жили здесь до 2026-08-02 и
   уехали В ОДНОМ ЭКЗЕМПЛЯРЕ в общий движок темы — packages/app/src/theme/
   themeVars.ts. Здесь они больше не нужны: rootStyle собирает buildThemeVars. */

/** Восстановление плеера при старте (T2: защита от «песни сами играют»).
 *  Плеер НИКОГДА не стартует играющим сам (usePlayback.playing начинается с
 *  false) — здесь решаем только ЧТО показать «готовым»: если владелец включил
 *  «Запоминать позицию трека» и есть последний активный трек — очередь из
 *  него на сохранённой позиции; иначе — пусто.
 *  Раньше «иначе» подставляло демо-очередь Stage 1 на 0:24, и КАЖДЫЙ новый
 *  пользователь видел в баре чужую выдуманную песню как якобы свою. */
function initialPlaybackState(): { queue: PlayerTrack[]; pos: number } {
  const prefs = loadPrefs();
  if (prefs.resumePosition) {
    const last = resumeStore.getLast();
    if (last) {
      const saved = resumeStore.get(last.id);
      return { queue: [last], pos: saved > 0 ? saved : 0 };
    }
  }
  return { queue: [], pos: 0 };
}

/** Каркас плеера. Stage 3: реальное воспроизведение каталожных треков
 *  (добыча на своём IP → LRU-кэш → Web Audio) и локальных файлов с диска. */
function Player({
  api,
  apiHost,
  userId,
  canSearch,
  greetName,
  isAnonymous,
  rawUsername,
  onLogout,
}: {
  api: MuzaApi;
  /** Хост API в дев-сборке (в проде null) — подпись в диалогах ввода кода:
   *  коды плейлиста и jam живут в базе конкретного сервера. См. lib/devApiHost.ts. */
  apiHost: string | null;
  /** id пользователя — скоуп оффлайн-снапшотов (чужая библиотека не светится). */
  userId: string;
  canSearch: boolean;
  /** Ник для приветствия на главной; null у анонима. */
  greetName: string | null;
  isAnonymous: boolean;
  /** Ник аккаунта; null у анонима — «Аноним (без синхронизации)» подставляется
   *  через t() ниже (App() не знает языка — читается из Prefs внутри Player). */
  rawUsername: string | null;
  onLogout: () => void;
}) {
  // Скоуп снапшотов — до первых загрузок (эффекты ниже читают через
  // withSnapshot), поэтому именно в теле рендера, а не в эффекте.
  // ⚠️ Но РОВНО ОДИН РАЗ на userId: внутри полный обход ключей localStorage
  // (выметание чужих снапшотов старого формата), а Player перерисовывается
  // несколько раз в секунду от тика позиции — до 02.08 это был обход всего
  // хранилища на каждый тик.
  const scopedForRef = useRef<string | null>(null);
  if (scopedForRef.current !== userId) {
    scopedForRef.current = userId;
    setSnapshotScope(userId);
  }
  // Стартовый экран — из prefs (Stage 6, «Поведение»)
  const [view, setView] = useState<View>(() => loadPrefs().startView);
  /** ПЕРЕХОД МЕЖДУ ЭКРАНАМИ: `view` — что человек выбрал, `rendered` — что
   *  сейчас нарисовано. Во время ухода они расходятся, и это НАМЕРЕННО: сайдбар
   *  подсвечивает выбор в тот же кадр (нажатие обязано отзываться сразу), а
   *  содержимое доигрывает своё затухание. Разбор — shell/useViewTransition.ts. */
  const viewFade = useViewTransition(view);
  const rendered = viewFade.rendered;
  // Пусто, пока не приедут серверные фавориты (эффект ниже). Раньше тут был
  // захардкоженный лайк демо-трека "t3", и, поскольку серверные фавориты
  // только МЕРЖАТСЯ в этот список, убрать его из «Любимого» было нельзя.
  const [likes, setLikes] = useState<string[]>([]);
  // Запрос открыть конкретный под-экран настроек (кнопка эквалайзера в баре)
  const [settingsIntent, setSettingsIntent] = useState<SettingsIntent | null>(null);
  // Заявка одноразовая: SettingsView гасит её сразу после того, как открыл
  // нужный под-экран. Стабильная ссылка — иначе эффект-исполнитель в
  // SettingsView перезапускался бы каждым рендером App.
  const clearSettingsIntent = useCallback(() => setSettingsIntent(null), []);
  const [lyricsOn, setLyricsOn] = useState(true);
  /** Режим правки вида (Ctrl+E) — см. shell/LookEditLayer.tsx. Живёт здесь, а
   *  не в prefs: это не настройка, а состояние сеанса; после перезапуска
   *  человек должен получить обычное приложение, а не чертёж. */
  const [lookEdit, setLookEdit] = useState(false);
  /** Доступ к общему стеку отмены режима правки СНИЗУ ВВЕРХ: провайдер стоит
   *  внутри этого же компонента, хуком до него не дотянуться (та же причина и
   *  тот же приём, что у menuApiRef). Нужен там, где порядок пишет сам App —
   *  полки Главной. */
  const lookEditRef = useRef<LookEditApi | null>(null);
  // Ctrl+E открывает и закрывает правку вида. Ловим на захвате и только с
  // модификатором: одиночная «E» обязана печататься в полях ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "KeyE") {
        // ⚠️ СТОРОЖ ПОЛЯ ВВОДА. Ctrl+E был единственным глобальным сочетанием в
        // приложении без него: набирая текст в поиске, названии плейлиста или
        // в редакторе своего CSS, человек ловил переход в режим правки вида —
        // и терял то, что печатал. Остальные сочетания такую проверку делают
        // (см. isTypingTarget), это упущение новой функции, а не правило.
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
        e.preventDefault();
        setLookEdit((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const [queueOn, setQueueOn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Для mouseup-слушателя боковых кнопок мыши (висит с маунта, deps []):
  // expanded из его замыкания навсегда остался бы false — только через ref.
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  const [meaningLine, setMeaningLine] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [plName, setPlName] = useState("");
  // Слайс 4: серверные плейлисты и открытая страница плейлиста
  const [srvPlaylists, setSrvPlaylists] = useState<PlaylistMeta[]>([]);
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  // read-only страница плейлиста SoundCloud из выдачи (2026-07-20)
  const [openScPlaylistId, setOpenScPlaylistId] = useState<string | null>(null);
  // Текст поиска — на уровне App (2026-07-20, жалоба владельца): «назад»
  // боковой кнопкой мыши из плейлиста возвращал ПУСТОЙ поиск — запрос жил в
  // SearchView и умирал с размонтированием вью при уходе на плейлист.
  const [searchQuery, setSearchQuery] = useState("");
  // T16: история переходов между вкладками (Alt+←/→, боковые кнопки мыши) —
  // чистый стек в lib/historyStack; ref, а не state — сама история не рендерит
  // UI (кнопок «назад»/«вперёд» нет), нужна только актуальность в колбэках.
  const historyRef = useRef<HistoryState<View>>(createHistory<View>({ view }));
  // выбор плейлиста для «В плейлист»: массив с 2026-07-20 — мультивыбор
  // кладёт пачку одним диалогом; одиночный путь — массив из одного
  const [plPick, setPlPick] = useState<CatalogTrack[] | null>(null);
  // Контекстные меню (2026-07-20): транспорт и пункты уехали в
  // shell/ContextMenu.tsx + shell/menuActions.ts — App снаружи провайдера
  // (сам его рендерит), поэтому его колбэки открывают меню через ref.
  const menuApiRef = useRef<ContextMenuApi | null>(null);
  const [versionsTrack, setVersionsTrack] = useState<CatalogTrack | null>(null);
  // «Заменить версию» (2026-07-18): трек + где заменяем (плейлист/Любимое)
  const [replaceCtx, setReplaceCtx] = useState<ReplaceCtx | null>(null);
  // Stage 4: «Добавить по ссылке» (прямые источники) и импорт плейлистов
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Stage 7: соц — вход по коду, Jam, шеринг-карточка, Wrapped
  const [joinOpen, setJoinOpen] = useState(false);
  const [jamOpen, setJamOpen] = useState(false);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [wrappedOpen, setWrappedOpen] = useState(false);
  const [toast, setToast] = useState<{
    open: boolean;
    text: string;
    icon: string;
    /** Кнопка в тосте (undo удаления из очереди и т.п.). */
    actionLabel?: string;
    onAction?: () => void;
  }>({ open: false, text: "", icon: "check" });
  // T17: диалоги переименования/удаления плейлиста на уровне App (страница
  // плейлиста может быть не открыта — её диалоги не переиспользовать)
  const [plRename, setPlRename] = useState<{ id: string; name: string } | null>(null);
  const [plRenameValue, setPlRenameValue] = useState("");
  const [plDelete, setPlDelete] = useState<{ id: string; name: string } | null>(null);
  // переименование открытого прямо сейчас плейлиста: bump ремоунтит PlaylistView,
  // чтобы шапка перечитала имя (сама страница о переименовании извне не знает)
  const [plBump, setPlBump] = useState(0);
  // T47b: пикер иконки плейлиста — открывается ПКМ на плейлисте (сайдбар/медиатека)
  // ИЛИ ПКМ на треке внутри PlaylistView; id — независимо от того, что сейчас открыто.
  // T47c: coverTile — обложка кликнутого трека первой плиткой пикера (value =
  // "track:<id>" для сервера, src — что рисовать; null = открыт не с трека).
  const [iconPicker, setIconPicker] = useState<{
    id: string;
    icon: string | null;
    coverTile: { value: string; src: string } | null;
  } | null>(null);
  const [iconPickerBusy, setIconPickerBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Таймер тоста переживал размонтирование (02.08): вылет из аккаунта или
  // перезаход снимает Player, а через 2.4с сработавший setTimeout звал
  // setToast на мёртвом компоненте — предупреждение React и удержанное
  // замыкание. Снимаем при размонтировании.
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  // Кастомизация переживает перезапуск: без этого все настройки слетали
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  };
  /** ОДИН ПРОФИЛЬ НА АККАУНТ, общий с браузером (разбор — @muza/app
   *  prefs/sync.ts). До 11.08 профиля было два и они не знали друг о друге:
   *  настроенный здесь вид в вебе не появлялся.
   *
   *  У анонима синхронизации нет: аккаунт-на-устройстве на то и локальный, а
   *  серверного профиля у него не существует. Настройки при этом работают
   *  ровно как раньше — просто никуда не уезжают.
   *
   *  `ready` не передаём: профиль поднимается синхронно в `useState(loadPrefs)`,
   *  то есть к первому же кадру он настоящий, а не дефолтный. */
  usePrefsSync({ api, signedIn: !isAnonymous, prefs, applyPrefs: setPrefs });
  // T31 (i18n): Player — сам родитель <LanguageProvider> (см. return ниже),
  // поэтому useT() внутри тела Player читал бы контекст СНАРУЖИ своего же
  // провайдера (фолбэк на DEFAULT_LANG) — вместо хука зовём чистую translate()
  // напрямую с prefs.language, которая уже есть в стейте Player.
  const t = (key: TranslationKey, params?: TParams) => translate(prefs.language, key, params);
  const username = isAnonymous ? t("app.anonymousUsername") : (rawUsername ?? "");

  // Jam-гость (Stage 7): бесконечное радио не должно спорить с хостом —
  // ref, потому что onQueueEnd замыкается при создании usePlayback
  const jamGuestRef = useRef(false);

  // T2: восстановление трека/позиции при старте, БЕЗ автозапуска (playing
  // всегда стартует false в usePlayback) — считаем один раз при монтировании
  const [initialPlayback] = useState(initialPlaybackState);

  // Реальный плеер (Stage 3): очередь-контекст, добыча, кроссфейд, EQ
  const pbRaw = usePlayback({
    api,
    initialQueue: initialPlayback.queue,
    initialPos: initialPlayback.pos,
    prefs,
    onError: (m) => showToast(m, "x"),
    // Скробблинг: каталожные прослушивания — в историю сервера
    onPlayEnd: ({ track: t, playedMs, completed }) => {
      if (!canSearch || t.kind !== "catalog") return;
      // анонимный счётчик для телеметрии (без id трека — агрегат)
      playCountersRef.current = {
        plays: playCountersRef.current.plays + 1,
        completed: playCountersRef.current.completed + (completed ? 1 : 0),
      };
      void api
        .recordPlay({ trackId: t.id, playedMs, durationMs: t.duration * 1000, completed })
        .catch(() => undefined); // best-effort: история не стоит тоста
    },
    // Бесконечное радио (Stage 5): каталожная очередь кончилась — продолжаем
    // похожими с сервера. Демо-очередь и аноним останавливаются как раньше.
    onQueueEnd: async (last) => {
      if (jamGuestRef.current) return null; // гость jam: очередью правит хост
      if (!canSearch || !prefs.radioEndless || last.kind !== "catalog" || !/^\d+$/.test(last.id)) return null;
      try {
        const radio = await api.getRadio(last.id);
        if (radio.length === 0) return null;
        showToast(t("toast.radio.continuing"), "radio");
        return radio.map(fromCatalog);
      } catch {
        return null; // сервер лёг — честная остановка очереди
      }
    },
  });
  // Анонимная агрегированная аналитика: KPI добычи + счётчик прослушиваний.
  // Stage 4: честная галочка согласия (prefs.telemetry) — выключил и не шлём.
  const playCountersRef = useRef<PlayCounters>({ plays: 0, completed: 0 });
  useTelemetry(api, canSearch && prefs.telemetry, playCountersRef);
  // Ошибки — та же галочка, но БЕЗ canSearch: эндпоинт анонимный, падения
  // до логина самые ценные (буфер копится с main.tsx, шлётся отсюда).
  useErrorTelemetry(api, prefs.telemetry);
  // Посещения: максимум один анонимный пинг в календарный день (кусок B).
  useVisitPing(api, prefs.telemetry);

  // Jam — слушать вместе (Stage 7): хост пушит состояние, гость следует
  const jam = useJam({
    api,
    enabled: canSearch,
    lang: prefs.language,
    pb: {
      track: pbRaw.track,
      // хранилище, а не число: гость ловит слышимый seek от позиции, снятой
      // на последнем рендере (см. шапку JamPlayback.posStore)
      posStore: pbRaw.posStore,
      playing: pbRaw.playing,
      speed: pbRaw.speed,
      playContext: pbRaw.playContext,
      seek: pbRaw.seek,
      pause: pbRaw.pause,
      toggle: pbRaw.toggle,
      insertInQueue: pbRaw.insertInQueue,
      queueLength: pbRaw.queue.length,
    },
    onNotify: (m, icon) => showToast(m, icon),
  });
  jamGuestRef.current = jam.active && !jam.isHost;

  // Обложка без letterbox-полос YouTube-тумбов (canvas-кроп, кэш на сессию);
  // панели/бар/фон получают уже чистую
  const cleanCover = useCoverArt(pbRaw.track?.cover ?? null);

  // Реакция фона на обложку: доминирующий цвет чищенной обложки → тонировка
  // --bg-0/1 в rootStyle. Обложка чищенная (letterbox уже срезан) — чёрные
  // полосы ytimg не перекашивают доминанту.
  const [coverTint, setCoverTint] = useState<string | null>(null);
  useEffect(() => {
    if (!prefs.bgTint || !cleanCover) {
      setCoverTint(null);
      return;
    }
    let alive = true;
    dominantColor(cleanCover).then((hex) => {
      if (alive) setCoverTint(hex);
    });
    return () => {
      alive = false;
    };
  }, [prefs.bgTint, cleanCover]);
  const pb = useMemo(
    () => ({ ...pbRaw, track: pbRaw.track ? { ...pbRaw.track, cover: cleanCover } : null }),
    [pbRaw, cleanCover],
  );
  const { track, playing, vol } = pb;
  // Позиции-числа здесь нарочно НЕТ (03.08). Пока она была обычным состоянием,
  // каждый её тик (~4 раза в секунду) перерисовывал весь этот компонент — а с
  // ним сайдбар, весь экран со строками треков, очередь, обе копии текста
  // песни и полосу плеера. Теперь значение живёт в хранилище: точное — всегда
  // (posStore.get(), для jam/мини-плеера/Discord), а подписываются на него
  // только рисующие узлы, обёрнутые в PositionScope ниже.
  // ⚠️ Не возвращать сюда `pos` и не звать здесь usePosition: любой из этих
  // способов мгновенно вернёт перерисовку всего дерева.
  const posStore = pb.posStore;

  // Режим прослушивания живёт при КОНКРЕТНОМ треке (см. условие ?: у
  // <ListeningMode/> в разметке). Когда трек уходит — убрали последний из
  // очереди прямо из полноэкранного режима — оверлей исчезает вместе с ним,
  // а expanded оставался true: следующий запуск ЛЮБОГО трека сразу выбрасывал
  // на весь экран, хотя пользователь просто нажал play (02.08).
  useEffect(() => {
    if (!track) setExpanded(false);
  }, [track]);

  // Прогрев метаданных добычи (Фаза 1): hover/видимость подают вьюхи через
  // useWarmRow (контекст ниже), очередь воспроизведения — отсюда.
  const warmer = useWarmer({ api, prefs });
  // Зона 2 спеки 19.07: скорость/плавность колеса. При дефолтах (100, выкл)
  // хук не вешает листенер — прокрутка остаётся полностью нативной.
  useWheelScroll(prefs.scrollSpeed, prefs.scrollSmooth);
  useEffect(() => {
    warmer.noteQueue(pb.queue, pb.index);
  }, [warmer, pb.queue, pb.index]);

  // ── Плагины уровня 1 (T44) ────────────────────────────────────────
  // Бридж строится один раз и читает живое состояние Player через ref
  // (обновляется ниже, перед рендером) — замыкания не устаревают.
  const pluginLiveRef = useRef<PluginBridgeLive | null>(null);
  const pluginBridge = useMemo(
    () =>
      createPluginBridge(() => {
        const live = pluginLiveRef.current;
        if (!live) throw new Error(t("app.errors.pluginBridgeNotReady"));
        return live;
      }),
    [],
  );
  const plugins = usePlugins(pluginBridge);
  const pluginTabActive = plugins.activeTab;

  // Трансляция событий приложения плагинам (host фильтрует по правам плагина).
  // Метаданные трека — без URL/токенов источников (§3.1 дока).
  const safeTrack = (t: PlayerTrack | null | undefined) =>
    t ? { id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration } : null;
  useEffect(() => {
    // null долетает и до плагинов — «ничего не играет» это тоже событие
    pluginHost.emit("track:change", safeTrack(track));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);
  useEffect(() => {
    pluginHost.emit("playback:state", { state: pb.buffering ? "loading" : playing ? "playing" : "paused" });
  }, [playing, pb.buffering]);
  // Событие «position» плагинам — целыми секундами, как и было. Подписка на
  // хранилище вместо эффекта по зависимости: рендера ради этого не нужно
  // вообще (см. positionStore.ts), а ритм остался прежним — раз в секунду.
  useEffect(() => {
    const emit = () => pluginHost.emit("position", { position: posStore.getSecond() });
    emit();
    return posStore.subscribeSecond(emit);
  }, [posStore]);
  useEffect(() => {
    pluginHost.emit("queue:change", pb.queue.map(safeTrack));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb.queue]);
  useEffect(() => {
    pluginHost.emit("like:change", { likes });
  }, [likes]);
  useEffect(() => {
    pluginHost.emit("view:change", { view });
  }, [view]);
  useEffect(() => {
    pluginHost.emit("theme:change", { theme: prefs.theme });
  }, [prefs.theme]);

  // Горячий рецепт добычи — при серверной сессии (эндпоинт под AuthGuard)
  useEffect(() => {
    if (canSearch) void applyRecipe(api);
  }, [api, canSearch]);
  // Лимит LRU-кэша движка живёт в Prefs
  useEffect(() => {
    void setCacheLimit(prefs.cacheLimitGb);
  }, [prefs.cacheLimitGb]);
  // Автозапуск с системой: prefs — источник истины, приводим ОС к нему
  useEffect(() => {
    void syncAutostart(prefs.autostart);
  }, [prefs.autostart]);
  // Трей: видимость иконки + «закрыть = свернуть» (Rust перехватывает close)
  useEffect(() => {
    void trayConfigure(prefs.tray, prefs.closeToTray);
  }, [prefs.tray, prefs.closeToTray]);
  // Размер текста: font-size на <html> масштабирует rem-токены шрифтов (только
  // текст, не отступы — те в px). rem резолвится от корня, а не от app-div.
  useEffect(() => {
    document.documentElement.style.fontSize = prefs.fontScale === 100 ? "" : `${prefs.fontScale}%`;
    return () => {
      document.documentElement.style.fontSize = "";
    };
  }, [prefs.fontScale]);

  // Серверная сессия: подтягиваем плейлисты и избранное (лайки каталожных
  // треков живут на сервере).
  // Stage 4: удачные ответы снапшотятся — без сети библиотека читается.
  const reloadServerPlaylists = async () => {
    if (!canSearch) return;
    try {
      const { data } = await withSnapshot("playlists", () => api.getPlaylists());
      setSrvPlaylists(data);
    } catch {
      /* сервер недоступен и снапшота нет — сайдбар просто не обновится */
    }
  };

  /** Реордер плейлистов (локальный drag за ручку-⠿ в сайдбаре/Библиотеке):
   *  draggedId встаёт на toIndex — splice-индекс от useLocalReorder (термины
   *  массива после изъятия элемента, см. moveItem). Оптимистично правим
   *  локальный список (сайдбар/медиатека сразу — порядок у них общий), затем
   *  шлём полный порядок на сервер; ошибка — откат перечиткой. */
  const reorderPlaylists = async (draggedId: string, toIndex: number) => {
    let nextIds: string[] = [];
    setSrvPlaylists((ps) => {
      // toIndex приходит в координатах УРЕЗАННОГО списка: и сайдбар, и сетка
      // медиатеки отдают в перетаскивание только подвижные плейлисты (подписки
      // и закреплённые исключены — их позиций сервер не хранит, а смысл
      // закрепа в том, чтобы случайно не сдвинуть). Раньше здесь `from`
      // брался из ПОЛНОГО списка и складывался с чужим `toIndex`: промах был
      // равен числу исключённых, а сравнение «откуда == куда» сравнивало
      // несравнимое — поэтому сдвиг на одну позицию вниз молча не давал
      // ничего. Закреплённые всегда сверху, так что с появлением закрепа
      // (0.1.6) промах стал бы гарантированным, а испорченный порядок уходит
      // на сервер и переживает перезапуск.
      const movable = ps.filter((p) => p.role !== "follower" && !p.pinned);
      const from = movable.findIndex((p) => p.id === draggedId);
      if (from < 0 || from === toIndex || toIndex < 0 || toIndex >= movable.length) return ps;
      const moved = moveItem(movable, from, toIndex);
      // Неподвижные остаются на СВОИХ местах в общем списке, подвижные
      // перетасовываются только между своими слотами.
      let k = 0;
      const next = ps.map((p) => (p.role !== "follower" && !p.pinned ? moved[k++] : p));
      nextIds = next.map((p) => p.id);
      return next;
    });
    if (nextIds.length === 0) return;
    try {
      await api.reorderPlaylists(nextIds);
    } catch {
      void reloadServerPlaylists(); // не сохранилось — вернём серверный порядок
    }
  };

  /** Закреп плейлиста (2026-07-20): оптимистично флипаем и пересобираем
   *  список серверным правилом (закреплённые сверху, внутри полос порядок
   *  цел), затем PATCH; ошибка — откат перечиткой. НЕ офлайн-пин. */
  const togglePlaylistPinned = async (id: string) => {
    let next = false;
    setSrvPlaylists((ps) => {
      const target = ps.find((p) => p.id === id);
      if (!target) return ps;
      next = !target.pinned;
      const flipped = ps.map((p) => (p.id === id ? { ...p, pinned: next } : p));
      // стабильная пересборка: pinned-полоса первой, взаимный порядок не трогаем
      return [...flipped.filter((p) => p.pinned), ...flipped.filter((p) => !p.pinned)];
    });
    try {
      await api.setPlaylistPinned(id, next);
    } catch {
      void reloadServerPlaylists();
    }
  };
  useEffect(() => {
    if (!canSearch) return;
    void reloadServerPlaylists();
    withSnapshot("favorites", () => api.getFavorites())
      .then(({ data }) => setLikes((ls) => [...new Set([...ls, ...data.map((t) => t.id)])]))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canSearch]);

  // Админка (Stage 5): пункт в сайдбаре — только если сервер подтвердил права
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!canSearch) return;
    void api.adminPing().then(setIsAdmin);
  }, [api, canSearch]);

  // Оффлайн-пины (Stage 4): что закреплено на этом устройстве
  const [pins, setPins] = useState<Set<string>>(new Set());
  useEffect(() => {
    enginePins()
      .then((list) => setPins(new Set(list.map((p) => p.track_id))))
      .catch(() => undefined);
  }, []);

  /** Закрепить трек оффлайн: пин + немедленная догрузка в кэш добычи.
   *  "saved" — лежит на диске; "pinned" — закрепление есть, файл подтянется
   *  при первом прослушивании; "failed" — движок не ответил, закрепления НЕТ.
   *  ⚠️ enginePin до 02.08 стоял ВНЕ try: его отказ ронял всю цепочку, из-за
   *  чего тост «Сохраняем N треков…» висел вечно, а ошибка уходила в
   *  необработанное отклонение промиса (вызов идёт через void). */
  const saveOffline = async (t: CatalogTrack): Promise<"saved" | "pinned" | "failed"> => {
    try {
      await enginePin(t.id, true);
    } catch {
      return "failed";
    }
    setPins((p) => new Set([...p, t.id]));
    if (t.sources.every((s) => s === "local")) return "saved"; // локальный и так на диске
    try {
      const sources = await api.getTrackSources(t.id);
      // оффлайн-копия — всегда в полном качестве и по политике источников
      await resolvePlayable(t.id, applySourcePolicy(sources, prefs), "auto", prefs.language);
      return "saved";
    } catch {
      return "pinned";
    }
  };

  const toggleOffline = async (track: CatalogTrack) => {
    if (pins.has(track.id)) {
      try {
        await enginePin(track.id, false);
      } catch {
        showToast(t("toast.offline.failed"), "x");
        return;
      }
      setPins((p) => {
        const next = new Set(p);
        next.delete(track.id);
        return next;
      });
      showToast(t("toast.offline.removed"), "cloud-off");
      return;
    }
    showToast(t("toast.offline.saving"), "download");
    const r = await saveOffline(track);
    if (r === "failed") {
      showToast(t("toast.offline.failed"), "x");
      return;
    }
    showToast(
      r === "pinned" ? t("toast.offline.pinnedWillDownload") : t("toast.offline.saved"),
      "download",
    );
  };

  /** «Сохранить оффлайн» на плейлисте: пины + фоновая догрузка по очереди. */
  const saveOfflinePlaylist = async (tracks: CatalogTrack[]) => {
    const targets = tracks.filter((t) => /^\d+$/.test(t.id));
    if (targets.length === 0) return;
    showToast(t("toast.offline.savingPlaylist", { count: targets.length }), "download");
    let ok = 0;
    // Закрепились — только те, у кого движок принял пин: раньше в pins
    // безусловно уезжал ВЕСЬ список, и после отказа движка треки выглядели
    // сохранёнными, ничем при этом не будучи.
    const pinned: string[] = [];
    for (const track of targets) {
      const r = await saveOffline(track);
      if (r === "saved") ok += 1;
      if (r !== "failed") pinned.push(track.id);
    }
    setPins((p) => new Set([...p, ...pinned]));
    showToast(t("toast.offline.playlistDone", { ok, count: targets.length }), "download");
  };

  /** Каталожный (серверный) id — числовой; у локального файла — "local:<sha256>". */
  const isCatalogId = (id: string) => /^\d+$/.test(id);

  /** Иконки, уже занятые плейлистами пользователя — pickRandomPlaylistIcon
   *  старается не повторяться, пока в манифесте есть свободные (T47b). */
  const usedPlaylistIcons = () => srvPlaylists.map((p) => p.icon).filter((id): id is string => id !== null);

  /** «Радио по треку» (Stage 5): очередь = трек + похожие с сервера. */
  const startRadio = async (track: CatalogTrack) => {
    showToast(t("toast.radio.building"), "radio");
    try {
      const radio = await api.getRadio(track.id);
      pb.playContext([track, ...radio].map(fromCatalog), track.id);
      showToast(t("toast.radio.byTrack", { title: track.title }), "radio");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.radio.buildFailed"), "x");
    }
  };

  // Адаптив окна: фиксированные колонки не должны душить контент.
  // < 1200px — прячем «Сейчас играет» (вторична), < 950px — ужимаем сайдбар.
  const wideEnoughForPanel = useMediaQuery("(min-width: 1200px)");
  const wideEnoughForSidebar = useMediaQuery("(min-width: 950px)");
  // Настройки — единственное вью, которое само по себе двухколоночное
  // (навигация + панель) и меряет себя container query по своей ширине.
  // «Сейчас играет» отбирала у него 340px, из-за чего панель настроек
  // схлопывалась в узкую колонку, а навигация — в иконочный рельс уже на
  // нормальном окне. Слушать музыку и крутить настройки одновременно —
  // не сценарий: что играет, видно в плеер-баре снизу, он никуда не делся.
  const showNowPlaying = lyricsOn && wideEnoughForPanel && view !== "settings";
  // МЕСТО ПОД ПАНЕЛЬ — ТОЛЬКО ТАМ, ГДЕ СЛУШАЮТ (редизайн 2026-08-04, решение
  // владельца «только где слушают, не где ищут»).
  //
  // Что было не так. Панель была колонкой ВЕЗДЕ, и на пороге 1200px она
  // отнимала 340px + зазор у содержимого: контентная колонка падала с 1076px
  // до 532px ровно в тот момент, когда окно СТАНОВИЛОСЬ шире. Это и есть
  // жалоба владельца «интерфейс суженный» — она была буквальной, а не
  // ощущением. Хуже всего доставалось спискам: Поиск и Медиатека — экраны, где
  // ширина и есть содержимое.
  //
  // Теперь МЕСТО под панель резервируется только на экранах, с которых слушают
  // (Главная, плейлист, «Любимое»), а на рабочих — Поиск, Медиатека,
  // Статистика, админка — содержимое занимает всю ширину, и панель лежит
  // ПОВЕРХ него, как это давно делает очередь. Содержимое не сжимается
  // никогда, а кнопка текста нигде не теряет смысл.
  //
  // ⚠️ САМА ПАНЕЛЬ КОЛОНКОЙ БОЛЬШЕ НЕ БЫВАЕТ (жалоба владельца 04.08: «при
  // переходе на другую страницу модалка увеличивается»). Она ВСЕГДА рисуется
  // наложением с одной и той же геометрией, а этот флаг решает лишь, оставить
  // ли под неё пустую третью колонку сетки. Разбор — у nowPlayingStyle ниже.
  // Сам флаг объявлен НИЖЕ блока закрытия: пока панель уезжает, колонка обязана
  // стоять (см. комментарий у объявления).
  // T15 (bgType=animated): OS-уровень reduced-motion — реактивно, как остальной адаптив.
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Видно ли окно (03.08): свёрнуто или полностью накрыто чужим окном — значит
  // нет. Спросить об этом страницу НЕЛЬЗЯ — WebView2 ей не сообщает (замер и
  // объяснение — в шапке lib/windowVisible.ts), сигнал приходит из Rust.
  // Отсюда флаг расходится по всем потребителям кадров: вращение фона ниже,
  // ListeningMode (визуализатор + качание + прогресс), PlayerBar (прогресс),
  // NowPlayingPanel (часы и ДЕКОДЕР видео).
  // ⚠️ ГРАНИЦА, поставленная владельцем: пока окно ВИДНО, не гасим ничего,
  // даже когда оно не в фокусе. Окно на втором мониторе человек видит, и
  // замершая там анимация — заметный регресс, а не экономия.
  const windowVisible = useWindowVisible();

  // ── «Сейчас играет»: уход с анимацией и язычок возврата ────────────
  // Панель исчезала мгновенно — узел просто переставал рендериться. Теперь
  // между «её больше не хотят» и «узла нет» лежит один такт анимации ухода:
  // держим панель в дереве, пока она уезжает (образец отложенного
  // размонтирования — packages/ui/src/components/feedback/Menu.jsx).
  const [npMounted, setNpMounted] = useState(showNowPlaying);
  const [npClosing, setNpClosing] = useState(false);
  const npCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishNpClose = () => {
    if (npCloseTimer.current) {
      clearTimeout(npCloseTimer.current);
      npCloseTimer.current = null;
    }
    setNpClosing(false);
    setNpMounted(false);
  };
  useEffect(() => {
    if (showNowPlaying) {
      // Передумали на полпути — гасим уход и оставляем панель на месте.
      if (npCloseTimer.current) {
        clearTimeout(npCloseTimer.current);
        npCloseTimer.current = null;
      }
      setNpClosing(false);
      setNpMounted(true);
      return;
    }
    if (!npMounted) return;
    if (reducedMotion) {
      setNpClosing(false);
      setNpMounted(false);
      return;
    }
    setNpClosing(true);
    // Ремень безопасности на случай, если animationend не придёт вовсе (узел
    // скрыли системой, вкладку усыпили). Порог с запасом перекрывает --dur-base
    // на самых медленных настройках: 220мс × 1.7 (общая скорость) × 1.7
    // (множитель группы диалогов) ≈ 636мс.
    npCloseTimer.current = setTimeout(finishNpClose, 900);
    // npMounted нарочно не в зависимостях: эффект реагирует на ЖЕЛАНИЕ показать
    // панель, а не на собственный результат (иначе снятие npMounted тут же
    // перезапустило бы эффект).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNowPlaying, reducedMotion]);
  useEffect(() => () => {
    if (npCloseTimer.current) clearTimeout(npCloseTimer.current);
  }, []);
  // КОЛОНКА ДЕРЖИТСЯ, ПОКА ПАНЕЛЬ УЕЗЖАЕТ (`|| npClosing` — призрак,
  // найденный владельцем 04.08 ночью). Без этого закрытие на слушательском
  // экране рушило колонку МГНОВЕННО: main расползался на всю ширину и тут же
  // резервировал место paddingRight'ом — а фон main красит и свои поля, так
  // что за уезжающей панелью вставал пустой прямоугольник её же формы («точно
  // такая же панель, но без содержимого»), который затем схлопывался. Пока
  // идёт уход, под панелью стоит пустая колонка сетки (сквозь неё виден фон
  // окна — это честный задник), и только после размонтирования содержимое
  // забирает ширину.
  const nowPlayingDocked =
    (showNowPlaying || npClosing) &&
    (view === "home" || view === "playlist" || view === "scPlaylist" || view === "favorites");

  // ГЕОМЕТРИЯ ПАНЕЛИ — ОДНА НА ВСЕ ЭКРАНЫ (жалоба владельца 04.08: «при
  // переключении с поиска на главную модалка увеличивается»).
  //
  // Что было. На «слушательских» экранах панель была настоящей колонкой сетки
  // (ширина трека = --w-nowplaying, это ВНЕШНИЙ размер), а на остальных —
  // наложением с `width: var(--w-nowplaying)`. Глобального
  // `box-sizing: border-box` в проекте нет, поэтому у наложения та же цифра
  // означала ширину СОДЕРЖИМОГО, и к ней сверху добавлялись два --pad-zone:
  // 340 → 372px при стандартной плотности. Панель буквально прибавляла 32px
  // на каждом переходе, и это была не иллюзия.
  //
  // Как теперь. Панель ВСЕГДА наложение с этим стилем; на слушательских
  // экранах сетка лишь резервирует под неё пустую третью колонку
  // (nowPlayingDocked). Узел при смене экрана не пересоздаётся и не меняет ни
  // одного размера — «увеличиваться» физически нечему. Отсчёт идёт от краёв
  // окна: контейнер сетки — position:absolute inset:0, а его поля равны
  // --win-pad сверху и --pad-under-bar снизу, то есть ровно тем координатам,
  // что стоят здесь.
  const nowPlayingStyle: React.CSSProperties = {
    position: "absolute",
    // Поля плавающей панели — те же, что у окна (--win-pad): у флета она
    // стоит впритык к кромке, у «воздушного» вида отступает на высоту полосы
    // заголовка с обеих сторон — симметрия с сайдбаром (жалоба 04.08 утром).
    top: "var(--win-pad, 0px)",
    right: "var(--win-pad, 0px)",
    bottom: "var(--pad-under-bar, calc(var(--h-playerbar) + 2 * var(--gap-zone)))",
    width: "var(--w-nowplaying)",
    // Без этого ширина считается по содержимому — см. разбор выше.
    boxSizing: "border-box",
    // Выше содержимого, ниже очереди (50), выделения (85) и подсказок (60).
    zIndex: 45,
    // МАТЕРИАЛ ПАНЕЛИ, А НЕ ЗОНЫ. Проверено живьём 04.08: с зональным стеклом
    // (--glass-zone) наложение над содержимым читается не как панель, а как
    // текст, повисший в воздухе, — под ним просвечивают чужие строки. Лестница
    // материалов themeVars.ts это уже описывает: «зона < панель < диалог», и
    // всё плавающее над содержимым (плеер, очередь, меню) берёт панельную
    // плотность. Панель теперь плавает ВСЕГДА — значит и материал у неё один
    // на всех экранах, иначе переход между ними менял бы тон подложки.
    // Ползунок «Стекло по зонам → Сейчас играет» при этом главнее: он остаётся
    // первым в цепочке, --glass-panel только заменил прежний фолбэк.
    background: "var(--glass-nowplaying, var(--glass-panel))",
    // Уход: панель уезжает вправо за кромку и гаснет. `forwards` держит её там
    // до размонтирования, pointerEvents снимают клики с уезжающего узла.
    animation: npClosing
      ? "muzaNowPlayingOut var(--dur-panel-out) var(--ease-in) forwards"
      : "muzaNowPlayingIn var(--dur-panel-in) var(--spring-snap, var(--ease-out))",
    ...(npClosing ? { pointerEvents: "none" as const } : {}),
  };
  /** Виден ли язычок возврата: панель закрыта, но открыть её есть чем и есть
   *  зачем. Условия — те же, что у самой панели (ширина окна, не «Настройки»),
   *  плюс живой трек: язычок, открывающий пустую панель, был бы обманом. */
  // ⚠️ БЕЗ УСЛОВИЯ «ЕСТЬ ТРЕК». Оно тут было и делало ровно то, на что владелец
  // пожаловался 04.08: «я не вижу никакого язычка». Закрыл панель, пока ничего
  // не играет, — и вернуть её нечем до первого запуска трека. Сама панель без
  // трека показывает осмысленное пустое состояние («выбери трек — здесь будут
  // обложка, текст и смысл»), то есть открывать её пустой законно. Правило
  // общее: путь НАЗАД не имеет права зависеть от состояния, которого у
  // человека сейчас нет.
  const npHandleVisible = !lyricsOn && wideEnoughForPanel && view !== "settings";
  // Наведение И клавиатурный фокус — один флаг: язычок обязан отзываться на
  // табуляцию так же, как на мышь (иначе с клавиатуры он невидим совсем).
  const [npHandleHover, setNpHandleHover] = useState(false);

  // Развёрнуто ли окно — нужно ровно для глифа кнопки в своей полосе заголовка
  // («развернуть» ↔ «восстановить»), см. lib/windowControls.ts.
  const maximized = useMaximized();

  // Медиаклавиши и системный медиа-оверлей (SMTC) через Media Session API
  useMediaSession(
    track,
    playing,
    posStore,
    {
      toggle: pb.toggle,
      next: pb.next,
      prev: pb.prev,
      seek: pb.seek,
      pause: pb.pause,
    },
    prefs.mediaKeys,
    pb.speed,
  );

  // Мини-плеер: окно "mini" живёт/умирает по prefs; состояние уходит событиями
  // (1 Гц по целым секундам позиции), команды приходят обратно (ref-паттерн —
  // подписка одна, замыкания свежие)
  // Что за обложку мини уже получил. undefined — не получал ничего (первый
  // снапшот и любой ответ на hello обязаны везти картинку целиком).
  const miniCoverSentRef = useRef<string | null | undefined>(undefined);
  const miniStateNow = (): MiniState => {
    const cover = track?.cover ?? null;
    const state: MiniState = {
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      playing,
      // ТОЧНАЯ позиция, а не снимок рендера: мини-плеер живёт поверх игры, и
      // его часы — второй из трёх сценариев, которые ломает загрубление
      // (см. шапку positionStore.ts). Рендеров при играющей музыке тут больше
      // почти нет — снимок протух бы на секунды.
      pos: posStore.get(),
      duration: track?.duration ?? 0,
      liked: track ? likes.includes(track.id) : false,
    };
    // Обложка — сотни килобайт байтов картинки (data-URL после кропа
    // useCoverArt), а снапшот уходит раз в секунду по тику позиции. Кладём
    // поле, ТОЛЬКО когда картинка правда сменилась; мини мержит снапшот в
    // прежний, поэтому отсутствие поля для него = «оставь что было»
    // (договор — в MiniState.cover). До 02.08 эти байты ездили между
    // процессами каждую секунду впустую.
    if (cover !== miniCoverSentRef.current) {
      miniCoverSentRef.current = cover;
      state.cover = cover;
    }
    return state;
  };
  const miniRef = useRef({ send: (_full?: boolean) => {}, cmd: (_c: MiniCommand) => {} });
  miniRef.current = {
    // full=true — «мини только что открылось/перезапустилось, оно не знает
    // ничего»: забываем отправленное, чтобы обложка уехала вместе со снапшотом.
    send: (full = false) => {
      if (full) miniCoverSentRef.current = undefined;
      void miniSendState(miniStateNow());
    },
    cmd: (c: MiniCommand) => {
      if (c === "toggle") pb.toggle();
      else if (c === "next") pb.next();
      else if (c === "prev") pb.prev();
      else if (c === "like") {
        if (track) toggleLike(track.id);
      }
      else if (c === "close") {
        // замыкание свежее (miniRef переприсваивается каждый рендер) — prefs актуальны
        setPrefs({ ...prefs, miniPlayer: false });
        void miniHide();
      }
    },
  };
  useEffect(() => {
    if (!engineAvailable()) return;
    if (prefs.miniPlayer) {
      // Окно "mini" смонтировано (скрыто) ещё со старта приложения — его
      // собственный mini-hello мог уйти ДО того, как main успел подписаться
      // (см. miniListen ниже). Досылаем свежий снапшот сразу после show(),
      // чтобы первое появление окна не оставалось пустым до следующего
      // изменения трека/позиции.
      void miniShow().then(() => miniRef.current.send(true));
    } else {
      void miniHide();
    }
  }, [prefs.miniPlayer]);
  useEffect(() => {
    if (!engineAvailable()) return;
    let un: (() => void) | undefined;
    void miniListen(
      (c) => miniRef.current.cmd(c),
      // hello = мини поднялось заново и ничего о треке не знает — снапшот
      // целиком, вместе с обложкой
      () => miniRef.current.send(true),
    ).then((u) => {
      un = u;
    });
    return () => un?.();
  }, []);
  useEffect(() => {
    if (!prefs.miniPlayer || !engineAvailable()) return;
    miniRef.current.send();
    // track.cover В ДЕПСАХ ОБЯЗАТЕЛЬНА: useCoverArt чистит обложку асинхронно,
    // и на смену трека снапшот уходит ещё с сырой. Без этой зависимости эффект
    // не перезапускался, и мини освежался только со следующей секундой — то
    // есть на паузе не освежался никогда и держал недокропленную картинку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.miniPlayer, track?.id, track?.cover, playing, likes]);
  // Ход времени — отдельной подпиской, раз в секунду (ровно прежний ритм: до
  // 03.08 эффект выше сидел на Math.floor(pos)). Рендер для этого не нужен.
  useEffect(() => {
    if (!prefs.miniPlayer || !engineAvailable()) return;
    return posStore.subscribeSecond(() => miniRef.current.send());
  }, [prefs.miniPlayer, posStore]);

  // Discord Rich Presence: активность на смену трека/паузу (RPC живёт в Rust;
  // Discord не запущен или client_id не настроен — no-op). Строки — из
  // шаблонов настроек ({track}/{artist}/{album}; альбома у каталожных нет).
  // Обложка — СЫРАЯ (pbRaw), не track.cover: тот прошёл useCoverArt, который
  // ytimg-тумбы кропает в data-URL канвы — не https ⇒ у большинства каталожных
  // треков в Discord уезжал логотип-фолбэк (жалоба 2026-07-16). Discord тянет
  // картинку сам по публичному https-URL, локальные байты ему не отдать.
  const rawCover = pbRaw.track?.cover ?? null;
  useEffect(() => {
    if (!prefs.discordRpcOn || !playing || !track) {
      void clearDiscordActivity();
      return;
    }
    const vars = { track: track.title, artist: track.artist, album: track.album };
    // Позиция — точная, на момент отправки активности: Discord показывает
    // ЧУЖИМ людям время трека, и снимок последнего рендера врал бы им
    // (третий из трёх сценариев в шапке positionStore.ts).
    const startTs = Math.floor(Date.now() / 1000 - posStore.get());
    void updateDiscordActivity({
      details: formatTemplate(prefs.discordLine1, vars) || track.title,
      state: formatTemplate(prefs.discordLine2, vars) || track.artist,
      coverUrl: prefs.discordShowCover ? discordCoverUrl(rawCover) : null,
      startTs,
      // start+end = нативная прогресс-линия Discord; длительности нет (0) — не врём
      endTs: prefs.discordProgressOn && track.duration > 0 ? startTs + Math.round(track.duration) : null,
      buttonLabel: prefs.discordBtnOn ? prefs.discordBtnLabel : null,
      buttonUrl: prefs.discordBtnOn ? prefs.discordBtnUrl : null,
    });
    // pos нарочно не в deps: активность шлём на смену трека/состояния, не каждый тик
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    track?.id,
    rawCover,
    playing,
    prefs.discordRpcOn,
    prefs.discordBtnOn,
    prefs.discordBtnLabel,
    prefs.discordBtnUrl,
    prefs.discordShowCover,
    prefs.discordProgressOn,
    prefs.discordLine1,
    prefs.discordLine2,
  ]);

  // Свой шрифт (2026-07-20): @font-face из localStorage поднимается один раз
  // на старте — дальше ключ "custom" работает как обычный шрифт (--font-ui)
  useEffect(() => {
    applyCustomFont();
  }, []);

  // Таймер сна: луна в баре циклит выкл → пресеты из настроек → конец трека
  // (mode: "off" | "track" | число минут из prefs.sleepPresets)
  const [sleep, setSleep] = useState<{ mode: "off" | "track" | number; at: number | null }>({
    mode: "off",
    at: null,
  });
  const sleepLabel =
    sleep.mode === "off"
      ? t("player.sleep.off")
      : sleep.mode === "track"
        ? t("player.sleep.track")
        : t("player.sleep.inMinutes", { minutes: sleep.mode });
  const cycleSleep = () => {
    const order: ("off" | "track" | number)[] = ["off", ...prefs.sleepPresets, "track"];
    const i = order.findIndex((m) => m === sleep.mode);
    const mode = order[(i + 1) % order.length];
    const minutes = typeof mode === "number" ? mode : null;
    setSleep({ mode, at: minutes ? Date.now() + minutes * 60_000 : null });
    showToast(
      mode === "off" ? t("player.sleep.off") : mode === "track" ? t("toast.sleep.track") : t("toast.sleep.inMinutes", { minutes: minutes ?? 0 }),
      "moon",
    );
  };
  useEffect(() => {
    if (!sleep.at) return;
    const iv = setInterval(() => {
      if (Date.now() >= (sleep.at ?? Infinity)) {
        setSleep({ mode: "off", at: null });
        pb.pause();
        showToast(t("toast.sleep.paused"), "moon");
      }
    }, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleep.at]);
  // «Конец трека»: следующая смена трека — пауза
  const sleepTrackArmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (sleep.mode !== "track") {
      sleepTrackArmedRef.current = null;
      return;
    }
    if (!track) return; // нечего «доигрывать до конца»
    if (sleepTrackArmedRef.current === null) {
      sleepTrackArmedRef.current = track.id; // взводим на текущем треке
      return;
    }
    if (sleepTrackArmedRef.current !== track.id) {
      setSleep({ mode: "off", at: null });
      pb.pause();
      showToast(t("toast.sleep.paused"), "moon");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleep.mode, track?.id]);

  // Тексты — LRCLIB с сервера
  const { lines: rawLyrics, trackId: lyricsTrackId, synced: lyricsSynced, loading: lyricsLoading } = useLyrics(api, track, canSearch);

  // Видео вместо обложки в «Сейчас играет» (2026-07-21, преф videoNowPlaying):
  // резолв лениво и только при включённом тумблере; провал = обложка
  const { videoUrl: trackVideoUrl, refreshVideo: refreshTrackVideo } = useTrackVideo(
    api,
    track,
    prefs.videoNowPlaying && showNowPlaying,
    canSearch,
  );

  // «Режим смысла» (Stage 5): настоящие Genius-аннотации каталожного трека —
  // строкам с аннотацией ставится note (пунктир в Lyrics, карточка в панели);
  // индексы аннотаций привязаны к synced-строкам, plain не размечаем.
  // Тумблер prefs.meaningMode (Тексты) выключает Genius-аннотации.
  const canFetchAnnotations = shouldFetchAnnotations(
    canSearch,
    prefs.meaningMode,
    lyricsLoading,
    lyricsTrackId,
    track?.id ?? null,
    rawLyrics.length,
  );
  const { notes: annotationNotes, geniusUrl } = useAnnotations(api, track, canFetchAnnotations);
  const lyrics = useMemo(
    () => decorateLyrics(rawLyrics, annotationNotes, prefs.meaningMode),
    [rawLyrics, annotationNotes, prefs.meaningMode],
  );
  useEffect(() => setMeaningLine(null), [track?.id, prefs.meaningMode]);

  // Активная строка — только у синхронизированного текста (plain не подсвечиваем);
  // выключенный prefs.syncedLyrics превращает synced в plain-список (-1).
  //
  // Считается НА ТИКЕ, а не в рендере App: позиция больше не состояние React
  // (positionStore.ts), а подсветка строки обязана жить дальше. Замыкание
  // отдаётся в DerivedPositionScope — тот зовёт его на каждый тик, но
  // перерисовывает текст, только когда сменился НОМЕР строки (раз в
  // несколько секунд вместо четырёх раз в секунду).
  // ⚠️ Номер строки не гейтится «видно ли»: текст обязан следить за песней и
  // невидимым, иначе на открытии караоке он поедет плавной прокруткой через
  // весь куплет — а это видно.
  const lineAt = (sec: number) =>
    activeLyricLine(sec, lyrics, {
      synced: lyricsSynced && prefs.syncedLyrics,
      endNote: prefs.lyricsEndNote,
    });

  const showToast = (text: string, icon = "check") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ open: true, text, icon });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 2400);
  };

  // Дабл-клик по строке = «в очередь» (настройка «Действие по двойному клику»);
  // при "play" вьюхи получают undefined — TrackRow оставляет dblclick = play
  const queueCatalog = (track: CatalogTrack) => {
    pbRaw.insertInQueue(fromCatalog(track), pbRaw.queue.length);
    showToast(t("toast.queue.added", { title: track.title }), "list-music");
  };

  /** «Играть следующим» из контекстного меню (2026-07-20): сразу после
   *  текущего; пустая очередь — insertInQueue клампит в начало. */
  const playNextCatalog = (track: CatalogTrack) => {
    pbRaw.insertInQueue(fromCatalog(track), pbRaw.index + 1);
    showToast(t("toast.queue.playNext", { title: track.title }), "list-start");
  };

  /** Состав плейлиста для меню-действий (играть/в очередь/оффлайн): меню
   *  держит только id — состав дотягивается по клику. */
  const withPlaylistTracks = async (id: string, fn: (tracks: CatalogTrack[]) => void) => {
    try {
      const detail = await api.getPlaylist(id);
      if (detail.tracks.length === 0) {
        showToast(t("views.playlist.empty"), "x");
        return;
      }
      fn(detail.tracks);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("views.playlist.loadFailed"), "x");
    }
  };

  /** Тост с кнопкой «Вернуть» (живёт дольше — юзер должен успеть). */
  const showUndoToast = (text: string, icon: string, onUndo: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({
      open: true,
      text,
      icon,
      actionLabel: t("toast.undo"),
      onAction: () => {
        onUndo();
        setToast((t) => ({ ...t, open: false }));
      },
    });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 6000);
  };

  // Drag-and-drop файлов из проводника: Tauri-события (HTML5 не отдаёт пути) —
  // полноэкранный оверлей, скан local_scan, регистрация на сервере при сессии
  const [fileDropLit, setFileDropLit] = useState(false);
  const handleFileDropRef = useRef<(paths: string[]) => Promise<void>>(async () => {});
  handleFileDropRef.current = async (paths: string[]) => {
    try {
      const entries = await localScanPaths(paths);
      if (entries.length === 0) {
        showToast(t("toast.files.noneFound"), "x");
        return;
      }
      if (canSearch) await registerLocalTracks(api, entries);
      showToast(t("toast.files.added", { count: entries.length }), "folder-down");
      navigate("library");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.files.addFailed"), "x");
    }
  };
  useEffect(() => {
    if (!engineAvailable()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      const un = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter") {
          if (p.paths.length > 0) setFileDropLit(true);
        } else if (p.type === "leave") {
          setFileDropLit(false);
        } else if (p.type === "drop") {
          setFileDropLit(false);
          if (p.paths.length > 0) void handleFileDropRef.current(p.paths);
        }
      });
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Найденное обновление для пункта в сайдбаре. Ref — чтобы проверка по
  // таймеру видела актуальное состояние, не переподписываясь на каждом
  // изменении.
  const [update, setUpdate] = useState<SidebarUpdate | undefined>(undefined);
  const updateRef = useRef<SidebarUpdate | undefined>(undefined);
  updateRef.current = update;

  // Автопроверка обновлений: первая через 30 секунд после старта, дальше
  // каждые полчаса (UPDATE_CHECK_INTERVAL_MS).
  //
  // Задержка в 30 секунд — чтобы проверка не конкурировала за сеть с первым
  // треком: человек запускает плеер, чтобы включить музыку, а не чтобы
  // обновиться. Троттла между запусками больше нет: он глушил проверку при
  // старте, если приложение перезапускали часто (решение владельца 10.08 —
  // проверять каждый запуск).
  //
  // Нашлось — качаем установщик молча и показываем пункт в сайдбаре: сперва
  // неактивный, потом готовый к нажатию.
  useEffect(() => {
    const check = () =>
      void autoCheckForUpdate().then(async (found) => {
        // Уже нашли и качаем (или скачали) — второй раз не начинаем.
        if (!found || updateRef.current) return;
        // Установщик тянем СРАЗУ, молча. Кнопка в это время видна, но
        // неактивна: к моменту, когда человек её заметит и нажмёт, ставить
        // будет уже нечего — файл на диске.
        setUpdate({ phase: "downloading", version: found.version, onInstall: () => undefined });
        try {
          await found.download(() => undefined);
        } catch {
          // Не скачалось (сеть, диск) — убираем пункт: следующая проверка
          // попробует заново. Тревожить сообщением незачем, человек ничего
          // не просил.
          setUpdate(undefined);
          return;
        }
        setUpdate({
          phase: "ready",
          version: found.version,
          onInstall: () => {
            void found.install().catch(() => showToast(t("toast.update.installFailed"), "x"));
          },
        });
      });
    const timer = setTimeout(check, 30_000);
    const iv = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Клик по каталожному треку: очередь = список, из которого кликнули. */
  const playCatalog = (tracks: CatalogTrack[], id: string) =>
    pb.playContext(tracks.map(fromCatalog), id);
  /** Клик по локальному файлу (Stage 4): очередь = живые файлы вкладки;
   *  с серверным id — обычный каталожный путь (скроббл/лайки). */
  const playLocal = (entries: LocalEntry[], hash: string) => {
    const ids = loadServerIds();
    const playable = entries.filter((e) => e.available);
    if (playable.length === 0) return;
    const queue = playable.map((e) => fromLocalEntry(e, canSearch ? (ids[e.hash] ?? null) : null));
    const clicked = playable.find((e) => e.hash === hash) ?? playable[0];
    const clickedId = canSearch && ids[clicked.hash] ? ids[clicked.hash] : `local:${clicked.hash}`;
    pb.playContext(queue, clickedId);
  };

  const openEqualizer = () => {
    navigate("settings");
    setSettingsIntent({ sub: "equalizer", nonce: Date.now() });
  };

  // Циклические кнопки бара тостят новое состояние (иконка меняется тонко)
  const cycleSpeedWithToast = () => {
    const next = pb.cycleSpeed();
    showToast(t("player.speedToast", { speed: next }), "gauge");
  };
  const cycleRepeatWithToast = () => {
    const next = pb.cycleRepeat();
    showToast(next === "off" ? t("player.repeat.off") : next === "all" ? t("player.repeat.all") : t("player.repeat.one"), "repeat");
  };

  // ── Очередь (UX-доводка): операции + возврат фокуса ───────────────
  /** Закрыть панель и вернуть фокус на кнопку очереди (клавиатурный путь).
   *  Селектор по data-атрибуту, не по aria-label: тот переводится и ломался
   *  при смене языка на лету (2026-07-20). */
  const closeQueue = () => {
    setQueueOn(false);
    (document.querySelector("[data-queue-toggle] button") as HTMLButtonElement | null)?.focus();
  };

  const removeQueueTrack = (id: string) => {
    const removed = pb.removeFromQueue(id);
    if (!removed) return;
    showUndoToast(t("toast.queue.trackRemoved", { title: removed.track.title }), "list-x", () =>
      pb.insertInQueue(removed.track, removed.index),
    );
  };

  const saveQueueAsPlaylist = async () => {
    const catalog = pb.queue.filter((t) => isCatalogId(t.id));
    if (catalog.length === 0) {
      showToast(t("toast.queue.nothingToSave"), "x");
      return;
    }
    try {
      const name = t("app.queuePlaylistName", { date: new Date().toLocaleDateString("ru") });
      // T47b: тоже создание нового плейлиста — та же случайная иконка, что и из «+» сайдбара
      const created = await api.createPlaylist(name, pickRandomPlaylistIcon(usedPlaylistIcons()));
      for (const t of catalog) await api.addPlaylistTrack(created.id, t.id);
      await reloadServerPlaylists();
      showToast(t("toast.queue.savedAsPlaylist", { name, count: catalog.length }), "save");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.queue.saveFailed"), "x");
    }
  };

  // Оверлей горячих клавиш (клавиша «?»)
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  // T9: явное открытие (кнопка сайдбара / строка настроек) — не toggle,
  // клик всегда открывает, даже если диалог уже открыт.
  const openHotkeys = () => setHotkeysOpen(true);

  // Mute: клик по иконке громкости или клавиша M; помним прежний уровень.
  //
  // Уровень ПЕРЕЖИВАЕТ ПЕРЕЗАПУСК (заказ владельца 05.08). Без этого человек,
  // закрывший приложение в немоте, при следующем запуске получал не свой
  // уровень, а зашитые 64 — то есть «включить звук» громко пугало.
  const prevVolRef = useRef(loadPlayerState().volumeBeforeMute);
  const toggleMute = () => {
    if (vol > 0) {
      prevVolRef.current = vol;
      savePlayerState({ volumeBeforeMute: vol, muted: true });
      pb.setVol(0);
    } else {
      // Фолбэк на дефолт: сохранённый ноль вернул бы немоту навсегда.
      pb.setVol(prevVolRef.current || DEFAULT_PLAYER_STATE.volume);
      savePlayerState({ muted: false });
    }
  };

  // Глобальные горячие клавиши — база нативности десктоп-плеера. Биндинги
  // переназначаемы (prefs.hotkeys, по e.code → layout-независимо). Слушатель
  // один на маунт, актуальные значения — через ref (без стейл-замыканий).
  const hotkeysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  hotkeysRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    // Фиксированные (нередактируемые) клавиши помощи/закрытия
    if (e.key === "?") {
      e.preventDefault();
      setHotkeysOpen((v) => !v);
      return;
    }
    if (e.code === "Escape" && queueOn) {
      // Пометка «Escape взят» — режим правки вида (Ctrl+E) выходит только
      // тогда, когда клавиша не понадобилась никому (shell/LookEditLayer.tsx).
      e.preventDefault();
      closeQueue();
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo) return;
    const action = matchAction(combo, prefs.hotkeys);
    if (!action) return;
    switch (action) {
      case "playPause":
        e.preventDefault(); // иначе скроллит / жмёт сфокусированную кнопку
        pb.toggle();
        break;
      case "next":
        pb.next();
        break;
      case "prev":
        pb.prev();
        break;
      // Шаг считаем от ТОЧНОЙ позиции на момент нажатия (posStore.get()).
      // Раньше здесь стоял снимок последнего рендера — он отставал до 250 мс
      // даже тогда, когда рендеры шли непрерывно.
      case "seekFwd":
        if (track) pb.seek(Math.min(posStore.get() + prefs.seekStepSec, track.duration));
        break;
      case "seekBack":
        pb.seek(Math.max(posStore.get() - prefs.seekStepSec, 0));
        break;
      case "mute":
        toggleMute();
        break;
      case "like":
        if (track) toggleLike(track.id);
        break;
      case "search":
        e.preventDefault();
        navigate("search");
        break;
      case "navBack":
        e.preventDefault();
        // В режиме прослушивания «назад» — выход ИЗ режима, а не невидимое
        // листание вкладок под оверлеем: иначе пользователь щёлкал «назад» до
        // дна истории (дно — всегда стартовая главная) и, выйдя по Esc,
        // «оказывался на главной» (жалоба владельца 2026-07-16).
        if (expanded) {
          setExpanded(false);
          break;
        }
        navBack();
        break;
      case "navForward":
        e.preventDefault();
        if (expanded) break; // вкладки под оверлеем вслепую не листаем
        navForward();
        break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => hotkeysRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const seekLine = (i: number) => {
    if (!lyricsSynced) return; // у plain-текста нет таймкодов
    const line = lyrics[i];
    if (line) pb.seek(line.t);
  };
  const toggleLike = (id: string) => {
    const had = likes.includes(id);
    setLikes((ls) => (had ? ls.filter((x) => x !== id) : [...ls, id]));
    showToast(had ? t("toast.favorites.removed") : t("toast.favorites.added"), "heart");
    // каталожный трек при серверной сессии — синхронизируем (optimistic;
    // упало → откатываем и честно говорим)
    if (canSearch && isCatalogId(id)) {
      (had ? api.removeFavorite(id) : api.addFavorite(id)).catch(() => {
        setLikes((ls) => (had ? [...ls, id] : ls.filter((x) => x !== id)));
        showToast(t("toast.favorites.syncFailed"), "x");
      });
    }
  };

  /** «⋯» на каталожном (серверном) треке — меню Stage 4. Координаты уходят
   *  сырыми: клампинг и zoom-коррекцию делает сам Menu (2026-07-17). */
  const openCatalogMenu = (t: CatalogTrack, e: React.MouseEvent, opts?: { inFavorites?: boolean }) => {
    menuApiRef.current?.openMenu(e, { kind: "track", track: t, place: opts?.inFavorites ? "favorites" : "search" });
  };

  /** После «Заменить версию»: плейлист перечитывает себя сам (reload из
   *  PlaylistView), Любимое живёт от likes — правим их напрямую: сервер уже
   *  поменял, toggleLike звать нельзя (он бы снова дёрнул API). */
  const handleReplaced = (oldId: string, newTrack: CatalogTrack) => {
    if (replaceCtx?.target.kind === "playlist") {
      replaceCtx.target.reload();
    } else {
      setLikes((ls) => {
        const without = ls.filter((x) => x !== oldId);
        return without.includes(newTrack.id) ? without : [...without, newTrack.id];
      });
    }
  };

  /** T17: ПКМ по плейлисту (сайдбар/медиатека) — Открыть/Переименовать/Удалить.
   *  Роль (owner/follower/collaborator) решает состав пунктов — считается в
   *  menuActions.ts через ctx.playlistRole. */
  const openPlaylistMenu = (p: { id: string; name: string }, e: React.MouseEvent) => {
    menuApiRef.current?.openMenu(e, { kind: "playlist", id: p.id, name: p.name });
  };

  /** Отписка из контекст-меню (2026-07-17): живая «ссылка» уходит из
   *  библиотеки; сам плейлист у владельца никак не страдает. */
  const unfollowFromMenu = async (target: { id: string; name: string }) => {
    if (!canSearch) return;
    try {
      await api.unfollowPlaylist(target.id);
      await reloadServerPlaylists();
      showToast(t("views.search.publicPlaylist.removed"), "list-x");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("views.search.somethingWrong"), "x");
    }
  };

  /** Переименование из контекст-меню: как в PlaylistView. Плейлисты есть
   *  только у серверной сессии — анониму переименовывать нечего. */
  const renameFromMenu = async () => {
    const target = plRename;
    const name = plRenameValue.trim();
    if (!target || !name) return;
    setPlRename(null);
    // Плейлисты есть только у серверной сессии — анониму переименовывать нечего
    if (!canSearch) return;
    try {
      await api.renamePlaylist(target.id, name);
      await reloadServerPlaylists();
      if (openPlaylistId === target.id) setPlBump((v) => v + 1); // открытая страница перечитает имя
      showToast(t("toast.playlist.renamed"), "pencil");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.playlist.renameFailed"), "x");
    }
  };

  /** Удаление из контекст-меню (после подтверждения); открытая страница
   *  этого плейлиста закрывается, как при удалении из PlaylistView. */
  const deleteFromMenu = async () => {
    const target = plDelete;
    if (!target) return;
    setPlDelete(null);
    if (!canSearch) return; // у анонима плейлистов нет
    try {
      await api.deletePlaylist(target.id);
      await reloadServerPlaylists();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.playlist.deleteFailed"), "x");
      return;
    }
    showToast(t("toast.playlist.deleted"), "trash-2");
    if (openPlaylistId === target.id) {
      setOpenPlaylistId(null);
      if (view === "playlist") navigate("home");
    }
  };

  const createPlaylist = async () => {
    const name = plName.trim() || t("app.newPlaylistName");
    // Плейлист живёт на сервере. Аноним раньше «создавал» его в useState: до
    // первого перезапуска, без возможности положить трек — а тост при этом
    // радостно сообщал «Плейлист создан». Теперь честно объясняем, почему нет.
    if (!canSearch) {
      setDialogOpen(false);
      setPlName("");
      showToast(t("toast.playlist.needsAccount"), "user");
      return;
    }
    try {
      const icon = pickRandomPlaylistIcon(usedPlaylistIcons());
      const created = await api.createPlaylist(name, icon);
      await reloadServerPlaylists();
      setDialogOpen(false);
      setPlName("");
      showToast(t("toast.playlist.created"), "list-music");
      navigate("playlist", { playlistId: created.id });
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.playlist.createFailed"), "x");
    }
  };

  /** T47b: ПКМ на плейлисте (сайдбар/медиатека) ИЛИ ПКМ на треке внутри
   *  PlaylistView — оба ведут сюда, id плейлиста разный только по источнику
   *  клика. T47c: с трека едет и его обложка — первой плиткой пикера. */
  const openIconPicker = (id: string, fromTrack?: { id: string; coverUrl: string | null }) => {
    const icon = srvPlaylists.find((p) => p.id === id)?.icon ?? null;
    setIconPicker({
      id,
      icon,
      coverTile: fromTrack?.coverUrl ? { value: `track:${fromTrack.id}`, src: fromTrack.coverUrl } : null,
    });
  };

  const changePlaylistIcon = async (icon: string) => {
    const target = iconPicker;
    if (!target) return;
    setIconPickerBusy(true);
    try {
      await api.setPlaylistIcon(target.id, icon);
      // T47c: track-иконка рисуется через iconCoverUrl — локальный патч знает
      // обложку из самой плитки, сервер спрашивать не нужно
      const iconCoverUrl = icon === target.coverTile?.value ? target.coverTile.src : null;
      // патчим локальный список вместо полного reloadServerPlaylists — быстрее,
      // и сразу видно в сайдбаре/медиатеке без лишнего запроса
      setSrvPlaylists((ps) => ps.map((p) => (p.id === target.id ? { ...p, icon, iconCoverUrl } : p)));
      // открытая страница этого же плейлиста сама иконку не знает — ремоунт
      // перечитает detail.icon (как renameFromMenu делает для имени)
      if (openPlaylistId === target.id) setPlBump((v) => v + 1);
      setIconPicker(null);
      showToast(t("toast.playlist.iconChanged"), "image");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.playlist.iconChangeFailed"), "x");
    } finally {
      setIconPickerBusy(false);
    }
  };

  // Сайдбар: плейлисты бывают только у серверной сессии. У анонима их нет
  // совсем — прежние «его» плейлисты были демо-заглушкой в useState: не
  // переживали перезапуск и не умели держать треки, а тост врал «Плейлист
  // создан». Пустой список → сайдбар честно показывает, что плейлистов нет.
  /** Трек брошен на плейлист. Один обработчик на ВСЕ зоны приёма — строку
   *  сайдбара, плитку медиатеки и страницу плейлиста: раньше зона была ровно
   *  одна (сайдбар), и владелец справедливо считал, что перенос «не работает»,
   *  когда плейлист не был виден в списке слева. */
  const dropTrackOnPlaylist = canSearch
    ? (playlistId: string, trackId: string) => {
        const name = srvPlaylists.find((p) => p.id === playlistId)?.name ?? t("app.unknownPlaylistName");
        api
          .addPlaylistTrack(playlistId, trackId)
          .then(async () => {
            await reloadServerPlaylists();
            showToast(t("toast.playlist.addedTrack", { name }), "list-music");
          })
          .catch((e: unknown) => showToast(e instanceof Error ? e.message : t("toast.playlist.addFailed"), "x"));
      }
    : undefined;

  /** Трек брошен на «Любимое» (2026-07-20, жалоба владельца «DnD не работает
   *  для любимых»). НЕ toggleLike: тот переключает, а перенос — жест «положить
   *  сюда», и бросок уже любимого трека снимал бы лайк (трек исчезал бы ровно
   *  тем движением, которым его кладут). Решение — в favoritesDrop.ts. */
  const dropTrackOnFavorites = (trackId: string) => {
    if (favoritesDropAction(trackId, likes) === "already") {
      showToast(t("toast.favorites.already"), "heart");
      return;
    }
    toggleLike(trackId); // добавляет + свой тост + серверная синхронизация
  };

  const sidebarPlaylists = canSearch
    ? srvPlaylists.map((p) => ({
        id: p.id,
        name: p.name,
        // Число треков уехало тихой цифрой к правому краю строки (набросок
        // владельца 04.08) — meta осталась только там, где есть что сказать
        // СВЕРХ числа: чей плейлист, совместность, скрытость.
        meta:
          p.role === "follower"
            ? p.available === false
              ? t("sidebar.playlistMeta.hiddenByOwner")
              : t("sidebar.playlistMeta.followedFrom", { count: p.trackCount, owner: p.ownerUsername })
            : p.role === "collaborator"
              ? t("sidebar.playlistMeta.collabFrom", { count: p.trackCount, owner: p.ownerUsername })
              : p.collaboratorsCount > 0
                ? t("sidebar.playlistMeta.shared", { count: p.trackCount })
                : "",
        count: p.trackCount,
        shared: p.role === "collaborator" || p.collaboratorsCount > 0,
        // 2026-07-17: подписки в реордер не входят (их позиции сервер не
        // хранит), скрытые владельцем — гаснут. 2026-07-20: закреплённые тоже
        // fixed — смысл закрепа «случайно не сдвинуть».
        fixed: p.role === "follower" || p.pinned,
        pinned: p.pinned,
        dimmed: p.role === "follower" && p.available === false,
        // T47b: иконка-обложка из манифеста @muza/core; T47c: track-иконка —
        // готовой ссылкой iconCoverUrl; нет/невалидна — PlaylistRow сама
        // рисует прежний фолбэк (users/list-music)
        cover: p.iconCoverUrl ?? playlistIconSrc(p.icon) ?? undefined,
      }))
    : [];

  // T16: обычный переход (НЕ назад/вперёд) — пушит в историю и опционально
  // синкает payload параметрических вью (сейчас только id открытого плейлиста).
  // Все клики по вкладкам должны идти через navigate(), а не голый setView,
  // иначе история не узнает о переходе.
  const navigate = (next: View, payload?: HistoryPayload) => {
    historyRef.current = pushHistory(historyRef.current, { view: next, payload });
    if (payload && "playlistId" in payload) setOpenPlaylistId(payload.playlistId ?? null);
    if (payload && "scPlaylistId" in payload) setOpenScPlaylistId(payload.scPlaylistId ?? null);
    setView(next);
  };

  /** Применить уже существующую запись истории (после goBack/goForward) —
   *  никакого пуша, просто синк view + openPlaylistId с записью стека. */
  const applyHistoryEntry = (entry: HistoryEntry<View>) => {
    setView(entry.view);
    setOpenPlaylistId(entry.payload?.playlistId ?? null);
    setOpenScPlaylistId(entry.payload?.scPlaylistId ?? null);
  };

  const navBack = () => {
    if (!canGoBack(historyRef.current)) return;
    historyRef.current = goBack(historyRef.current);
    applyHistoryEntry(currentEntry(historyRef.current));
  };

  const navForward = () => {
    if (!canGoForward(historyRef.current)) return;
    historyRef.current = goForward(historyRef.current);
    applyHistoryEntry(currentEntry(historyRef.current));
  };

  // Боковые кнопки мыши (XButton1/2 = «назад»/«вперёд»): проверено живьём в
  // T16 через OS-level SendInput (WM_XBUTTONUP) поверх реального окна Tauri —
  // WebView2 НЕ перехватывает их для своей навигации, до DOM долетает обычный
  // 'mouseup' с e.button===3|4 (а не 'auxclick' — его не проверяли, mouseup
  // достаточно). Гейт engineAvailable() — фича только в приложении; в вебе
  // (vite dev без Tauri) поведение отдаём браузеру, если он вообще так умеет.
  useEffect(() => {
    if (!engineAvailable()) return;
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        // Тот же принцип, что у Alt+← в хоткеях: «назад» в режиме
        // прослушивания закрывает оверлей, а не листает вкладки под ним.
        if (expandedRef.current) {
          setExpanded(false);
          return;
        }
        navBack();
      } else if (e.button === 4) {
        e.preventDefault();
        if (expandedRef.current) return;
        navForward();
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPlaylist = (id: string) => {
    // Страница плейлиста читает его с сервера — анониму открывать нечего
    // (плейлистов у него нет вовсе, см. sidebarPlaylists)
    if (!canSearch) {
      navigate("library");
      return;
    }
    navigate("playlist", { playlistId: id });
  };

  /** «Сохранить к себе» со страницы SC-плейлиста (2026-07-20): копия обычным
   *  своим плейлистом. Пакетного метода нет — треки по одному. */
  const saveScCopy = async (name: string, tracks: CatalogTrack[]) => {
    if (!canSearch) {
      showToast(t("toast.playlist.needsAccount"), "user");
      return;
    }
    try {
      const icon = pickRandomPlaylistIcon(usedPlaylistIcons());
      const created = await api.createPlaylist(name, icon);
      for (const tr of tracks) await api.addPlaylistTrack(created.id, tr.id);
      await reloadServerPlaylists();
      showToast(t("views.scPlaylist.savedCopy", { name }), "list-music");
      navigate("playlist", { playlistId: created.id });
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("views.scPlaylist.saveFailed"), "x");
    }
  };

  const addToPlaylist = async (playlistId: string, playlistName: string) => {
    if (!plPick || plPick.length === 0) return;
    const picked = plPick;
    setPlPick(null);
    try {
      // пакетного метода в API нет — по одному, как saveOfflinePlaylist
      for (const track of picked) await api.addPlaylistTrack(playlistId, track.id);
      await reloadServerPlaylists();
      showToast(
        picked.length === 1
          ? t("toast.playlist.addedTrack", { name: playlistName })
          : t("toast.playlist.addedTracks", { name: playlistName, count: picked.length }),
        "list-music",
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.playlist.addFailed"), "x");
    }
  };

  const accentAttr = prefs.accent === "blue" || prefs.accent === "custom" ? undefined : prefs.accent;
  const isLight = prefs.theme === "light";
  // Скрим (T5): затемняющий слой поверх фоновой обложки (bgDim). На тёмной
  // теме — чёрный, как раньше; на светлой — тон дефолтного --bg-0 светлой темы
  // (#f3f1ed → 243,241,237), иначе сквозь полупрозрачные светлые панели
  // (--glass-panel) просвечивает серо-чёрная муть — тот самый «баг белой темы».
  const scrimRgb = isLight ? "243, 241, 237" : "0, 0, 0";
  // ПЕРЕЕЗД 2026-08-02 (фаза 2 веб-паритета): все формулы CSS-переменных корня
  // (акцент, стекло по зонам, скругления по типам, размеры зон, типографика,
  // плотность, длительности, zoom) уехали в ОБЩИЙ движок темы —
  // packages/app/src/theme/themeVars.ts. Раньше они жили прямо здесь, а веб
  // знал лишь восемь ключей из сорока: ряд настройки в браузере было нечем
  // применить. Объект тот же до символа, изменилось только место сборки; сюда
  // движку передаётся то, чего он знать не может, — состояние окна и трека.
  //
  // Мемоизация (03.08): buildThemeVars — чистая, но не дешёвая функция (клон
  // всего профиля настроек, полтора десятка условных spread'ов, цветовая
  // арифметика с Math.pow на канал, объект из ~40 CSS-переменных). Вход у неё
  // ровно этот, поэтому те же аргументы дают побайтово тот же результат — ни
  // один пиксель и ни одна переменная не меняются, меняется только число
  // вызовов.
  // ⚠️ В зависимостях — ВЕСЬ `prefs`, а не подполя. Движок читает все ключи
  // ThemePrefs (packages/app/src/theme/themeVars.ts), и точечный деп-лист
  // протухнет на следующей добавленной настройке: человек дёрнет новый
  // ползунок — и не произойдёт НИЧЕГО, пока он не тронет какую-нибудь другую
  // настройку. Целый prefs ошибается в сторону лишнего пересчёта — верную.
  //
  // Фон караоке: собирается из настроек ОДИН раз на изменение профиля, а не на
  // каждый рендер — иначе новый объект пропа заставлял бы оверлей перерисовывать
  // задник на каждый тик позиции, то есть ровно то, от чего мы только что ушли.
  const karaokeBackdrop = useMemo(() => backdropViewFromPrefs(prefs, "scene"), [prefs]);
  const rootStyle = useMemo(
    () =>
      ({
        position: "absolute",
        inset: 0,
        background: "var(--bg-0)",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
        ...buildThemeVars(prefs, { coverTint, wideSidebar: wideEnoughForSidebar }),
      }) as React.CSSProperties,
    [prefs, coverTint, wideEnoughForSidebar],
  );

  // T15: вращение диска включено только когда общий anims включён и OS не
  // просит reduced-motion (двойная защита — как bassShake в ListeningMode).
  // Выключено → диски остаются на месте (статичная версия), не пропадают.
  const orbitActive = prefs.anims && !reducedMotion;
  // Караоке-оверлей непрозрачен и накрывает фон целиком, а диски продолжали
  // крутиться под ним — и не «просто крутиться»: их общий контейнер несёт
  // filter: blur(--blur-scenery)=64px, поэтому каждый кадр вращения заставлял
  // браузер заново размывать полный экран. Ровно то, на что жаловался владелец
  // 02.08 («в полноэкранном режиме песни ФПС в играх падает»).
  // ПАУЗА, а не снятие класса: снятый класс сбрасывает угол в 0, и на выходе
  // из караоке (плавное гашение, --dur-slow) прыжок был бы виден. Пауза
  // замораживает текущий угол и отпускает GPU-слой вместе с will-change.
  // Вторая причина паузы — окна не видно (свёрнуто/накрыто): те же полноэкранные
  // размытия каждый кадр, только показывать их вообще некому. Тот же приём
  // паузы работает и здесь — вернули окно, вращение продолжается с того угла,
  // на котором остановилось, без прыжка.
  const orbitPaused = expanded || !windowVisible;

  // Фон за интерфейсом (Stage 6): тип + затемнение поверх (читаемость).
  // Фоны из обложки требуют самой обложки — нет её (ничего не играет / у трека
  // её нет), значит фона нет; та же идиома, что у bgType==="image" ниже.
  const coverBg = track?.cover ?? null;
  const backdrop =
    prefs.bgType === "cover" && coverBg ? (
      <img
        key={coverBg}
        src={coverBg}
        alt=""
        className="muza-fade"
        style={{
          position: "absolute",
          inset: "-10%",
          width: "120%",
          height: "120%",
          objectFit: "cover",
          filter: "blur(var(--blur-scenery))",
          opacity: 0.22,
        }}
      />
    ) : prefs.bgType === "animated" && coverBg ? (
      // Два диска-обложки вращаются навстречу друг другу к центру (левый —
      // по умолчанию по часовой, правый — против; invert меняет пары).
      // ПЕРФ: blur/opacity — ОДИН раз на общем контейнере (не по слою на
      // картинку); вращение — только transform на обёртке БЕЗ key, картинка
      // внутри — key={track.cover} только на ней, поэтому смена трека
      // ремонтирует (и фейдит через muza-fade) только img, а идущая CSS-
      // анимация вращения на обёртке не прерывается и угол не сбрасывается.
      // Фикс по ревью T15: диаметр диска = max(140vw, 140vh), а не 140% от
      // высоты контейнера — на ультрашироких окнах (напр. 3440×1440) диск,
      // посчитанный от высоты, не дотягивался до центра при offset ±20%
      // ширины (см. .superpowers/sdd/task-T15-report.md, «Фикс по ревью
      // T15»). max(vw,vh) гарантирует diameter ≥ 140% ширины (offset -20%
      // ⇒ диск сам по себе перекрывает всю ширину контейнера с запасом) И
      // diameter ≥ 140% высоты (та же вертикальная маржа, что была раньше)
      // — при ЛЮБОМ соотношении сторон окна, не только при height ≥ width.
      // Ручки раскрыты (спека настроек 19.07, зона 1): прозрачность, диаметр
      // и заход за край — из prefs; дефолты .22/140/−20 = прежним зашитым.
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          filter: "blur(var(--blur-scenery))",
          opacity: prefs.bgAnimOpacity / 100,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `-${prefs.bgAnimEdge}%`,
            height: `max(${prefs.bgAnimScale}vw, ${prefs.bgAnimScale}vh)`,
            aspectRatio: "1",
            transform: "translateY(-50%)",
            borderRadius: "50%",
            overflow: "hidden",
          }}
        >
          <div
            className={
              orbitActive ? (prefs.bgAnimatedInvert ? "muza-orb-spin--ccw" : "muza-orb-spin--cw") : undefined
            }
            data-orb-paused={orbitPaused ? "" : undefined}
            style={{ width: "100%", height: "100%" }}
          >
            <img
              key={coverBg}
              src={coverBg}
              alt=""
              className="muza-fade"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            top: "50%",
            right: `-${prefs.bgAnimEdge}%`,
            height: `max(${prefs.bgAnimScale}vw, ${prefs.bgAnimScale}vh)`,
            aspectRatio: "1",
            transform: "translateY(-50%)",
            borderRadius: "50%",
            overflow: "hidden",
          }}
        >
          <div
            className={
              orbitActive ? (prefs.bgAnimatedInvert ? "muza-orb-spin--cw" : "muza-orb-spin--ccw") : undefined
            }
            data-orb-paused={orbitPaused ? "" : undefined}
            style={{ width: "100%", height: "100%" }}
          >
            <img
              key={coverBg}
              src={coverBg}
              alt=""
              className="muza-fade"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        </div>
      </div>
    ) : prefs.bgType === "color" ? (
      <div style={{ position: "absolute", inset: 0, background: prefs.bgColor }} />
    ) : prefs.bgType === "gradient" ? (
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, ${prefs.bgColor} 0%, ${prefs.bgColor2} 100%)` }} />
    ) : prefs.bgType === "image" && prefs.bgImageUrl ? (
      <img
        src={prefs.bgImageUrl}
        alt=""
        style={{
          position: "absolute",
          inset: "-5%",
          width: "110%",
          height: "110%",
          objectFit: "cover",
          filter: prefs.blurScenery > 0 ? "blur(var(--blur-scenery))" : undefined,
        }}
      />
    ) : null;

  // Живое состояние для бриджа плагинов — обновляем перед каждым рендером
  // (мутация ref в рендере допустима; замыкания бриджа читают .current).
  pluginLiveRef.current = {
    api,
    canSearch,
    pb: {
      track,
      queue: pb.queue,
      playing,
      buffering: pb.buffering,
      // ГЕТТЕР, а не поле: этот объект пересобирается на рендере App, а
      // рендеров при играющей музыке почти нет (позиция уехала из состояния,
      // см. positionStore.ts). Полем плагин получал бы позицию, застывшую на
      // момент последней смены трека. Не «упрощать» обратно в `pos,`.
      get pos() {
        return posStore.get();
      },
      vol,
      toggle: pb.toggle,
      pause: pb.pause,
      next: pb.next,
      prev: pb.prev,
      seek: pb.seek,
      setVol: pb.setVol,
      setRate: pb.setRate,
      enqueue: pb.enqueue,
      removeFromQueue: pb.removeFromQueue,
      reorderQueue: pb.reorderQueue,
      clearQueue: pb.clearQueue,
      insertInQueue: pb.insertInQueue,
      index: pb.index,
    },
    likes,
    setLike: (trackId, on) =>
      setLikes((ls) => (on ? (ls.includes(trackId) ? ls : [...ls, trackId]) : ls.filter((x) => x !== trackId))),
    reloadPlaylists: reloadServerPlaylists,
    usedPlaylistIcons,
    toast: (text, kind) => showToast(text, (kind as never) ?? ("puzzle" as never)),
    openTab: plugins.openTab,
    openPanel: plugins.openPanel,
    openOverlay: plugins.openOverlay,
    closeSurface: () => {
      plugins.closeTab();
      plugins.closePanel();
      plugins.closeOverlay();
    },
  };

  // Плагинные кнопки бара с наложенным рантайм-состоянием (иконка/активность/бейдж)
  const pluginBarButtons = plugins.barButtons.map((b) => {
    const rt = plugins.barButtonRuntime(b.pluginId, b.slotId);
    return { ...b, icon: rt.state?.icon || b.icon, active: rt.state?.active ?? false, badge: rt.badge };
  });

  // Глобальные действия контекстного меню (shell/menuActions.ts). Пересобирается
  // каждый рендер сознательно: потребитель один (ContextMenuProvider), а
  // стабильность его контекст-значения от этого объекта не зависит.
  const menuCtx: MenuContext = {
    playNext: playNextCatalog,
    queueTrack: queueCatalog,
    startRadio: (tr) => void startRadio(tr),
    addToPlaylist: (tr) => setPlPick([tr]),
    isLiked: (id) => likes.includes(id),
    toggleLike: (id) => toggleLike(id),
    jamAdd: jam.active && !jam.isHost ? (tr) => void jam.addTrack(tr.id) : null,
    shareTrack: (tr) => setShareData({ kind: "track", title: tr.title, artist: tr.artist, coverUrl: tr.coverUrl }),
    showVersions: (tr) => setVersionsTrack(tr),
    replaceInFavorites: (tr) => setReplaceCtx({ track: tr, target: { kind: "favorites" } }),
    isPinned: (id) => pins.has(id),
    toggleOffline: (tr) => void toggleOffline(tr),
    openPlaylist: (id) => openPlaylist(id),
    // чужой плейлист (совместный ИЛИ подписка, 2026-07-17) переименовывать/
    // удалять нельзя; не найден/аноним → "owner" (поведение T17 как было)
    playlistRole: (id) => (canSearch && srvPlaylists.find((x) => x.id === id)?.role) || "owner",
    playPlaylist: (id) => void withPlaylistTracks(id, (tracks) => playCatalog(tracks, tracks[0].id)),
    queuePlaylistNext: (id) =>
      void withPlaylistTracks(id, (tracks) => {
        pbRaw.enqueue(tracks.map(fromCatalog), pbRaw.index + 1);
        showToast(t("toast.queue.playlistNext"), "list-start");
      }),
    queuePlaylist: (id) =>
      void withPlaylistTracks(id, (tracks) => {
        pbRaw.enqueue(tracks.map(fromCatalog));
        showToast(t("toast.queue.playlistAdded"), "list-music");
      }),
    sharePlaylist: (id) =>
      void api
        .getPlaylist(id)
        .then((detail) =>
          setShareData({
            kind: "playlist",
            name: detail.name,
            trackCount: detail.tracks.length,
            owner: detail.ownerUsername,
            covers: detail.tracks.map((x) => x.coverUrl).filter((c): c is string => c !== null),
          }),
        )
        .catch(() => showToast(t("views.playlist.loadFailed"), "x")),
    savePlaylistOffline: (id) => void withPlaylistTracks(id, (tracks) => void saveOfflinePlaylist(tracks)),
    openCreatePlaylist: () => setDialogOpen(true),
    openAddLink: () => setAddLinkOpen(true),
    openImport: () => setImportOpen(true),
    openJoinCode: () => setJoinOpen(true),
    playNextMany: (tracks) => {
      pbRaw.enqueue(tracks.map(fromCatalog), pbRaw.index + 1);
      showToast(t("toast.queue.selectionNext", { count: tracks.length }), "list-start");
    },
    queueMany: (tracks) => {
      pbRaw.enqueue(tracks.map(fromCatalog));
      showToast(t("toast.queue.selectionAdded", { count: tracks.length }), "list-music");
    },
    addManyToPlaylist: (tracks) => setPlPick(tracks),
    // только ДОБАВЛЯЕТ: toggle снимал бы лайк с уже лайкнутых (урок
    // favoritesDrop 20.07); ошибки синка по трекам не откатываем — пачка
    likeMany: (ids) => {
      const fresh = ids.filter((id) => !likes.includes(id));
      if (fresh.length === 0) {
        showToast(t("toast.favorites.already"), "heart");
        return;
      }
      setLikes((ls) => [...ls, ...fresh.filter((id) => !ls.includes(id))]);
      if (canSearch) for (const id of fresh) if (isCatalogId(id)) api.addFavorite(id).catch(() => undefined);
      showToast(t("toast.favorites.likedMany", { count: fresh.length }), "heart");
    },
    // общий bulk-путь пинов с его же тостами прогресса/итога
    pinMany: (tracks) => void saveOfflinePlaylist(tracks),
    renamePlaylist: (pl) => {
      setPlRenameValue(pl.name);
      setPlRename(pl);
    },
    changePlaylistIcon: (id) => openIconPicker(id),
    playlistPinned: (id) => srvPlaylists.find((x) => x.id === id)?.pinned ?? false,
    togglePlaylistPinned: (id) => void togglePlaylistPinned(id),
    deletePlaylist: (pl) => setPlDelete(pl),
    unfollowPlaylist: (pl) => void unfollowFromMenu(pl),
    // буфер обмена: паттерн ShareDialog (navigator.clipboard, не Tauri-плагин)
    copyText: (text, doneToast) => {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast(doneToast, "copy"))
        .catch(() => showToast(t("dialogs.copyFailed"), "x"));
    },
    pluginMenuItems: (kind) => plugins.menuItems(kind),
    notifyPlugin: (pluginId, slotId, payload) => plugins.notifySlot(pluginId, slotId, "click", payload),
  };

  return (
    <LanguageProvider lang={prefs.language}>
    {/* РЕЖИМ ПРАВКИ ВИДА — вокруг всего дерева: в нём хватаются не только края
        зон (LookEditLayer), но и сами элементы — вкладки сайдбара, карточки
        разделов настроек, полки главной, блоки статистики. Признак «режим
        включён» и ОБЩИЙ стек отмены живут здесь, потому что нужны сразу в
        четырёх разных углах дерева; обоснование — shell/lookReorder.tsx. */}
    <LookEditProvider active={lookEdit} apiRef={lookEditRef}>
    {/* data-muza-layer-root — ЦЕЛЬ ПОРТАЛА плавающих слоёв (меню, диалоги,
        выпадашки, палитра). Именно ЭТОТ div, а не body: на нём инлайном лежат
        все токены темы и zoom масштаба интерфейса, а свойств, создающих
        содержащий блок для position: fixed (filter, transform, backdrop-filter),
        у него нет — в отличие от стеклянных зон внутри. Разбор с замером —
        packages/ui/src/lib/layerRoot.js. */}
    <div data-theme={prefs.theme} data-accent={accentAttr} data-radius={prefs.radius} data-muza-layer-root="" style={rootStyle}>
    {/* DragLayer ВНУТРИ этого div, а не снаружи: превью переноса рисуется его
        потомком и берёт токены отсюда (тема/акцент/--glass-panel живут inline
        на этом div, а не в :root). Старый HTML5-гость вешался на document.body
        и по той же причине не следовал теме пользователя — резолвился
        дефолтами из themes.css. position:fixed превью при этом не обрезается:
        у rootStyle overflow:hidden, но нет transform/filter, поэтому блок-
        контейнер для fixed — вьюпорт, а не этот div. */}
    <WarmerProvider value={warmer}>
    {/* Провайдер меню ВНУТРИ theme-div и LanguageProvider (его <Menu> берёт
        токены и переводы), но СНАРУЖИ DragLayer — вью под ним зовут хук
        useContextMenu(), App открывает меню через menuApiRef. */}
    <ContextMenuProvider ctx={menuCtx} apiRef={menuApiRef}>
    <DragLayer>
      {/* Кадры прихода и ухода «Сейчас играет» — см. NOWPLAYING_ANIM_CSS. */}
      <style>{NOWPLAYING_ANIM_CSS}</style>
      {/* CSS-тир (Stage 6): свой CSS поверх всех токенов — «опасная зона» */}
      {prefs.customCssOn && prefs.customCss ? <style>{prefs.customCss}</style> : null}
      {/* CSS плагинов (T44): статический contributes.css + динамический
          UI.applyCss, каждый в своём <style data-plugin>, ПОСЛЕ customCss */}
      {plugins.injectedCss.map((c, i) => (
        // ключ композитный: у плагина может быть И contributes.css, И applyCss —
        // два <style> с одним data-plugin, ключ по индексу разводит их
        <style key={`${c.pluginId}-${i}`} data-plugin={c.pluginId}>
          {c.css}
        </style>
      ))}
      {backdrop}
      {backdrop && prefs.bgDim > 0 ? (
        <div style={{ position: "absolute", inset: 0, background: `rgba(${scrimRgb}, ${prefs.bgDim / 100})` }} />
      ) : null}

      {/* Своя полоса заголовка: три кнопки окна справа, остальное — зона
          перетаскивания. Логотипа тут НЕТ намеренно (он один, в сайдбаре).
          Стоит ПЕРЕД сеткой в разметке, но позиционирована абсолютно и несёт
          свой zIndex — порядок в DOM тут ничего не решает. */}
      <TitleBar
        maximized={maximized}
        onMinimize={minimizeWindow}
        onToggleMaximize={toggleMaximizeWindow}
        onClose={closeWindow}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          // minmax(0,1fr) вместо 1fr: у 1fr минимум — min-content, поэтому
          // длинное название трека или широкая плитка РАСПИРАЛИ центральную
          // колонку и выдавливали соседей. Ноль минимума отдаёт решение сетке.
          gridTemplateColumns: nowPlayingDocked
            ? "var(--w-sidebar) minmax(0, 1fr) var(--w-nowplaying)"
            : "var(--w-sidebar) minmax(0, 1fr)",
          gap: "var(--gap-zone)",
          // ПОЛЕ ОКНА СЧИТАЕТ ДВИЖОК ТЕМЫ (--win-pad, themeVars.ts). Флет
          // (набросок владельца 04.08 вечером): поле 0, зоны впритык к краям,
          // полоса заголовка ложится ПОВЕРХ контента — она position:absolute
          // и в раскладке не участвует. «Воздушный» вид (пресет «Воздух»):
          // поле равно высоте полосы со всех четырёх сторон — симметрия, о
          // которой владелец просил утром 04.08. Знание о том, какой вид
          // включён, живёт в одном месте — здесь его больше нет.
          padding: "var(--win-pad, var(--h-titlebar))",
          // Сколько места занимает полоса плеера снизу, считает движок темы
          // (--pad-under-bar): у прижатой полосы это высота + один зазор, у
          // плавающей — высота + два. Здесь этого знания больше нет.
          paddingBottom: "var(--pad-under-bar, calc(var(--h-playerbar) + 2 * var(--gap-zone)))",
        }}
      >
        <Sidebar
          view={view}
          setView={(v) => {
            plugins.closeTab();
            navigate(v);
          }}
          navItems={prefs.navItems}
          pluginNav={plugins.navTabs}
          pluginKeys={plugins.pluginNavKeys}
          activePluginKey={
            pluginTabActive
              ? plugins.navTabs.find((n) => n.pluginId === pluginTabActive.pluginId && n.tabId === pluginTabActive.tabId)?.key ?? null
              : null
          }
          onSelectPluginTab={(pid, tab) => plugins.openTab(pid, tab)}
          // Перестановка вкладок в режиме правки вида (Ctrl+E): панель отдаёт
          // готовую компоновку, App только кладёт её в профиль.
          onSetNavItems={(items) => setPrefs({ ...prefs, navItems: items })}
          playlists={sidebarPlaylists}
          favoritesCount={likes.length}
          onOpenFavorites={() => navigate("favorites")}
          onCreatePlaylist={() => setDialogOpen(true)}
          onOpenPlaylist={openPlaylist}
          // T17: ПКМ по плейлисту — контекст-меню (открыть/переименовать/удалить)
          onPlaylistMenu={openPlaylistMenu}
          // DnD: строка трека брошена на плейлист (только серверные списки)
          onDropTrack={dropTrackOnPlaylist}
          // DnD: трек брошен на «Любимое» — работает и без серверной сессии
          // (лайки живут локально у анонима), поэтому без canSearch-гейта
          onDropTrackOnFavorites={dropTrackOnFavorites}
          // DnD: реордер плейлистов за ручку-⠿ — общий с Библиотекой порядок
          onReorderPlaylists={reorderPlaylists}
          isAdmin={isAdmin}
          onOpenHotkeys={openHotkeys}
          update={update}
        />
        {/* key на main: смена экрана пересоздаёт скролл-контейнер — прокрутка
            прошлого экрана не протекает в новый (короткий экран улетал вверх) */}
        {/* ⚠️ У ЦЕНТРАЛЬНОЙ ЗОНЫ ФОНА НЕТ И БЫТЬ НЕ ДОЛЖНО. Правило владельца,
            записанное задолго до стекла: подложку имеют ТОЛЬКО сайдбар, полоса
            плеера и «Сейчас играет» — всё остальное лежит прямо на сценографии.
            Волна «больше стекла» 03.08 выдала сюда --glass-zone ради контраста
            (подпись трека на светлой обложке читалась на 2.75:1) — и владелец
            завернул это в тот же день: содержимое получило подложку, которой у
            него никогда не было, а рельс настроек оказался стеклом ПОВЕРХ
            стекла и потемнел относительно соседних панелей.
            Контраст на сценографии решается плотностью плёнок у самих плиток и
            строк, а не заливкой всей зоны. Вернёшь фон сюда — вернёшь обе беды
            разом. */}
        <main
          /* key на НАРИСОВАННОМ экране, а не на выбранном: во время ухода
             нарисован ещё прежний, и ремонт поддерева (то есть сброс прокрутки)
             обязан случиться вместе с приходом нового, а не в начале ухода —
             иначе уходить снова стало бы некому. */
          key={rendered}
          style={{
            overflowY: "auto",
            scrollbarWidth: "none",
            borderRadius: "var(--r-lg)",
            // ОТКРЫТАЯ ПАНЕЛЬ ОСВОБОЖДАЕТ СЕБЕ МЕСТО, А НЕ НАКРЫВАЕТ СОДЕРЖИМОЕ.
            //
            // Регрессия редизайна 04.08, найденная проверкой: на экранах, где
            // панель не колонка (Поиск, Медиатека, Статистика, админка), она
            // оставалась плавающей с zIndex 45 и ЖИВЫМИ кликами поверх списка.
            // А lyricsOn стартует true — значит сразу после запуска правый край
            // строки трека (сердечко, длительность, «ещё») лежал ПОД панелью и
            // не нажимался вовсе.
            //
            // Поле, а не сжатие колонки сетки: содержимое остаётся во всю
            // ширину, когда панель закрыта, и никакого обрыва на пороге окна,
            // из-за которого всё и затевалось. Плавно — чтобы открытие панели
            // не дёргало список.
            paddingRight: npMounted && !nowPlayingDocked ? "calc(var(--w-nowplaying) + var(--gap-zone))" : 0,
            /* Поле под панель едет ВМЕСТЕ с самой панелью — одна длительность,
               иначе содержимое доезжает после того, как панель уже встала. */
            transition: "padding-right var(--dur-panel-in) var(--ease-out)",
          }}
        >
          {/* Своя граница на экран (02.08). Раньше единственная жила на корне
              (main.tsx), и ошибка рендера ЛЮБОГО экрана уносила всё окно в
              крашскрин: очередь, позиция и звук вместе с ним. Теперь падает
              только содержимое вкладки — бар, сайдбар и музыка целы.
              Граница ВНУТРИ <main>, а не снаружи: так уцелевает скролл-
              контейнер и раскладка сетки, заглушка садится ровно на его место.
              resetKey={view} — ушёл с упавшего экрана и вернулся, он пробует
              снова; кнопка в заглушке делает то же, не сходя с места. */}
          <ErrorBoundary resetKey={rendered} fallback={(retry, msg) => <ViewCrash onRetry={retry} message={msg} />}>
          <div className="muza-view" ref={viewFade.ref} data-view-phase={viewFade.phase}>
            {rendered === "home" ? (
              <HomeFeed
                api={api}
                canSearch={canSearch}
                greetName={greetName}
                currentId={track?.id ?? null}
                playing={playing}
                likes={likes}
                onPlayCatalog={playCatalog}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onCatalogMenu={openCatalogMenu}
                onNotify={showToast}
                onOpen={navigate}
                onOpenWrapped={canSearch ? () => setWrappedOpen(true) : undefined}
                sectionOrder={normalizeHomeSections(prefs.homeSections)}
                // Порядок полок в режиме правки вида (Ctrl+E). Сохраняем ВЕСЬ
                // видимый порядок, а не одну переставленную полку: состав ленты
                // считает сервер и меняет его от захода к заходу, и «сдвиг
                // относительно канона» разъехался бы с ним на первой же новой
                // полке. Прежние ключи дописываются ХВОСТОМ: полка «Потому что
                // ты любишь X» пропадает вместе с сигналом и возвращается через
                // неделю — её место человек задавал один раз и ждёт его на
                // месте (лишнее отрезает потолок в normalizeHomeSections).
                onReorderSections={(keys) => {
                  lookEditRef.current?.pushUndo({ homeSections: prefs.homeSections });
                  setPrefs({ ...prefs, homeSections: normalizeHomeSections([...keys, ...prefs.homeSections]) });
                }}
              />
            ) : rendered === "search" ? (
              <SearchView
                api={api}
                canSearch={canSearch}
                currentId={track?.id ?? null}
                playing={playing}
                likes={likes}
                query={searchQuery}
                onQueryChange={setSearchQuery}
                instantSearch={prefs.instantSearch}
                searchScope={prefs.searchScope}
                searchGrouping={prefs.searchGrouping}
                onPlayCatalog={playCatalog}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onNotify={showToast}
                onCatalogMenu={openCatalogMenu}
                onOpenPlaylist={openPlaylist}
                onOpenScPlaylist={(id) => navigate("scPlaylist", { scPlaylistId: id })}
                onPlaylistsChanged={() => void reloadServerPlaylists()}
              />
            ) : rendered === "scPlaylist" && openScPlaylistId ? (
              <ExternalPlaylistView
                api={api}
                playlistId={openScPlaylistId}
                currentId={track?.id ?? null}
                playing={playing}
                likes={likes}
                rowShow={prefs.rowShow}
                onPlayCatalog={playCatalog}
                onLike={toggleLike}
                onNotify={showToast}
                onTrackMenu={openCatalogMenu}
                canSave={canSearch}
                onSaveCopy={saveScCopy}
              />
            ) : rendered === "favorites" ? (
              <FavoritesView
                api={api}
                canSearch={canSearch}
                likes={likes}
                currentId={track?.id ?? null}
                playing={playing}
                onPlayCatalog={playCatalog}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onCatalogMenu={(tr, e) => openCatalogMenu(tr, e, { inFavorites: true })}
                onNotify={showToast}
              />
            ) : rendered === "playlist" && openPlaylistId ? (
              <PlaylistView
                key={`${openPlaylistId}:${plBump}`}
                api={api}
                playlistId={openPlaylistId}
                userId={userId}
                likes={likes}
                currentId={track?.id ?? null}
                playing={playing}
                onPlayCatalog={playCatalog}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onNotify={showToast}
                onReplaceVersion={(tr, reload) =>
                  setReplaceCtx({ track: tr, target: { kind: "playlist", playlistId: openPlaylistId, reload } })
                }
                onShare={(detail) =>
                  setShareData({
                    kind: "playlist",
                    name: detail.name,
                    trackCount: detail.tracks.length,
                    owner: detail.ownerUsername,
                    covers: detail.tracks.map((t) => t.coverUrl).filter((c): c is string => c !== null),
                  })
                }
                onSaveOffline={(tracks) => void saveOfflinePlaylist(tracks)}
                onDropTrack={dropTrackOnPlaylist}
                onChanged={() => void reloadServerPlaylists()}
                onDeleted={() => {
                  setOpenPlaylistId(null);
                  navigate("home");
                }}
                onChangeIcon={(fromTrack) => openIconPicker(openPlaylistId, fromTrack)}
              />
            ) : rendered === "library" ? (
              <LibraryView
                api={api}
                canSearch={canSearch}
                srvPlaylists={srvPlaylists}
                currentId={track?.id ?? null}
                playing={playing}
                favoritesCount={likes.length}
                onOpenFavorites={() => navigate("favorites")}
                onOpenPlaylist={openPlaylist}
                onPlaylistMenu={openPlaylistMenu}
                onPlayLocal={playLocal}
                onAddToPlaylist={(t) => setPlPick([t])}
                onAddLink={() => setAddLinkOpen(true)}
                onImport={() => setImportOpen(true)}
                onJoinCode={() => setJoinOpen(true)}
                onNotify={showToast}
                onDropTrack={dropTrackOnPlaylist}
                onReorderPlaylists={reorderPlaylists}
                onPlaylistsChanged={() => void reloadServerPlaylists()}
              />
            ) : rendered === "stats" ? (
              <StatsView
                api={api}
                canSearch={canSearch}
                prefs={prefs}
                currentId={track?.id ?? null}
                playing={playing}
                likes={likes}
                onPlayCatalog={playCatalog}
                onLike={toggleLike}
                onCatalogMenu={openCatalogMenu}
                onCustomize={() => {
                  navigate("settings");
                  setSettingsIntent({ sub: "stats", nonce: Date.now() });
                }}
                // Порядок блоков в режиме правки вида (Ctrl+E) — тот же
                // список, что переставляют стрелками в настройках.
                onSetStatsBlocks={(statsBlocks) => setPrefs({ ...prefs, statsBlocks })}
              />
            ) : rendered === "admin" ? (
              <AdminView api={api} />
            ) : (
              <SettingsView
                api={api}
                serverSession={canSearch}
                prefs={prefs}
                setPrefs={setPrefs}
                username={username}
                isAdmin={isAdmin}
                onLogout={onLogout}
                onNotify={showToast}
                onOpenHotkeys={openHotkeys}
                onPluginsChanged={plugins.refresh}
                intent={settingsIntent}
                onIntentUsed={clearSettingsIntent}
                // Живой трек для честного предпросмотра Discord RPC: обложка —
                // СЫРАЯ (rawCover, как в реальной активности), не кроп useCoverArt
                nowPlaying={
                  track
                    ? { title: track.title, artist: track.artist, album: track.album, cover: rawCover, duration: track.duration }
                    : null
                }
              />
            )}
          </div>
          </ErrorBoundary>
        </main>
        {npMounted ? (
          // Два гейта позиции (03.08, см. positionStore.ts):
          // • номер активной строки — ЖИВОЙ всегда: текст обязан следить за
          //   песней, иначе на выходе из караоке он поедет прокруткой;
          // • само число pos — только когда караоке НЕ открыто. Единственный
          //   потребитель этого пропа внутри панели — часы догона видео
          //   (useVideoSync), а видео при открытом караоке и так на паузе (см.
          //   playing ниже). Караоке закрылось — панель получит точную позицию
          //   в ТОМ ЖЕ коммите, что и playing: догонять нечего.
          <DerivedPositionScope store={posStore} compute={lineAt}>{(activeLine) => (
          <PositionScope store={posStore} live={!expanded}>{(pos) => (
          <NowPlayingPanel
            track={track}
            lyrics={lyrics}
            lyricsLoading={lyricsLoading}
            liked={track ? likes.includes(track.id) : false}
            onLike={() => track && toggleLike(track.id)}
            activeLine={activeLine}
            lyricsAutoScroll={prefs.lyricsAutoScroll}
            lyricsEndNote={prefs.lyricsEndNote}
            lyricsPanelLines={prefs.lyricsPanelLines}
            onSeekLine={seekLine}
            onExplain={setMeaningLine}
            videoUrl={trackVideoUrl}
            pos={pos}
            // `&& !expanded` — единственный потребитель этого пропа внутри
            // панели — часы видео (useVideoSync), а видео ДЕКОДИРУЕТСЯ, пока
            // элемент не на паузе, даже когда его никто не видит. Открытый
            // караоке накрывает панель непрозрачным оверлеем целиком; из
            // самой панели «меня перекрыли» не видно (CSS-видимость у неё
            // честная), поэтому решение принимает хозяин — здесь.
            // Жалоба владельца 02.08 про ФПС в играх.
            playing={playing && !expanded}
            speed={pb.speed}
            // Окно свёрнуто/накрыто — панель гасит и цикл догона, и сам
            // видеодекодер (см. проп в NowPlayingPanel).
            windowVisible={windowVisible}
            onVideoError={refreshTrackVideo}
            style={nowPlayingStyle}
            // Крестик теперь ЕСТЬ ВСЕГДА. Раньше на слушательских экранах его
            // не было, и шапка панели там была голым заголовком, а на
            // остальных — строкой с кнопкой 30px: при переходе содержимое
            // панели прыгало по вертикали. Плюс закрыть панель стало можно
            // прямо на ней, а не только кнопкой в полосе плеера.
            onClose={() => setLyricsOn(false)}
            // Уход закончился раньше страховочного таймера — снимаем узел
            // сразу (образец — Menu.jsx). Проверка target === currentTarget
            // обязательна: внутри панели свои анимации (обложка, строки).
            onAnimationEnd={(e) => {
              if (npClosing && e.target === e.currentTarget) finishNpClose();
            }}
          />
          )}</PositionScope>
          )}</DerivedPositionScope>
        ) : null}

        {/* ЯЗЫЧОК ВОЗВРАТА (жалоба владельца 04.08: «я не вижу никакого
            язычка, чтобы открыть это окно; если я его закрыл, то не понимаю,
            где его снова открыть»). Узкая полоска у правой кромки окна —
            единственный след закрытой панели. Ширина 12px почти целиком
            ложится в зазор между содержимым и кромкой (--gap-zone, 8px при
            стандартных настройках), поэтому строк и плиток она не режет:
            у самих списков внутри есть свои поля. Высота 72px делает её
            заметной, не превращая в стену.
            Обёртка нужна только чтобы посадить язычок ровно по центру ЗОНЫ
            СОДЕРЖИМОГО (между полосой заголовка и полосой плеера), а не окна;
            кликов она не ловит — pointerEvents снят. */}
        {npHandleVisible ? (
          <div
            style={{
              position: "absolute",
              top: "var(--win-pad, 0px)",
              bottom: "var(--pad-under-bar, calc(var(--h-playerbar) + 2 * var(--gap-zone)))",
              right: 0,
              display: "flex",
              alignItems: "center",
              pointerEvents: "none",
              zIndex: 44,
            }}
          >
            {/* ⚠️ ЯЗЫЧОК ОТКЛЕИВАЛСЯ ОТ КРОМКИ (жалоба владельца, закрыта
                06.08). Здесь стояло `translateX(-4px)` на наведении: полоска
                целиком отъезжала влево, и справа от неё, между ней и кромкой
                окна, открывалась полоса фона в 4px на всю высоту язычка. Читалось
                ровно как «отвалился». Теперь правый край ПРИБИТ: рост идёт
                масштабом от правой грани, элемент тянется навстречу курсору,
                а к кромке остаётся приклеенным. Transform по-прежнему один —
                раскладка не пересчитывается ни на одном кадре. */}
            {/* pointerEvents обязателен ЗДЕСЬ, а не только на кнопке: обёртка
                снаружи их гасит (она лишь центрирует), а наведение слушает
                именно Tooltip — без этого пузырёк не появился бы никогда. */}
            <Tooltip label={t("nowPlaying.reopen")} placement="top" style={{ pointerEvents: "auto" }}>
              <button
                type="button"
                aria-label={t("nowPlaying.reopen")}
                onClick={() => setLyricsOn(true)}
                onMouseEnter={() => setNpHandleHover(true)}
                onMouseLeave={() => setNpHandleHover(false)}
                onFocus={() => setNpHandleHover(true)}
                onBlur={() => setNpHandleHover(false)}
                style={{
                  pointerEvents: "auto",
                  width: 12,
                  height: 72,
                  padding: 0,
                  border: "none",
                  cursor: "pointer",
                  // Тот же материал, что у панели, но БЕЗ размытия: правило
                  // tokens/glass.css — размывают только зоны и панели, мелочь
                  // красится заливкой. На полоске 12px разницы не видно, а
                  // отдельный слой композитора она бы держала постоянно.
                  background: "var(--glass-nowplaying, var(--glass-panel))",
                  borderRadius: "var(--r-sm) 0 0 var(--r-sm)",
                  transformOrigin: "100% 50%",
                  transform: npHandleHover ? "scaleX(1.5)" : "scaleX(1)",
                  transition: "transform var(--dur-state-move) var(--spring-snap, var(--ease-out))",
                }}
              />
            </Tooltip>
          </div>
        ) : null}
      </div>

      {/* Очередь — тоже отдельный оверлей: её падение не должно уносить окно.
          Заглушка пустая (панель просто не откроется), сброс — на закрытии. */}
      <ErrorBoundary resetKey={queueOn} fallback={() => null}>
      <QueuePanel
        open={queueOn}
        tracks={pb.queue}
        currentIndex={pb.index}
        playing={playing}
        canSave={canSearch}
        onPlayTrack={(id) => pb.playContext(pb.queue, id)}
        onClose={closeQueue}
        onRemove={removeQueueTrack}
        onMove={pb.moveInQueue}
        onClearUpNext={() => {
          pb.clearUpNext();
          showToast(t("toast.queue.tailCleared"), "list-x");
        }}
        onSaveAsPlaylist={() => void saveQueueAsPlaylist()}
        // мультивыбор (2026-07-20): пачка убирается одним суммарным тостом —
        // undo-тост на каждый трек превратился бы в мигающий спам
        onRemoveMany={(ids) => {
          for (const id of ids) pb.removeFromQueue(id);
          showToast(t("toast.queue.removedMany", { count: ids.length }), "list-x");
        }}
        // ПКМ по строке очереди (2026-07-20): операции по id — PlayerTrack
        // каталожной формы не возит, «В плейлист»/«Источники» здесь нет
        onRowMenu={(tr, index, e) =>
          menuApiRef.current?.openMenu(e, {
            kind: "queueTrack",
            track: tr,
            ctl: {
              play: () => pb.playContext(pb.queue, tr.id),
              // из истории (index < pb.index) цель — pb.index: после изъятия
              // текущий сдвигается влево, и трек ложится сразу за ним
              playNext: () => pb.reorderQueue(index, index > pb.index ? pb.index + 1 : pb.index),
              remove: () => removeQueueTrack(tr.id),
              clearAfter: () => pb.clearAfter(index),
              canPlayNext: index !== pb.index && index !== pb.index + 1,
              canClearAfter: index >= pb.index && index < pb.queue.length - 1,
            },
          })
        }
      />
      </ErrorBoundary>

      {/* РЕЖИМ ПРАВКИ ВИДА (Ctrl+E). Слой поверх живого приложения: музыка
          играет, экраны кликаются, но края зон становятся хватаемыми.
          Обоснование механики целиком — в шапке LookEditLayer.tsx. */}
      {lookEdit ? (
        <LookEditLayer prefs={prefs} set={(patch) => setPrefs({ ...prefs, ...patch })} onExit={() => setLookEdit(false)} />
      ) : null}

      {/* Единственный узел, который перерисовывается на КАЖДЫЙ тик позиции:
          полоса плеера её рисует — и часами, и бегунком. Всё остальное дерево
          (сайдбар, экран со строками треков, очередь, диалоги) тик больше не
          трогает — в этом и был смысл переноса, см. positionStore.ts. */}
      <PositionScope store={posStore}>{(pos) => (
      <PlayerBar
        track={track}
        playing={playing}
        buttons={prefs.barButtons}
        pluginButtons={pluginBarButtons}
        pluginKeys={plugins.pluginBarKeys}
        onPluginButton={(pid, slot) => plugins.notifySlot(pid, slot, "click")}
        buffering={pb.buffering}
        onTogglePlay={pb.toggle}
        onPrev={pb.prev}
        onNext={pb.next}
        pos={pos}
        onSeek={pb.seek}
        // Дорисовка позиции кадрами — только пока окно на экране.
        windowVisible={windowVisible}
        vol={vol}
        onVol={pb.setVol}
        liked={track ? likes.includes(track.id) : false}
        onLike={() => track && toggleLike(track.id)}
        // ПКМ по инфо-блоку трека (2026-07-20): обычное меню трека без
        // «Играть следующим» (он уже играет); локальный без серверного id
        // каталожной формы не имеет — меню не показывается
        onTrackMenu={(e) => {
          const ct = track ? toCatalog(track) : null;
          if (ct) menuApiRef.current?.openMenu(e, { kind: "track", track: ct, place: "player" });
        }}
        shuffle={pb.shuffle}
        onShuffle={pb.toggleShuffle}
        repeat={pb.repeat}
        onRepeat={cycleRepeatWithToast}
        speed={pb.speed}
        onSpeed={cycleSpeedWithToast}
        lyricsOn={lyricsOn}
        onLyrics={() => setLyricsOn(!lyricsOn)}
        queueOn={queueOn}
        onQueue={() => setQueueOn(!queueOn)}
        onEqualizer={openEqualizer}
        onMute={toggleMute}
        onExpand={() => setExpanded(true)}
        sleepActive={sleep.mode !== "off"}
        sleepLabel={sleepLabel}
        onSleep={cycleSleep}
        jamActive={jam.active}
        onJam={() => setJamOpen(true)}
        // Вывод на устройства (2026-07-22): быстрый переключатель — эксклюзивный
        // выбор (одно устройство / профиль / системное); тонкая настройка — в
        // под-экране настроек (intent, как у эквалайзера)
        outputRoutes={prefs.audioOutputs}
        outputProfiles={prefs.outputProfiles}
        activeOutputProfile={prefs.activeOutputProfile}
        onOutputSystem={() => setPrefs({ ...prefs, audioOutputs: [], activeOutputProfile: "" })}
        onOutputDevice={(d) =>
          setPrefs({
            ...prefs,
            audioOutputs: [{ deviceId: d.deviceId, label: d.label, volume: 100, followsMaster: true }],
            activeOutputProfile: "",
          })
        }
        onOutputProfile={(id) => {
          const p = prefs.outputProfiles.find((x) => x.id === id);
          if (p) setPrefs({ ...prefs, audioOutputs: p.outputs.map((r) => ({ ...r })), activeOutputProfile: p.id });
        }}
        onOutputSettings={() => {
          navigate("settings");
          setSettingsIntent({ sub: "outputs", nonce: Date.now() });
        }}
        // drag-out: обложка утаскивается на рабочий стол файлом из кэша
        onCoverDragOut={
          engineAvailable() && track
            ? async () => {
                try {
                  return await exportCachedTrack(track.id, track.artist, track.title);
                } catch (e) {
                  showToast(e instanceof Error ? e.message : t("toast.files.prepareFailed"), "x");
                  return null;
                }
              }
            : undefined
        }
      />
      )}</PositionScope>

      {/* Оверлей drag-and-drop файлов: «отпусти — добавим» (события идут
          нативно через Tauri, слой только визуальный) */}
      {fileDropLit ? (
        <div
          className="muza-fade"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 90,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--glass-deep)",
            backdropFilter: "blur(var(--blur-glass))",
            WebkitBackdropFilter: "blur(var(--blur-glass))",
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-4)", textAlign: "center" }}>
            <span
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                background: "var(--accent-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="folder-down" size={42} color="var(--accent-text)" />
            </span>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--text-1)" }}>
              {t("app.dropOverlay.title")}
            </span>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
              {t("app.dropOverlay.hint")}
            </span>
          </div>
        </div>
      ) : null}

      <Toast
        open={toast.open}
        message={toast.text}
        icon={toast.icon}
        actionLabel={toast.actionLabel}
        onAction={toast.onAction}
        style={{
          position: "absolute",
          left: "50%",
          bottom: "calc(var(--h-playerbar) + 3 * var(--gap-zone))",
          zIndex: 90,
          transform: toast.open ? "translate(-50%, 0)" : "translate(-50%, 12px)",
        }}
      />

      {/* Меню трека и меню плейлиста рендерит ContextMenuProvider (один
          <Menu> на всё приложение); наборы пунктов — shell/menuActions.ts */}

      {/* Фреймы плагинов (T44): по одному на включённый плагин; поверхности
          вкладка/панель/оверлей позиционируются CSS без смены родителя */}
      <PluginFrames plugins={plugins} />

      {/* Диалоги контекст-меню плейлиста — как в PlaylistView */}
      <Dialog
        open={plRename !== null}
        title={t("app.renamePlaylistDialog.title")}
        onClose={() => setPlRename(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPlRename(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="check" onClick={() => void renameFromMenu()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {/* Enter = главная кнопка диалога (Button из ДС submit-кнопкой стать не может) */}
        <div onKeyDown={(e) => e.key === "Enter" && void renameFromMenu()}>
          <SearchInput value={plRenameValue} onChange={setPlRenameValue} placeholder={t("common.namePlaceholder")} icon="list-music" autoFocus />
        </div>
      </Dialog>

      <Dialog
        open={plDelete !== null}
        title={t("app.deletePlaylistDialog.title")}
        onClose={() => setPlDelete(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPlDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="trash-2" onClick={() => void deleteFromMenu()}>
              {t("app.deletePlaylistDialog.confirm")}
            </Button>
          </>
        }
      >
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          {canSearch
            ? t("app.deletePlaylistDialog.bodyServer", { name: plDelete?.name ?? "" })
            : t("app.deletePlaylistDialog.bodyLocal", { name: plDelete?.name ?? "" })}
        </div>
      </Dialog>

      {/* T47b: пикер иконки плейлиста — обе ПКМ-точки (плейлист в сайдбаре/
          медиатеке И трек внутри PlaylistView) заводят один и тот же диалог */}
      <PlaylistIconPicker
        open={iconPicker !== null}
        currentIcon={iconPicker?.icon ?? null}
        busy={iconPickerBusy}
        coverTile={iconPicker?.coverTile ?? null}
        onClose={() => setIconPicker(null)}
        onPick={(icon) => void changePlaylistIcon(icon)}
      />

      <VersionsDialog api={api} track={versionsTrack} onClose={() => setVersionsTrack(null)} onNotify={showToast} />

      {/* «Заменить версию» (2026-07-18): подмена трека другой загрузкой той же
          песни — в плейлисте (позиция сохраняется) или в Любимом (место в
          списке сохраняется на сервере через createdAt) */}
      <ReplaceVersionDialog
        api={api}
        ctx={replaceCtx}
        onClose={() => setReplaceCtx(null)}
        onNotify={showToast}
        onPlayCatalog={playCatalog}
        currentId={track?.id ?? null}
        playing={playing}
        onReplaced={handleReplaced}
      />

      {/* «Добавить по ссылке» (Stage 4): прямой источник + сразу «в плейлист» */}
      <AddLinkDialog
        api={api}
        open={addLinkOpen}
        onClose={() => setAddLinkOpen(false)}
        onNotify={showToast}
        onAdded={(added) => {
          showToast(t("toast.link.trackAdded", { title: added.title }), "link");
          setPlPick([added]); // сразу предлагаем положить в плейлист
        }}
      />

      {/* Импорт плейлиста (Stage 4): Spotify/YT/Apple → каталог + отчёт */}
      <ImportDialog
        api={api}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onNotify={showToast}
        onImported={(report) => {
          void reloadServerPlaylists();
          navigate("playlist", { playlistId: report.playlist.id });
        }}
      />

      {/* Вход в совместный плейлист по коду (Stage 7) */}
      <JoinPlaylistDialog
        api={api}
        open={joinOpen}
        apiHost={apiHost}
        onClose={() => setJoinOpen(false)}
        onJoined={(p) => {
          setJoinOpen(false);
          void reloadServerPlaylists();
          showToast(t("toast.playlist.joined", { name: p.name, owner: p.ownerUsername }), "users");
          navigate("playlist", { playlistId: p.id });
        }}
      />

      {/* Jam — слушать вместе (Stage 7) */}
      <JamDialog jam={jam} open={jamOpen} canUse={canSearch} apiHost={apiHost} onClose={() => setJamOpen(false)} onNotify={showToast} />

      {/* Шеринг-карточка (Stage 7): трек/плейлист/Wrapped */}
      <ShareDialog data={shareData} onClose={() => setShareData(null)} onNotify={showToast} />

      {/* Wrapped «Итоги года» (Stage 7; редизайн 2026-07-16 — эмбиент топ-трека).
          Резолв эмбиента — тот же путь, что у плеера (политика источников +
          resolvePlayable, общий кэш добычи); прямые googlevideo-URL в <audio>
          запрещены (троттлинг без Range, notes 2026-07-15). Пауза/возврат
          основного плеера — pb.pause/pb.toggle, канал сам проверяет, не
          возобновили ли плеер медиа-клавишей раньше него. */}
      {/* Условный монтаж (не open-проп на вечно живом компоненте): между
          открытиями стейт прошлого прогона (wrapped/slide) не должен ни
          мелькать кадром до сброса, ни дёргать лишний резолв эмбиента. */}
      {wrappedOpen ? (
      <WrappedOverlay
        api={api}
        open={wrappedOpen}
        onClose={() => setWrappedOpen(false)}
        onShare={setShareData}
        ambient={{
          resolveTrackUrl: async (trackId) => {
            if (!engineAvailable()) {
              throw new Error(t("media.player.errors.desktopOnly"));
            }
            const sources = await api.getTrackSources(trackId);
            const resolved = await resolvePlayable(
              trackId,
              applySourcePolicy(sources, prefs),
              prefs.streamQuality,
              prefs.language,
            );
            return resolved.url;
          },
          playerPlaying: pb.playing,
          pausePlayer: pb.pause,
          resumePlayer: pb.toggle,
          volume: prefs.wrappedAmbientVol,
          onVolumeChange: (v) => setPrefs({ ...prefs, wrappedAmbientVol: v }),
        }}
      />
      ) : null}

      <Dialog
        open={dialogOpen}
        title={t("app.newPlaylistName")}
        onClose={() => setDialogOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="plus" onClick={createPlaylist}>
              {t("app.newPlaylistDialog.create")}
            </Button>
          </>
        }
      >
        {/* Enter = главная кнопка диалога (Button из ДС submit-кнопкой стать не может) */}
        <div onKeyDown={(e) => e.key === "Enter" && void createPlaylist()}>
          <SearchInput value={plName} onChange={setPlName} placeholder={t("common.namePlaceholder")} icon="list-music" autoFocus />
        </div>
      </Dialog>

      {/* Выбор плейлиста для найденного трека («⋯ → В плейлист») */}
      <Dialog
        open={plPick !== null}
        title={
          plPick && plPick.length === 1
            ? t("app.addToPlaylistDialog.titleWithTrack", { title: plPick[0].title })
            : plPick && plPick.length > 1
              ? t("app.addToPlaylistDialog.titleWithCount", { count: plPick.length })
              : t("menu.addToPlaylist")
        }
        onClose={() => setPlPick(null)}
        actions={
          <Button variant="ghost" onClick={() => setPlPick(null)}>
            {t("common.cancel")}
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 280 }}>
          {srvPlaylists.map((p) => (
            <PlaylistPickRow key={p.id} icon={p.icon} coverUrl={p.iconCoverUrl} name={p.name} onClick={() => void addToPlaylist(p.id, p.name)} />
          ))}
          {srvPlaylists.length === 0 ? (
            <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.5 }}>
              {t("app.addToPlaylistDialog.empty")}
            </div>
          ) : null}
        </div>
      </Dialog>

      {/* Справка по клавишам: «?» или вкладка настроек */}
      <Dialog open={hotkeysOpen} title={t("app.hotkeysDialog.title")} onClose={() => setHotkeysOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 320 }}>
          {[
            ...HOTKEY_ACTIONS.map((a) => ({ action: hotkeyActionLabel(a.id, prefs.language), combo: formatCombo(prefs.hotkeys[a.id]) })),
            { action: t("app.hotkeysDialog.rows.searchOrClose"), combo: "Esc" },
            { action: t("app.hotkeysDialog.rows.thisHelp"), combo: "?" },
            // T18: жесты перетаскивания (единый UX списков)
            { action: t("app.hotkeysDialog.rows.dragTrackToPlaylist"), combo: t("app.hotkeysDialog.rows.dragRowCombo") },
            { action: t("app.hotkeysDialog.rows.dragFileToDesktop"), combo: t("app.hotkeysDialog.rows.altDragCombo") },
          ].map((h) => (
            <div key={h.action} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <span style={{ flex: 1, fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{h.action}</span>
              <span
                style={{
                  fontSize: "var(--fs-caption)",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-1)",
                  background: "var(--surface-3)",
                  borderRadius: 6,
                  padding: "3px 8px",
                }}
              >
                {h.combo}
              </span>
            </div>
          ))}
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: "var(--sp-2)" }}>
            {t("app.hotkeysDialog.footerHint")}
          </div>
        </div>
      </Dialog>

      {/* Режим прослушивания — про КОНКРЕТНЫЙ трек: нет трека, нет и режима
          (оба входа в него, обложка и кнопка бара, тоже недоступны).
          Своя граница с ПУСТОЙ заглушкой: если караоке упало (кривой текст,
          визуализатор, обложка), правильный исход — оверлея просто нет, а
          музыка играет дальше в обычном окне. Крашскрин на весь экран ради
          украшения поверх плеера — обмен не в пользу владельца.
          resetKey={track.id} — новый трек пробует открыть режим заново. */}
      {track ? (
      <ErrorBoundary resetKey={track.id} fallback={() => null}>
      {/* Те же два гейта, что у панели «Сейчас играет», зеркально (03.08):
          номер строки живой ВСЕГДА (текст следит за песней и под закрытым
          оверлеем — иначе на открытии караоке он поедет плавной прокруткой
          через весь куплет, это видно), а само число pos — только пока
          караоке ОТКРЫТО. У закрытого оверлея этот проп кормит часы и бегунок
          под visibility:hidden — работа, которой никто не видит. Открыли —
          точная позиция приезжает в том же коммите, что и open: первый же
          кадр появления правильный. */}
      <DerivedPositionScope store={posStore} compute={lineAt}>{(activeLine) => (
      <PositionScope store={posStore} live={expanded}>{(pos) => (
      <ListeningMode
        open={expanded}
        // Фон караоке — СВОЙ, а не тот же, что у интерфейса (заявка владельца
        // 03.08: «основной фон и фон в режиме караоке — разные вещи»). Значение
        // по умолчанию — обложка трека, поэтому у того, кто ничего не настраивал,
        // вид не меняется. Разбор веток — packages/app/src/prefs/backdrop.ts.
        backdrop={karaokeBackdrop}
        track={track}
        lyrics={lyrics}
        lyricsLoading={lyricsLoading}
        playing={playing}
        pos={pos}
        speed={pb.speed}
        activeLine={activeLine}
        lyricsAutoScroll={prefs.lyricsAutoScroll}
        lyricsEndNote={prefs.lyricsEndNote}
        karaokeLines={prefs.karaokeLines}
        onTogglePlay={pb.toggle}
        onPrev={pb.prev}
        onNext={pb.next}
        onSeek={pb.seek}
        onSeekLine={seekLine}
        onExplain={setMeaningLine}
        onClose={() => setExpanded(false)}
        lyricsShown={prefs.listeningLyricsShown}
        onToggleLyrics={() => setPrefs({ ...prefs, listeningLyricsShown: !prefs.listeningLyricsShown })}
        visualizer={prefs.visualizer}
        getAnalyser={pb.getAnalyser}
        visualizerTuning={{
          bars: prefs.visualizerBars,
          mirror: prefs.visualizerMirror,
          barFill: prefs.visualizerBarFill,
          barRound: prefs.visualizerBarRound,
          barCalm: prefs.visualizerBarCalm,
          waveSmooth: prefs.visualizerWaveSmooth,
          waveCalm: prefs.visualizerWaveCalm,
          waveThick: prefs.visualizerWaveThick,
          waveFill: prefs.visualizerWaveFill,
          waveAmp: prefs.visualizerWaveAmp,
          opacity: prefs.visualizerOpacity,
        }}
        bassShake={prefs.bassShake}
        bassShakeStrength={prefs.bassShakeStrength}
        bassSharp={prefs.bassSharp}
        bassReach={prefs.bassReach}
        anims={prefs.anims}
        // Гасит все три цикла кадров оверлея, когда окна не видно.
        windowVisible={windowVisible}
      />
      )}</PositionScope>
      )}</DerivedPositionScope>
      </ErrorBoundary>
      ) : null}
      <MeaningDialog
        open={meaningLine !== null}
        line={meaningLine !== null ? lyrics[meaningLine] ?? null : null}
        annotation={meaningLine !== null ? annotationNotes.get(meaningLine) : undefined}
        geniusUrl={geniusUrl}
        onClose={() => setMeaningLine(null)}
      />
    </DragLayer>
    </ContextMenuProvider>
    </WarmerProvider>
    </div>
    </LookEditProvider>
    </LanguageProvider>
  );
}

/** Строка плейлиста в диалоге «⋯ → В плейлист» (T47b): та же обложка-иконка,
 *  что в сайдбаре/медиатеке/шапке, вместо статичной "list-music" у всех подряд.
 *  Кнопка @muza/ui поддерживает только именованный Lucide-icon (не картинку) —
 *  поэтому здесь свой pill-баттон в стиле Button variant="secondary". */
function PlaylistPickRow({
  icon,
  coverUrl,
  name,
  onClick,
}: {
  icon: string | null;
  /** T47c: готовая ссылка обложки для track-иконки (важнее манифестной). */
  coverUrl?: string | null;
  name: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  // Track-иконка — сырой ytimg: без objectFit сплющивалась в 20×20, а вшитые
  // поля источника лечит тот же canvas-кроп, что у остальных обложек.
  const src = useCoverArt(coverUrl ?? playlistIconSrc(icon) ?? null);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 40,
        padding: "0 var(--sp-4)",
        border: "none",
        borderRadius: "var(--r-control, var(--r-pill))",
        background: hover ? "var(--surface-4)" : "var(--surface-3)",
        color: "var(--text-1)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        fontWeight: 600,
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-state) var(--ease-standard)",
      }}
    >
      {src ? (
        <img src={src} alt="" width={20} height={20} style={{ borderRadius: "var(--r-xs)", flex: "none", display: "block", objectFit: "cover" }} />
      ) : (
        <Icon name="list-music" size={18} color="currentColor" />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </button>
  );
}
