import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Icon, Menu, SearchInput, Toast } from "@muza/ui";
import { pickRandomPlaylistIcon, playlistIconSrc } from "@muza/core";
import {
  HttpMuzaApi,
  resolveApiBaseUrl,
  type MuzaApi,
  type PlaylistMeta,
  type Session,
  type Track as CatalogTrack,
} from "@muza/api-client";
import { DEFAULT_PREFS, RADIUS_OVERRIDE_OFF, type Prefs, type View } from "./types";
import { LanguageProvider, resolveMigratedLanguage, translate, type TParams, type TranslationKey } from "./i18n";
import { accentRoleVars, customAccentVars } from "./lib/accent";
import { devApiHost } from "./lib/devApiHost";
import { dominantColor, mixHex } from "./lib/coverTint";
import { MIGRATED_PREF_KEYS, migrateLegacyValue } from "./lib/legacyPrefs";
import { applySourcePolicy } from "./lib/sources";
import { resumeStore } from "./lib/resumeStore";
import { miniHide, miniListen, miniSendState, miniShow, type MiniCommand, type MiniState } from "./lib/miniBridge";
import { useMediaQuery } from "./lib/useMediaQuery";
import { applyRecipe, engineAvailable, enginePin, enginePins, resolvePlayable, setCacheLimit } from "./lib/engine";
import { exportCachedTrack } from "./lib/dragOut";
import { syncAutostart, trayConfigure } from "./lib/system";
import { autoCheckForUpdate, UPDATE_CHECK_INTERVAL_MS } from "./lib/updater";
import { setSnapshotScope, withSnapshot } from "./lib/offlineSnapshot";
import { clearDiscordActivity, formatTemplate, updateDiscordActivity } from "./lib/discord";
import { useTelemetry, type PlayCounters } from "./lib/useTelemetry";
import { useErrorTelemetry } from "./lib/useErrorTelemetry";
import { useVisitPing } from "./lib/useVisitPing";
import { useCoverArt } from "./lib/coverArt";
import { comboFromEvent, matchAction, formatCombo, withDefaults, HOTKEY_ACTIONS, hotkeyActionLabel } from "./lib/hotkeys";
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
import { useLyrics } from "./player/useLyrics";
import { useAnnotations } from "./player/useAnnotations";
import { decorateLyrics, shouldFetchAnnotations } from "./player/annotations";
import { useMediaSession } from "./player/useMediaSession";
import { useJam } from "./player/useJam";
import { fromCatalog, fromLocalEntry, type PlayerTrack } from "./player/types";
import type { ShareData } from "./lib/shareCard";
import { LoginScreen } from "./auth/LoginScreen";
import { Sidebar } from "./shell/Sidebar";
import { NowPlayingPanel } from "./shell/NowPlayingPanel";
import { PlayerBar } from "./shell/PlayerBar";
import { QueuePanel } from "./shell/QueuePanel";
import { ListeningMode } from "./shell/ListeningMode";
import { MeaningDialog } from "./shell/MeaningDialog";
import { VersionsDialog } from "./shell/VersionsDialog";
import { DragLayer } from "./shell/DragLayer";
import { AddLinkDialog } from "./shell/AddLinkDialog";
import { ImportDialog } from "./shell/ImportDialog";
import { JamDialog } from "./shell/JamDialog";
import { JoinPlaylistDialog } from "./shell/JoinPlaylistDialog";
import { PlaylistIconPicker } from "@muza/app";
import { ShareDialog } from "./shell/ShareDialog";
import { HomeFeed } from "./views/HomeFeed";
import { SearchView } from "./views/SearchView";
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

export function App() {
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

  useEffect(() => {
    api.restoreSession().then((s) => {
      setSession(s);
      setRestoring(false);
    });
  }, [api]);

  if (restoring) {
    return <div style={{ position: "absolute", inset: 0, background: "var(--bg-0)" }} />;
  }
  if (!session) {
    return <LoginScreen api={api} onSession={setSession} lang={loadPrefs().language} />;
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

const PREFS_KEY = "muza.prefs.v1";

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    // merge с дефолтами: новые поля Prefs не ломают старые сохранения
    const stored = JSON.parse(raw) as Partial<Prefs> & { bgCover?: boolean };
    const prefs = { ...DEFAULT_PREFS, ...stored };
    // миграция Stage 6: старый bgCover=true → bgType="cover"
    if (stored.bgCover && stored.bgType === undefined) prefs.bgType = "cover";
    // вложенные объекты мерджатся глубже: новое под-поле не теряет соседей
    prefs.sourcesEnabled = { ...DEFAULT_PREFS.sourcesEnabled, ...stored.sourcesEnabled };
    prefs.rowShow = { ...DEFAULT_PREFS.rowShow, ...stored.rowShow };
    // хоткеи — так же: новое действие (напр. T16 navBack/navForward) не теряется
    // в старых сохранениях, где его ещё не было (иначе бинд молча пуст, "—" в хелпе)
    prefs.hotkeys = withDefaults(stored.hotkeys);
    // T28 (i18n): raw уже существовал (не первый запуск, ветка "raw пуст"
    // выше вернула бы DEFAULT_PREFS.language="en" раньше) — см.
    // i18n/index.tsx::resolveMigratedLanguage для полного обоснования.
    prefs.language = resolveMigratedLanguage(stored.language);
    // миграция «пресеты → ползунки»: строковые значения старых сохранений
    // («sharper», «compact»…) конвертируются в числа, мусор — к дефолту
    for (const key of MIGRATED_PREF_KEYS) {
      const v = (stored as Record<string, unknown>)[key];
      if (v === undefined) continue;
      (prefs as Record<string, unknown>)[key] =
        migrateLegacyValue(key, v) ?? DEFAULT_PREFS[key as keyof Prefs];
    }
    return prefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Пресеты базовых bg-слоёв (Stage 6, «Базовый фон»); graphite = дефолт ДС. */
const BASE_BG: Record<Prefs["baseBg"], { bg0: string; bg1: string } | null> = {
  graphite: null,
  warm: { bg0: "#151110", bg1: "#1b1512" },
  cold: { bg0: "#0f1114", bg1: "#13171c" },
  amoled: { bg0: "#000000", bg1: "#0b0b0b" },
};

/** Базовые значения шкалы радиусов по пресету [data-radius] (radius.css ДС) —
 *  «скругление по типам» (ползунки-проценты) умножает их и переопределяет
 *  токены inline. */
const RADIUS_BASE: Record<Prefs["radius"], { xs: number; sm: number; md: number; lg: number; xl: number }> = {
  mild: { xs: 6, sm: 8, md: 12, lg: 16, xl: 20 },
  soft: { xs: 10, sm: 14, md: 20, lg: 28, xl: 36 },
  round: { xs: 14, sm: 18, md: 26, lg: 36, xl: 48 },
};

/** Дефолтные --bg-0/1 тем (colors.css / themes.css ДС) — база для тонировки
 *  обложкой, когда baseBg-пресет не активен. */
const BG_DEFAULTS = {
  dark: { bg0: "#121110", bg1: "#171614" },
  light: { bg0: "#f3f1ed", bg1: "#faf9f6" },
};

/** Плотность (ползунок 0–100) → отступ зоны 14–26px (--pad-zone, дефолт 20
 *  при 50) + высота строки трека 52–68px (--h-trackrow, TrackRow читает с
 *  фолбэком 60). Межстрочный: prefs.lineSpacing 125–160 → --lh-ui 1.25–1.60. */
const densityPad = (d: number) => 14 + Math.round((12 * d) / 100);
const densityRow = (d: number) => 52 + Math.round((16 * d) / 100);

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
  // Скоуп снапшотов — до первых загрузок (эффекты ниже читают через withSnapshot)
  setSnapshotScope(userId);
  // Стартовый экран — из prefs (Stage 6, «Поведение»)
  const [view, setView] = useState<View>(() => loadPrefs().startView);
  // Пусто, пока не приедут серверные фавориты (эффект ниже). Раньше тут был
  // захардкоженный лайк демо-трека "t3", и, поскольку серверные фавориты
  // только МЕРЖАТСЯ в этот список, убрать его из «Любимого» было нельзя.
  const [likes, setLikes] = useState<string[]>([]);
  // Запрос открыть конкретный под-экран настроек (кнопка эквалайзера в баре)
  const [settingsIntent, setSettingsIntent] = useState<SettingsIntent | null>(null);
  const [lyricsOn, setLyricsOn] = useState(true);
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
  // T16: история переходов между вкладками (Alt+←/→, боковые кнопки мыши) —
  // чистый стек в lib/historyStack; ref, а не state — сама история не рендерит
  // UI (кнопок «назад»/«вперёд» нет), нужна только актуальность в колбэках.
  const historyRef = useRef<HistoryState<View>>(createHistory<View>({ view }));
  // выбор плейлиста для «В плейлист» из поиска
  const [plPick, setPlPick] = useState<CatalogTrack | null>(null);
  // Stage 4: меню трека («⋯») и диалог «Источники»
  const [catMenu, setCatMenu] = useState<{ open: boolean; x: number; y: number; track: CatalogTrack | null }>({
    open: false,
    x: 0,
    y: 0,
    track: null,
  });
  const [versionsTrack, setVersionsTrack] = useState<CatalogTrack | null>(null);
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
  // T17: контекст-меню плейлиста (ПКМ в сайдбаре/медиатеке) + диалоги
  // переименования/удаления на уровне App (страница плейлиста может быть
  // не открыта — её диалоги не переиспользовать)
  const [plMenu, setPlMenu] = useState<{ open: boolean; x: number; y: number; pl: { id: string; name: string } | null }>({
    open: false,
    x: 0,
    y: 0,
    pl: null,
  });
  const [plRename, setPlRename] = useState<{ id: string; name: string } | null>(null);
  const [plRenameValue, setPlRenameValue] = useState("");
  const [plDelete, setPlDelete] = useState<{ id: string; name: string } | null>(null);
  // переименование открытого прямо сейчас плейлиста: bump ремоунтит PlaylistView,
  // чтобы шапка перечитала имя (сама страница о переименовании извне не знает)
  const [plBump, setPlBump] = useState(0);
  // T47b: пикер иконки плейлиста — открывается ПКМ на плейлисте (сайдбар/медиатека)
  // ИЛИ ПКМ на треке внутри PlaylistView; id — независимо от того, что сейчас открыто.
  const [iconPicker, setIconPicker] = useState<{ id: string; icon: string | null } | null>(null);
  const [iconPickerBusy, setIconPickerBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Кастомизация переживает перезапуск: без этого все настройки слетали
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  };
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
      pos: pbRaw.pos,
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
  const { track, playing, pos, vol } = pb;

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
  useEffect(() => {
    pluginHost.emit("position", { position: Math.floor(pos) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(pos)]);
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

  /** Закрепить трек оффлайн: пин + немедленная догрузка в кэш добычи. */
  const saveOffline = async (t: CatalogTrack) => {
    await enginePin(t.id, true);
    setPins((p) => new Set([...p, t.id]));
    if (t.sources.every((s) => s === "local")) return; // локальный и так на диске
    try {
      const sources = await api.getTrackSources(t.id);
      // оффлайн-копия — всегда в полном качестве и по политике источников
      await resolvePlayable(t.id, applySourcePolicy(sources, prefs), "auto", prefs.language);
      return true;
    } catch {
      return false; // пин остался — докачается при первом прослушивании
    }
  };

  const toggleOffline = async (track: CatalogTrack) => {
    if (pins.has(track.id)) {
      await enginePin(track.id, false);
      setPins((p) => {
        const next = new Set(p);
        next.delete(track.id);
        return next;
      });
      showToast(t("toast.offline.removed"), "cloud-off");
      return;
    }
    showToast(t("toast.offline.saving"), "download");
    const ok = await saveOffline(track);
    showToast(
      ok === false ? t("toast.offline.pinnedWillDownload") : t("toast.offline.saved"),
      "download",
    );
  };

  /** «Сохранить оффлайн» на плейлисте: пины + фоновая догрузка по очереди. */
  const saveOfflinePlaylist = async (tracks: CatalogTrack[]) => {
    const targets = tracks.filter((t) => /^\d+$/.test(t.id));
    if (targets.length === 0) return;
    showToast(t("toast.offline.savingPlaylist", { count: targets.length }), "download");
    let ok = 0;
    for (const track of targets) {
      const r = await saveOffline(track);
      if (r !== false) ok += 1;
    }
    setPins((p) => new Set([...p, ...targets.map((track) => track.id)]));
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
  // T15 (bgType=animated): OS-уровень reduced-motion — реактивно, как остальной адаптив.
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // Медиаклавиши и системный медиа-оверлей (SMTC) через Media Session API
  useMediaSession(
    track,
    playing,
    pos,
    {
      toggle: pb.toggle,
      next: pb.next,
      prev: pb.prev,
      seek: pb.seek,
      pause: pb.pause,
    },
    prefs.mediaKeys,
  );

  // Мини-плеер: окно "mini" живёт/умирает по prefs; состояние уходит событиями
  // (1 Гц по целым секундам позиции), команды приходят обратно (ref-паттерн —
  // подписка одна, замыкания свежие)
  const miniStateNow = (): MiniState => ({
    title: track?.title ?? null,
    artist: track?.artist ?? null,
    cover: track?.cover ?? null,
    playing,
    pos,
    duration: track?.duration ?? 0,
    liked: track ? likes.includes(track.id) : false,
  });
  const miniRef = useRef({ send: () => {}, cmd: (_c: MiniCommand) => {} });
  miniRef.current = {
    send: () => void miniSendState(miniStateNow()),
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
      void miniShow().then(() => miniRef.current.send());
    } else {
      void miniHide();
    }
  }, [prefs.miniPlayer]);
  useEffect(() => {
    if (!engineAvailable()) return;
    let un: (() => void) | undefined;
    void miniListen(
      (c) => miniRef.current.cmd(c),
      () => miniRef.current.send(),
    ).then((u) => {
      un = u;
    });
    return () => un?.();
  }, []);
  const miniPos = Math.floor(pos);
  useEffect(() => {
    if (!prefs.miniPlayer || !engineAvailable()) return;
    miniRef.current.send();
    // track.cover В ДЕПСАХ ОБЯЗАТЕЛЬНА: useCoverArt чистит обложку асинхронно,
    // и на смену трека снапшот уходит ещё с сырой. Без этой зависимости эффект
    // не перезапускался, и мини освежался только со следующим тиком miniPos —
    // то есть на паузе не освежался никогда и держал недокропленную картинку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.miniPlayer, track?.id, track?.cover, playing, likes, miniPos]);

  // Discord Rich Presence: активность на смену трека/паузу (RPC живёт в Rust;
  // Discord не запущен или client_id не настроен — no-op). Строки — из
  // шаблонов настроек ({track}/{artist}/{album}; альбома у каталожных нет).
  useEffect(() => {
    if (!prefs.discordRpcOn || !playing || !track) {
      void clearDiscordActivity();
      return;
    }
    const vars = { track: track.title, artist: track.artist, album: track.album };
    void updateDiscordActivity({
      details: formatTemplate(prefs.discordLine1, vars) || track.title,
      state: formatTemplate(prefs.discordLine2, vars) || track.artist,
      coverUrl: prefs.discordShowCover && track.cover?.startsWith("https") ? track.cover : null,
      startTs: Math.floor(Date.now() / 1000 - pos),
      buttonLabel: prefs.discordBtnOn ? prefs.discordBtnLabel : null,
      buttonUrl: prefs.discordBtnOn ? prefs.discordBtnUrl : null,
    });
    // pos нарочно не в deps: активность шлём на смену трека/состояния, не каждый тик
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    track?.id,
    playing,
    prefs.discordRpcOn,
    prefs.discordBtnOn,
    prefs.discordBtnLabel,
    prefs.discordBtnUrl,
    prefs.discordShowCover,
    prefs.discordLine1,
    prefs.discordLine2,
  ]);

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
  // выключенный prefs.syncedLyrics превращает synced в plain-список (-1)
  const activeLine = useMemo(() => {
    if (!lyricsSynced || !prefs.syncedLyrics) return -1;
    let a = 0;
    lyrics.forEach((l, i) => {
      if (l.t <= pos) a = i;
    });
    return a;
  }, [pos, lyrics, lyricsSynced, prefs.syncedLyrics]);

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
  const onQueueCatalog = prefs.doubleClickAction === "queue" ? queueCatalog : undefined;

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

  // Автопроверка обновлений (Stage 8): первая через 30с после старта, дальше
  // КАЖДЫЕ UPDATE_CHECK_INTERVAL_MS. Интервал тут принципиален: раньше стоял
  // одинокий setTimeout, то есть проверка случалась ровно один раз за запуск —
  // а плеер живёт открытым сутками, и такая сессия не узнавала об обновлении
  // никогда. Троттл внутри autoCheckForUpdate страхует от лишних проверок при
  // частых перезапусках. Нашлось — тост с «Установить» (скачивание → перезапуск сам).
  useEffect(() => {
    const check = () =>
      void autoCheckForUpdate().then((found) => {
        if (!found) return;
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({
          open: true,
          text: t("toast.update.available", { version: found.version }),
          icon: "download",
          actionLabel: t("common.install"),
          onAction: () => {
            setToast({ open: true, text: t("toast.update.downloading"), icon: "download" });
            found.install(() => undefined).catch(() => showToast(t("toast.update.installFailed"), "x"));
          },
        });
        toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 12000);
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
  /** Закрыть панель и вернуть фокус на кнопку очереди (клавиатурный путь). */
  const closeQueue = () => {
    setQueueOn(false);
    (document.querySelector(`button[aria-label="${t("player.queue")}"]`) as HTMLButtonElement | null)?.focus();
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

  // Mute: клик по иконке громкости или клавиша M; помним прежний уровень
  const prevVolRef = useRef(64);
  const toggleMute = () => {
    if (vol > 0) {
      prevVolRef.current = vol;
      pb.setVol(0);
    } else {
      pb.setVol(prevVolRef.current || 64);
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
      case "seekFwd":
        if (track) pb.seek(Math.min(pos + 5, track.duration));
        break;
      case "seekBack":
        pb.seek(Math.max(pos - 5, 0));
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

  /** «⋯» на каталожном (серверном) треке — меню Stage 4. */
  const openCatalogMenu = (t: CatalogTrack, e: React.MouseEvent) => {
    e.stopPropagation();
    setCatMenu({
      open: true,
      x: Math.min(e.clientX, window.innerWidth - 250),
      y: Math.min(e.clientY, window.innerHeight - 180),
      track: t,
    });
  };

  /** T17: ПКМ по плейлисту (сайдбар/медиатека) — Открыть/Переименовать/Удалить. */
  const openPlaylistMenu = (p: { id: string; name: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlMenu({
      open: true,
      x: Math.min(e.clientX, window.innerWidth - 250),
      y: Math.min(e.clientY, window.innerHeight - 220),
      pl: { id: p.id, name: p.name },
    });
  };

  // Совместный плейлист «от кого-то» переименовывать/удалять нельзя — я не владелец
  const plMenuIsOwner =
    plMenu.pl === null || !canSearch || srvPlaylists.find((x) => x.id === plMenu.pl?.id)?.role !== "collaborator";

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
   *  PlaylistView — оба ведут сюда, id плейлиста разный только по источнику клика. */
  const openIconPicker = (id: string) => {
    const icon = srvPlaylists.find((p) => p.id === id)?.icon ?? null;
    setIconPicker({ id, icon });
  };

  const changePlaylistIcon = async (icon: string) => {
    const target = iconPicker;
    if (!target) return;
    setIconPickerBusy(true);
    try {
      await api.setPlaylistIcon(target.id, icon);
      // патчим локальный список вместо полного reloadServerPlaylists — быстрее,
      // и сразу видно в сайдбаре/медиатеке без лишнего запроса
      setSrvPlaylists((ps) => ps.map((p) => (p.id === target.id ? { ...p, icon } : p)));
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

  // Пункты плагинов для меню трека: слоты track и catalogTrack схлопнуты в один
  // список — см. комментарий у самого меню ниже.
  const trackMenuPlugins = [...plugins.menuItems("catalogTrack"), ...plugins.menuItems("track")];

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

  const sidebarPlaylists = canSearch
    ? srvPlaylists.map((p) => ({
        id: p.id,
        name: p.name,
        meta:
          p.role === "collaborator"
            ? t("sidebar.playlistMeta.collabFrom", { count: p.trackCount, owner: p.ownerUsername })
            : p.collaboratorsCount > 0
              ? t("sidebar.playlistMeta.shared", { count: p.trackCount })
              : t("sidebar.playlistMeta.trackCount", { count: p.trackCount }),
        shared: p.role === "collaborator" || p.collaboratorsCount > 0,
        // T47b: иконка-обложка из манифеста @muza/core; нет/невалидна — PlaylistRow
        // сама рисует прежний фолбэк (users/list-music)
        cover: playlistIconSrc(p.icon) ?? undefined,
      }))
    : [];

  // T16: обычный переход (НЕ назад/вперёд) — пушит в историю и опционально
  // синкает payload параметрических вью (сейчас только id открытого плейлиста).
  // Все клики по вкладкам должны идти через navigate(), а не голый setView,
  // иначе история не узнает о переходе.
  const navigate = (next: View, payload?: HistoryPayload) => {
    historyRef.current = pushHistory(historyRef.current, { view: next, payload });
    if (payload && "playlistId" in payload) setOpenPlaylistId(payload.playlistId ?? null);
    setView(next);
  };

  /** Применить уже существующую запись истории (после goBack/goForward) —
   *  никакого пуша, просто синк view + openPlaylistId с записью стека. */
  const applyHistoryEntry = (entry: HistoryEntry<View>) => {
    setView(entry.view);
    setOpenPlaylistId(entry.payload?.playlistId ?? null);
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

  const addToPlaylist = async (playlistId: string, playlistName: string) => {
    if (!plPick) return;
    setPlPick(null);
    try {
      await api.addPlaylistTrack(playlistId, plPick.id);
      await reloadServerPlaylists();
      showToast(t("toast.playlist.addedTrack", { name: playlistName }), "list-music");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("toast.playlist.addFailed"), "x");
    }
  };

  const accentAttr = prefs.accent === "blue" || prefs.accent === "custom" ? undefined : prefs.accent;
  const isLight = prefs.theme === "light";
  // baseBg-пресеты (тёплый/холодный/AMOLED) заточены под тёмную — в светлой не применяем
  const baseBg = isLight ? null : BASE_BG[prefs.baseBg];
  const animMult = prefs.animSpeed / 100;
  // База текста/стекла зависит от темы: тёмная = белый текст на тёмном стекле,
  // светлая = тёмный текст на светлом стекле (иначе инлайн перебил бы [data-theme])
  const textBase = isLight ? "28, 26, 23" : "244, 243, 241";
  const glassBase = isLight ? "250, 249, 246" : "23, 22, 20";
  // Поверхности зон (сайдбар/«сейчас играет»): тёмная тема — translucent-white,
  // светлая — translucent-black (логика слоёв themes.css)
  const surfaceBase = isLight ? "20, 18, 15" : "255, 255, 255";
  // Скругление по типам: плитки/панели — процент от пресета, кнопки/поля — px
  // (RADIUS_OVERRIDE_OFF = токен не ставим, форма как в ДС)
  const rBase = RADIUS_BASE[prefs.radius];
  const rTilesMult = prefs.radiusTiles / 100;
  const rPanelsMult = prefs.radiusPanels / 100;
  const rControl = prefs.radiusControls >= RADIUS_OVERRIDE_OFF ? null : `${prefs.radiusControls}px`;
  const rField = prefs.radiusFields >= RADIUS_OVERRIDE_OFF ? null : `${prefs.radiusFields}px`;
  const rTabs = prefs.radiusTabs >= RADIUS_OVERRIDE_OFF ? null : `${prefs.radiusTabs}px`;
  // Скрим (T5): затемняющий слой поверх фоновой обложки (bgDim). На тёмной
  // теме — чёрный, как раньше; на светлой — тон BG_DEFAULTS.light.bg0
  // (#f3f1ed → 243,241,237), иначе сквозь полупрозрачные светлые панели
  // (--glass-panel) просвечивает серо-чёрная муть — тот самый «баг белой темы».
  const scrimRgb = isLight ? "243, 241, 237" : "0, 0, 0";
  // Тонировка фона обложкой поверх действующей пары bg-слоёв
  const bgPair = baseBg ?? BG_DEFAULTS[isLight ? "light" : "dark"];
  const tintStrength = isLight ? 0.12 : 0.22;
  const tintedBg =
    prefs.bgTint && coverTint
      ? { bg0: mixHex(bgPair.bg0, coverTint, tintStrength), bg1: mixHex(bgPair.bg1, coverTint, tintStrength) }
      : null;
  const rootStyle = {
    position: "absolute",
    inset: 0,
    background: "var(--bg-0)",
    overflow: "hidden",
    fontFamily: "var(--font-ui)",
    "--blur-glass": `${prefs.blur}px`,
    "--glass-panel": `rgba(${glassBase}, ${prefs.glassOpacity / 100})`,
    // свой акцент: все четыре акцент-токена выводятся из выбранного hex (theme-aware)
    ...(prefs.accent === "custom" ? customAccentVars(prefs.customAccent, isLight) : {}),
    // роли акцента: play/слайдеры/активный трек отдельно (фолбэк — --accent)
    ...(prefs.accentRolesOn
      ? accentRoleVars({ play: prefs.accentPlay, slider: prefs.accentSlider, active: prefs.accentActive }, isLight)
      : {}),
    // скругление по типам поверх пресета [data-radius]
    ...(prefs.radiusTiles !== 100
      ? {
          "--r-xs": `${Math.round(rBase.xs * rTilesMult)}px`,
          "--r-sm": `${Math.round(rBase.sm * rTilesMult)}px`,
          "--r-md": `${Math.round(rBase.md * rTilesMult)}px`,
        }
      : {}),
    ...(prefs.radiusPanels !== 100
      ? {
          "--r-lg": `${Math.round(rBase.lg * rPanelsMult)}px`,
          "--r-xl": `${Math.round(rBase.xl * rPanelsMult)}px`,
        }
      : {}),
    ...(rControl ? { "--r-control": rControl } : {}),
    ...(rField ? { "--r-field": rField } : {}),
    ...(rTabs ? { "--r-tabs": rTabs } : {}),
    // прозрачность по зонам: своя плотность стекла у каждой зоны + backdrop-blur
    // для зон, которые без этого — плоские surface (сайдбар, «сейчас играет»)
    ...(prefs.glassZonesOn
      ? {
          "--glass-player": `rgba(${glassBase}, ${prefs.glassPlayer / 100})`,
          "--glass-menu": `rgba(${glassBase}, ${prefs.glassMenu / 100})`,
          "--glass-dialog": `rgba(${glassBase}, ${prefs.glassDialog / 100})`,
          "--glass-sidebar": `rgba(${surfaceBase}, ${prefs.glassSidebar / 100})`,
          "--glass-nowplaying": `rgba(${surfaceBase}, ${prefs.glassNowPlaying / 100})`,
          "--bf-zone": "blur(var(--blur-glass))",
        }
      : {}),
    // Stage 6 (продвинутая кастомизация): токен-уровневые переопределения
    ...(tintedBg
      ? { "--bg-0": tintedBg.bg0, "--bg-1": tintedBg.bg1 }
      : baseBg
        ? { "--bg-0": baseBg.bg0, "--bg-1": baseBg.bg1 }
        : {}),
    "--text-2": `rgba(${textBase}, ${(prefs.textDim / 100).toFixed(2)})`,
    "--text-3": `rgba(${textBase}, ${Math.max(0.2, prefs.textDim / 100 - 0.24).toFixed(2)})`,
    "--blur-scenery": `${prefs.blurScenery}px`,
    "--fs-karaoke": `${prefs.karaokeSize}px`,
    "--w-nowplaying": `${prefs.wNowPlaying}px`,
    // Типографика и плотность (продвинутая кастомизация): межстрочный + отступ
    // зоны + высота строки трека; размер шрифта — через root font-size (эффект ниже)
    "--lh-ui": (prefs.lineSpacing / 100).toFixed(2),
    "--pad-zone": `${densityPad(prefs.density)}px`,
    "--h-trackrow": `${densityRow(prefs.density)}px`,
    // zoom масштабирует весь UI (WebView2/Chromium); 100% — без свойства
    ...(prefs.uiScale !== 100 ? { zoom: prefs.uiScale / 100 } : {}),
    ...(wideEnoughForSidebar ? { "--w-sidebar": `${prefs.wSidebar}px` } : { "--w-sidebar": "220px" }),
    ...(prefs.anims
      ? animMult !== 1
        ? {
            "--dur-fast": `${Math.round(150 * animMult)}ms`,
            "--dur-base": `${Math.round(220 * animMult)}ms`,
            "--dur-slow": `${Math.round(400 * animMult)}ms`,
          }
        : {}
      : { "--dur-fast": "1ms", "--dur-base": "1ms", "--dur-slow": "1ms" }),
  } as React.CSSProperties;

  // T15: вращение диска включено только когда общий anims включён и OS не
  // просит reduced-motion (двойная защита — как bassShake в ListeningMode).
  // Выключено → диски остаются на месте (статичная версия), не пропадают.
  const orbitActive = prefs.anims && !reducedMotion;

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
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          filter: "blur(var(--blur-scenery))",
          opacity: 0.22,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "-20%",
            height: "max(140vw, 140vh)",
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
            right: "-20%",
            height: "max(140vw, 140vh)",
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
      pos,
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

  return (
    <LanguageProvider lang={prefs.language}>
    <div data-theme={prefs.theme} data-accent={accentAttr} data-radius={prefs.radius} style={rootStyle}>
    {/* DragLayer ВНУТРИ этого div, а не снаружи: превью переноса рисуется его
        потомком и берёт токены отсюда (тема/акцент/--glass-panel живут inline
        на этом div, а не в :root). Старый HTML5-гость вешался на document.body
        и по той же причине не следовал теме пользователя — резолвился
        дефолтами из themes.css. position:fixed превью при этом не обрезается:
        у rootStyle overflow:hidden, но нет transform/filter, поэтому блок-
        контейнер для fixed — вьюпорт, а не этот div. */}
    <DragLayer>
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

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: showNowPlaying ? "var(--w-sidebar) 1fr var(--w-nowplaying)" : "var(--w-sidebar) 1fr",
          gap: "var(--gap-zone)",
          padding: "var(--gap-zone)",
          paddingBottom: "calc(var(--h-playerbar) + 2 * var(--gap-zone))",
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
          playlists={sidebarPlaylists}
          onCreatePlaylist={() => setDialogOpen(true)}
          onOpenPlaylist={openPlaylist}
          // T17: ПКМ по плейлисту — контекст-меню (открыть/переименовать/удалить)
          onPlaylistMenu={openPlaylistMenu}
          // DnD: строка трека брошена на плейлист (только серверные списки)
          onDropTrack={dropTrackOnPlaylist}
          isAdmin={isAdmin}
          onOpenHotkeys={openHotkeys}
        />
        {/* key на main: смена экрана пересоздаёт скролл-контейнер — прокрутка
            прошлого экрана не протекает в новый (короткий экран улетал вверх) */}
        <main key={view} style={{ overflowY: "auto", scrollbarWidth: "none", borderRadius: "var(--r-lg)" }}>
          <div className="muza-view">
            {view === "home" ? (
              <HomeFeed
                api={api}
                canSearch={canSearch}
                greetName={greetName}
                currentId={track?.id ?? null}
                playing={playing}
                likes={likes}
                onPlayCatalog={playCatalog}
                onQueueCatalog={onQueueCatalog}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onCatalogMenu={openCatalogMenu}
                onNotify={showToast}
                onOpen={navigate}
                onOpenWrapped={canSearch ? () => setWrappedOpen(true) : undefined}
              />
            ) : view === "search" ? (
              <SearchView
                api={api}
                canSearch={canSearch}
                currentId={track?.id ?? null}
                playing={playing}
                likes={likes}
                instantSearch={prefs.instantSearch}
                searchScope={prefs.searchScope}
                searchGrouping={prefs.searchGrouping}
                onPlayCatalog={playCatalog}
                onQueueCatalog={onQueueCatalog}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onNotify={showToast}
                onCatalogMenu={openCatalogMenu}
              />
            ) : view === "favorites" ? (
              <FavoritesView
                api={api}
                canSearch={canSearch}
                likes={likes}
                currentId={track?.id ?? null}
                playing={playing}
                onPlayCatalog={playCatalog}
                onQueueCatalog={onQueueCatalog}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onCatalogMenu={openCatalogMenu}
                onNotify={showToast}
              />
            ) : view === "playlist" && openPlaylistId ? (
              <PlaylistView
                key={`${openPlaylistId}:${plBump}`}
                api={api}
                playlistId={openPlaylistId}
                userId={userId}
                likes={likes}
                currentId={track?.id ?? null}
                playing={playing}
                onPlayCatalog={playCatalog}
                onQueueCatalog={onQueueCatalog}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onNotify={showToast}
                onVersions={setVersionsTrack}
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
                onChangeIcon={() => openIconPicker(openPlaylistId)}
              />
            ) : view === "library" ? (
              <LibraryView
                api={api}
                canSearch={canSearch}
                srvPlaylists={srvPlaylists}
                currentId={track?.id ?? null}
                playing={playing}
                onOpenPlaylist={openPlaylist}
                onPlaylistMenu={openPlaylistMenu}
                onPlayLocal={playLocal}
                onAddToPlaylist={(t) => setPlPick(t)}
                onAddLink={() => setAddLinkOpen(true)}
                onImport={() => setImportOpen(true)}
                onJoinCode={() => setJoinOpen(true)}
                onNotify={showToast}
                onDropTrack={dropTrackOnPlaylist}
              />
            ) : view === "stats" ? (
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
              />
            ) : view === "admin" ? (
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
              />
            )}
          </div>
        </main>
        {showNowPlaying ? (
          <NowPlayingPanel
            track={track}
            lyrics={lyrics}
            lyricsLoading={lyricsLoading}
            liked={track ? likes.includes(track.id) : false}
            onLike={() => track && toggleLike(track.id)}
            activeLine={activeLine}
            lyricsAutoScroll={prefs.lyricsAutoScroll}
            onSeekLine={seekLine}
            onExplain={setMeaningLine}
          />
        ) : null}
      </div>

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
      />

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
        vol={vol}
        onVol={pb.setVol}
        liked={track ? likes.includes(track.id) : false}
        onLike={() => track && toggleLike(track.id)}
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

      {/* Меню трека (Stage 4): плейлист + версии/источники;
          Stage 7: поделиться, гостю jam — докинуть трек хосту.
          Оно теперь ЕДИНСТВЕННОЕ: рядом жило фиктивное меню демо-трека, где
          каждый пункт лишь показывал тост («добавлено в очередь», «ссылка
          скопирована») и ничего не делал. */}
      <Menu
        open={catMenu.open}
        x={catMenu.x}
        y={catMenu.y}
        onClose={() => setCatMenu((m) => ({ ...m, open: false }))}
        items={[
          {
            icon: "radio",
            label: t("menu.catalog.radio"),
            onClick: () => {
              if (catMenu.track) void startRadio(catMenu.track);
            },
          },
          {
            icon: "plus",
            label: t("menu.addToPlaylist"),
            onClick: () => {
              if (catMenu.track) setPlPick(catMenu.track);
            },
          },
          ...(jam.active && !jam.isHost
            ? [
                {
                  icon: "radio-tower",
                  label: t("menu.catalog.addToJam"),
                  onClick: () => {
                    if (catMenu.track) void jam.addTrack(catMenu.track.id);
                  },
                },
              ]
            : []),
          {
            icon: "share-2",
            label: t("menu.catalog.share"),
            onClick: () => {
              const clicked = catMenu.track;
              if (clicked) setShareData({ kind: "track", title: clicked.title, artist: clicked.artist, coverUrl: clicked.coverUrl });
            },
          },
          {
            icon: "git-branch",
            label: t("menu.catalog.versions"),
            onClick: () => {
              if (catMenu.track) setVersionsTrack(catMenu.track);
            },
          },
          {
            icon: catMenu.track && pins.has(catMenu.track.id) ? "cloud-off" : "download",
            label: catMenu.track && pins.has(catMenu.track.id) ? t("menu.catalog.removeOffline") : t("menu.catalog.saveOffline"),
            onClick: () => {
              if (catMenu.track) void toggleOffline(catMenu.track);
            },
          },
          // T44: пункты плагинов. Слотов два (contributes.menus.catalogTrack и
          // .track) — оба публичные по PLUGINS.md, и оба висят ЗДЕСЬ: с уходом
          // демо-каталога «трек» и «каталожный трек» стали одним и тем же, а
          // menus.track используют уже написанные плагины (examples/hello-plugin).
          ...(trackMenuPlugins.length ? (["-"] as const) : []),
          ...trackMenuPlugins.map((mi) => ({
            icon: mi.icon || "puzzle",
            label: mi.title,
            onClick: () => {
              if (catMenu.track)
                plugins.notifySlot(mi.pluginId, mi.slotId, "click", {
                  id: catMenu.track.id,
                  title: catMenu.track.title,
                  artist: catMenu.track.artist,
                });
            },
          })),
        ]}
      />

      {/* T17: контекст-меню плейлиста (ПКМ в сайдбаре/медиатеке); совместному
          «от кого-то» владельческие пункты не показываем */}
      <Menu
        open={plMenu.open}
        x={plMenu.x}
        y={plMenu.y}
        onClose={() => setPlMenu((m) => ({ ...m, open: false }))}
        items={[
          {
            icon: "list-music",
            label: t("menu.playlist.open"),
            onClick: () => {
              if (plMenu.pl) openPlaylist(plMenu.pl.id);
            },
          },
          ...(plMenuIsOwner
            ? ([
                {
                  icon: "pencil",
                  label: t("menu.playlist.rename"),
                  onClick: () => {
                    const pl = plMenu.pl;
                    if (!pl) return;
                    setPlRenameValue(pl.name);
                    setPlRename(pl);
                  },
                },
                {
                  icon: "image",
                  label: t("menu.playlist.changeIcon"),
                  onClick: () => {
                    if (plMenu.pl) openIconPicker(plMenu.pl.id);
                  },
                },
                "-",
                {
                  icon: "trash-2",
                  label: t("menu.playlist.delete"),
                  danger: true,
                  onClick: () => {
                    if (plMenu.pl) setPlDelete(plMenu.pl);
                  },
                },
              ] as const)
            : []),
          // T44: пункты плагинов (contributes.menus.playlist)
          ...(plugins.menuItems("playlist").length ? (["-"] as const) : []),
          ...plugins.menuItems("playlist").map((mi) => ({
            icon: mi.icon || "puzzle",
            label: mi.title,
            onClick: () => {
              if (plMenu.pl) plugins.notifySlot(mi.pluginId, mi.slotId, "click", { id: plMenu.pl.id, name: plMenu.pl.name });
            },
          })),
        ]}
      />

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
        onClose={() => setIconPicker(null)}
        onPick={(icon) => void changePlaylistIcon(icon)}
      />

      <VersionsDialog api={api} track={versionsTrack} onClose={() => setVersionsTrack(null)} onNotify={showToast} />

      {/* «Добавить по ссылке» (Stage 4): прямой источник + сразу «в плейлист» */}
      <AddLinkDialog
        api={api}
        open={addLinkOpen}
        onClose={() => setAddLinkOpen(false)}
        onNotify={showToast}
        onAdded={(added) => {
          showToast(t("toast.link.trackAdded", { title: added.title }), "link");
          setPlPick(added); // сразу предлагаем положить в плейлист
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
        title={plPick ? t("app.addToPlaylistDialog.titleWithTrack", { title: plPick.title }) : t("menu.addToPlaylist")}
        onClose={() => setPlPick(null)}
        actions={
          <Button variant="ghost" onClick={() => setPlPick(null)}>
            {t("common.cancel")}
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 280 }}>
          {srvPlaylists.map((p) => (
            <PlaylistPickRow key={p.id} icon={p.icon} name={p.name} onClick={() => void addToPlaylist(p.id, p.name)} />
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
          (оба входа в него, обложка и кнопка бара, тоже недоступны). */}
      {track ? (
      <ListeningMode
        open={expanded}
        track={track}
        lyrics={lyrics}
        lyricsLoading={lyricsLoading}
        playing={playing}
        pos={pos}
        activeLine={activeLine}
        lyricsAutoScroll={prefs.lyricsAutoScroll}
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
        anims={prefs.anims}
      />
      ) : null}
      <MeaningDialog
        open={meaningLine !== null}
        line={meaningLine !== null ? lyrics[meaningLine] ?? null : null}
        annotation={meaningLine !== null ? annotationNotes.get(meaningLine) : undefined}
        geniusUrl={geniusUrl}
        onClose={() => setMeaningLine(null)}
      />
    </DragLayer>
    </div>
    </LanguageProvider>
  );
}

/** Строка плейлиста в диалоге «⋯ → В плейлист» (T47b): та же обложка-иконка,
 *  что в сайдбаре/медиатеке/шапке, вместо статичной "list-music" у всех подряд.
 *  Кнопка @muza/ui поддерживает только именованный Lucide-icon (не картинку) —
 *  поэтому здесь свой pill-баттон в стиле Button variant="secondary". */
function PlaylistPickRow({ icon, name, onClick }: { icon: string | null; name: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const src = playlistIconSrc(icon);
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
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      {src ? (
        <img src={src} alt="" width={20} height={20} style={{ borderRadius: "var(--r-xs)", flex: "none", display: "block" }} />
      ) : (
        <Icon name="list-music" size={18} color="currentColor" />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </button>
  );
}
