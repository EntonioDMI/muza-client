import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Icon, Menu, SearchInput, Toast } from "@muza/ui";
import { HttpMuzaApi, type MuzaApi, type PlaylistMeta, type Session, type Track as CatalogTrack } from "@muza/api-client";
import { NEW_PLAYLIST_COVER, PLAYLISTS, TRACKS, type DemoCollection, type DemoTrack } from "./data/demo";
import { DEFAULT_PREFS, RADIUS_OVERRIDE_OFF, type Prefs, type View } from "./types";
import { accentRoleVars, customAccentVars } from "./lib/accent";
import { dominantColor, mixHex } from "./lib/coverTint";
import { MIGRATED_PREF_KEYS, migrateLegacyValue } from "./lib/legacyPrefs";
import { applySourcePolicy } from "./lib/sources";
import { resumeStore } from "./lib/resumeStore";
import { miniHide, miniListen, miniSendState, miniShow, type MiniCommand, type MiniState } from "./lib/miniBridge";
import { useMediaQuery } from "./lib/useMediaQuery";
import { applyRecipe, engineAvailable, enginePin, enginePins, resolvePlayable, setCacheLimit } from "./lib/engine";
import { exportCachedTrack } from "./lib/dragOut";
import { syncAutostart, trayConfigure } from "./lib/system";
import { autoCheckForUpdate } from "./lib/updater";
import { setSnapshotScope, withSnapshot } from "./lib/offlineSnapshot";
import { clearDiscordActivity, formatTemplate, updateDiscordActivity } from "./lib/discord";
import { useTelemetry, type PlayCounters } from "./lib/useTelemetry";
import { useCoverArt } from "./lib/coverArt";
import { comboFromEvent, matchAction, formatCombo, HOTKEY_ACTIONS } from "./lib/hotkeys";
import { loadServerIds, localScanPaths, registerLocalTracks, type LocalEntry } from "./lib/localFiles";
import { usePlayback } from "./player/usePlayback";
import { useLyrics } from "./player/useLyrics";
import { useAnnotations } from "./player/useAnnotations";
import { decorateLyrics, shouldFetchAnnotations } from "./player/annotations";
import { useMediaSession } from "./player/useMediaSession";
import { useJam } from "./player/useJam";
import { fromCatalog, fromDemo, fromLocalEntry, type PlayerTrack } from "./player/types";
import type { ShareData } from "./lib/shareCard";
import { LoginScreen } from "./auth/LoginScreen";
import { Sidebar } from "./shell/Sidebar";
import { NowPlayingPanel } from "./shell/NowPlayingPanel";
import { PlayerBar } from "./shell/PlayerBar";
import { QueuePanel } from "./shell/QueuePanel";
import { ListeningMode } from "./shell/ListeningMode";
import { MeaningDialog } from "./shell/MeaningDialog";
import { VersionsDialog } from "./shell/VersionsDialog";
import { AddLinkDialog } from "./shell/AddLinkDialog";
import { ImportDialog } from "./shell/ImportDialog";
import { JamDialog } from "./shell/JamDialog";
import { JoinPlaylistDialog } from "./shell/JoinPlaylistDialog";
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

export function App() {
  const api = useMemo(
    () => new HttpMuzaApi(import.meta.env.VITE_API_URL ?? "http://localhost:8000/api"),
    [],
  );
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
    return <LoginScreen api={api} onSession={setSession} />;
  }
  return (
    <Player
      api={api}
      userId={session.user.id}
      canSearch={!session.user.anonymous}
      greetName={session.user.anonymous ? null : session.user.username}
      username={session.user.anonymous ? "Аноним (без синхронизации)" : (session.user.username ?? "")}
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

/** Демо-очередь по умолчанию: главная/библиотека живут на демо-каталоге. */
const DEMO_QUEUE = TRACKS.map(fromDemo);

/** Восстановление плеера при старте (T2: защита от «песни сами играют»).
 *  Плеер НИКОГДА не стартует играющим сам (usePlayback.playing начинается с
 *  false) — здесь решаем только ЧТО показать «готовым»: если владелец включил
 *  «Запоминать позицию трека» и есть последний активный трек — очередь из
 *  него на сохранённой позиции; иначе — прежний демо-заглушечный бар. */
function initialPlaybackState(): { queue: PlayerTrack[]; pos: number } {
  const prefs = loadPrefs();
  if (prefs.resumePosition) {
    const last = resumeStore.getLast();
    if (last) {
      const saved = resumeStore.get(last.id);
      return { queue: [last], pos: saved > 0 ? saved : 0 };
    }
  }
  return { queue: DEMO_QUEUE, pos: 24 }; // 24 — как в демо Stage 1, «уже населённый» бар
}

/** Каркас плеера. Stage 3: реальное воспроизведение каталожных треков
 *  (добыча на своём IP → LRU-кэш → Web Audio), демо-треки — симуляция. */
function Player({
  api,
  userId,
  canSearch,
  greetName,
  username,
  onLogout,
}: {
  api: MuzaApi;
  /** id пользователя — скоуп оффлайн-снапшотов (чужая библиотека не светится). */
  userId: string;
  canSearch: boolean;
  /** Ник для приветствия на главной; null у анонима. */
  greetName: string | null;
  username: string;
  onLogout: () => void;
}) {
  // Скоуп снапшотов — до первых загрузок (эффекты ниже читают через withSnapshot)
  setSnapshotScope(userId);
  // Стартовый экран — из prefs (Stage 6, «Поведение»)
  const [view, setView] = useState<View>(() => loadPrefs().startView);
  const [likes, setLikes] = useState<string[]>(["t3"]);
  // Запрос открыть конкретный под-экран настроек (кнопка эквалайзера в баре)
  const [settingsIntent, setSettingsIntent] = useState<SettingsIntent | null>(null);
  const [lyricsOn, setLyricsOn] = useState(true);
  const [queueOn, setQueueOn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [meaningLine, setMeaningLine] = useState<number | null>(null);
  const [playlists, setPlaylists] = useState<DemoCollection[]>(PLAYLISTS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [plName, setPlName] = useState("");
  // Слайс 4: серверные плейлисты и открытая страница плейлиста
  const [srvPlaylists, setSrvPlaylists] = useState<PlaylistMeta[]>([]);
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  // выбор плейлиста для «В плейлист» из поиска
  const [plPick, setPlPick] = useState<CatalogTrack | null>(null);
  // Stage 4: меню каталожного трека («⋯») и диалог «Версии и источники»
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
  const [menu, setMenu] = useState<{ open: boolean; x: number; y: number; track: DemoTrack | null }>({
    open: false,
    x: 0,
    y: 0,
    track: null,
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Кастомизация переживает перезапуск: без этого все настройки слетали
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  };

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
    // Скробблинг: каталожные прослушивания — в историю сервера (демо — нет)
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
        showToast("Радио: продолжаем похожими треками", "radio");
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

  // Jam — слушать вместе (Stage 7): хост пушит состояние, гость следует
  const jam = useJam({
    api,
    enabled: canSearch,
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
  const cleanCover = useCoverArt(pbRaw.track.cover);

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
    () => ({ ...pbRaw, track: { ...pbRaw.track, cover: cleanCover } }),
    [pbRaw, cleanCover],
  );
  const { track, playing, pos, vol } = pb;

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
  // треков живут на сервере; демо-треки — по-прежнему локально).
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
      await resolvePlayable(t.id, applySourcePolicy(sources, prefs));
      return true;
    } catch {
      return false; // пин остался — докачается при первом прослушивании
    }
  };

  const toggleOffline = async (t: CatalogTrack) => {
    if (pins.has(t.id)) {
      await enginePin(t.id, false);
      setPins((p) => {
        const next = new Set(p);
        next.delete(t.id);
        return next;
      });
      showToast("Убрано из оффлайна", "cloud-off");
      return;
    }
    showToast("Сохраняем оффлайн…", "download");
    const ok = await saveOffline(t);
    showToast(
      ok === false ? "Закреплено — скачаем при первом прослушивании" : "Сохранено оффлайн",
      "download",
    );
  };

  /** «Сохранить оффлайн» на плейлисте: пины + фоновая догрузка по очереди. */
  const saveOfflinePlaylist = async (tracks: CatalogTrack[]) => {
    const targets = tracks.filter((t) => /^\d+$/.test(t.id));
    if (targets.length === 0) return;
    showToast(`Сохраняем оффлайн ${targets.length} тр. — качаем в фоне`, "download");
    let ok = 0;
    for (const t of targets) {
      const r = await saveOffline(t);
      if (r !== false) ok += 1;
    }
    setPins((p) => new Set([...p, ...targets.map((t) => t.id)]));
    showToast(`Оффлайн готов: ${ok} из ${targets.length} скачано`, "download");
  };

  /** Каталожный (серверный) id — числовой; демо-ид вида "t1". */
  const isCatalogId = (id: string) => /^\d+$/.test(id);

  /** «Радио по треку» (Stage 5): очередь = трек + похожие с сервера. */
  const startRadio = async (t: CatalogTrack) => {
    showToast("Собираем радио…", "radio");
    try {
      const radio = await api.getRadio(t.id);
      pb.playContext([t, ...radio].map(fromCatalog), t.id);
      showToast(`Радио по «${t.title}»`, "radio");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось собрать радио", "x");
    }
  };

  // Адаптив окна: фиксированные колонки не должны душить контент.
  // < 1200px — прячем «Сейчас играет» (вторична), < 950px — ужимаем сайдбар.
  const wideEnoughForPanel = useMediaQuery("(min-width: 1200px)");
  const wideEnoughForSidebar = useMediaQuery("(min-width: 950px)");
  const showNowPlaying = lyricsOn && wideEnoughForPanel;

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
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    playing,
    pos,
    duration: track.duration,
    liked: likes.includes(track.id),
  });
  const miniRef = useRef({ send: () => {}, cmd: (_c: MiniCommand) => {} });
  miniRef.current = {
    send: () => void miniSendState(miniStateNow()),
    cmd: (c: MiniCommand) => {
      if (c === "toggle") pb.toggle();
      else if (c === "next") pb.next();
      else if (c === "prev") pb.prev();
      else if (c === "like") toggleLike(track.id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.miniPlayer, track.id, playing, likes, miniPos]);

  // Discord Rich Presence: активность на смену трека/паузу (RPC живёт в Rust;
  // Discord не запущен или client_id не настроен — no-op). Строки — из
  // шаблонов настроек ({track}/{artist}/{album}; альбома у каталожных нет).
  useEffect(() => {
    if (!prefs.discordRpcOn || !playing) {
      void clearDiscordActivity();
      return;
    }
    const vars = { track: track.title, artist: track.artist, album: track.album };
    void updateDiscordActivity({
      details: formatTemplate(prefs.discordLine1, vars) || track.title,
      state: formatTemplate(prefs.discordLine2, vars) || track.artist,
      coverUrl: prefs.discordShowCover && track.cover.startsWith("https") ? track.cover : null,
      startTs: Math.floor(Date.now() / 1000 - pos),
      buttonLabel: prefs.discordBtnOn ? prefs.discordBtnLabel : null,
      buttonUrl: prefs.discordBtnOn ? prefs.discordBtnUrl : null,
    });
    // pos нарочно не в deps: активность шлём на смену трека/состояния, не каждый тик
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    track.id,
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
      ? "Таймер сна выключен"
      : sleep.mode === "track"
        ? "Сон в конце трека"
        : `Сон через ${sleep.mode} мин`;
  const cycleSleep = () => {
    const order: ("off" | "track" | number)[] = ["off", ...prefs.sleepPresets, "track"];
    const i = order.findIndex((m) => m === sleep.mode);
    const mode = order[(i + 1) % order.length];
    const minutes = typeof mode === "number" ? mode : null;
    setSleep({ mode, at: minutes ? Date.now() + minutes * 60_000 : null });
    showToast(
      mode === "off" ? "Таймер сна выключен" : mode === "track" ? "Уснём в конце трека" : `Уснём через ${minutes} мин`,
      "moon",
    );
  };
  useEffect(() => {
    if (!sleep.at) return;
    const iv = setInterval(() => {
      if (Date.now() >= (sleep.at ?? Infinity)) {
        setSleep({ mode: "off", at: null });
        pb.pause();
        showToast("Таймер сна: пауза", "moon");
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
    if (sleepTrackArmedRef.current === null) {
      sleepTrackArmedRef.current = track.id; // взводим на текущем треке
      return;
    }
    if (sleepTrackArmedRef.current !== track.id) {
      setSleep({ mode: "off", at: null });
      pb.pause();
      showToast("Таймер сна: пауза", "moon");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleep.mode, track.id]);

  // Тексты: демо — локальные строки, каталог — LRCLIB с сервера
  const { lines: rawLyrics, trackId: lyricsTrackId, synced: lyricsSynced, loading: lyricsLoading } = useLyrics(api, track, canSearch);

  // «Режим смысла» (Stage 5): настоящие Genius-аннотации каталожного трека —
  // строкам с аннотацией ставится note (пунктир в Lyrics, карточка в панели);
  // индексы аннотаций привязаны к synced-строкам, plain не размечаем.
  // Тумблер prefs.meaningMode (Тексты) выключает и Genius, и демо-note.
  const canFetchAnnotations = shouldFetchAnnotations(
    canSearch,
    prefs.meaningMode,
    lyricsLoading,
    lyricsTrackId,
    track.id,
    rawLyrics.length,
  );
  const { notes: annotationNotes, geniusUrl } = useAnnotations(api, track, canFetchAnnotations);
  const lyrics = useMemo(
    () => decorateLyrics(rawLyrics, annotationNotes, prefs.meaningMode),
    [rawLyrics, annotationNotes, prefs.meaningMode],
  );
  useEffect(() => setMeaningLine(null), [track.id, prefs.meaningMode]);

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
  const queueCatalog = (t: CatalogTrack) => {
    pbRaw.insertInQueue(fromCatalog(t), pbRaw.queue.length);
    showToast(`В очередь: ${t.title}`, "list-music");
  };
  const queueDemo = (id: string) => {
    const t = TRACKS.find((x) => x.id === id);
    if (!t) return;
    pbRaw.insertInQueue(fromDemo(t), pbRaw.queue.length);
    showToast(`В очередь: ${t.title}`, "list-music");
  };
  const onQueueCatalog = prefs.doubleClickAction === "queue" ? queueCatalog : undefined;
  const onQueueDemo = prefs.doubleClickAction === "queue" ? queueDemo : undefined;

  /** Тост с кнопкой «Вернуть» (живёт дольше — юзер должен успеть). */
  const showUndoToast = (text: string, icon: string, onUndo: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({
      open: true,
      text,
      icon,
      actionLabel: "Вернуть",
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
        showToast("Аудиофайлов среди брошенного не нашлось", "x");
        return;
      }
      if (canSearch) await registerLocalTracks(api, entries);
      showToast(`Добавлено локальных треков: ${entries.length}`, "folder-down");
      setView("library");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось добавить файлы", "x");
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

  // Автопроверка обновлений (Stage 8): через 30с после старта, не чаще раза в
  // сутки; нашлось — тост с «Установить» (скачивание → перезапуск сам)
  useEffect(() => {
    const timer = setTimeout(() => {
      void autoCheckForUpdate().then((found) => {
        if (!found) return;
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({
          open: true,
          text: `Доступна Muza ${found.version}`,
          icon: "download",
          actionLabel: "Установить",
          onAction: () => {
            setToast({ open: true, text: "Скачиваем обновление — Muza перезапустится сама…", icon: "download" });
            found.install(() => undefined).catch(() => showToast("Не удалось установить обновление", "x"));
          },
        });
        toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 12000);
      });
    }, 30_000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Клик по демо-треку (главная/библиотека/демо-поиск): очередь = демо-каталог. */
  const playTrack = (id: string) => pb.playContext(DEMO_QUEUE, id);
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
    setView("settings");
    setSettingsIntent({ sub: "equalizer", nonce: Date.now() });
  };

  // Циклические кнопки бара тостят новое состояние (иконка меняется тонко)
  const cycleSpeedWithToast = () => {
    const next = pb.cycleSpeed();
    showToast(`Скорость: ${next}×`, "gauge");
  };
  const cycleRepeatWithToast = () => {
    const next = pb.cycleRepeat();
    showToast(next === "off" ? "Повтор выключен" : next === "all" ? "Повтор очереди" : "Повтор трека", "repeat");
  };

  // ── Очередь (UX-доводка): операции + возврат фокуса ───────────────
  /** Закрыть панель и вернуть фокус на кнопку очереди (клавиатурный путь). */
  const closeQueue = () => {
    setQueueOn(false);
    (document.querySelector('button[aria-label="Очередь"]') as HTMLButtonElement | null)?.focus();
  };

  const removeQueueTrack = (id: string) => {
    const removed = pb.removeFromQueue(id);
    if (!removed) return;
    showUndoToast(`«${removed.track.title}» убран из очереди`, "list-x", () =>
      pb.insertInQueue(removed.track, removed.index),
    );
  };

  const saveQueueAsPlaylist = async () => {
    const catalog = pb.queue.filter((t) => isCatalogId(t.id));
    if (catalog.length === 0) {
      showToast("В очереди нет каталожных треков — сохранять нечего", "x");
      return;
    }
    try {
      const name = `Очередь ${new Date().toLocaleDateString("ru")}`;
      const created = await api.createPlaylist(name);
      for (const t of catalog) await api.addPlaylistTrack(created.id, t.id);
      await reloadServerPlaylists();
      showToast(`Сохранено: «${name}» · ${catalog.length} тр.`, "save");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось сохранить очередь", "x");
    }
  };

  // Оверлей горячих клавиш (клавиша «?»)
  const [hotkeysOpen, setHotkeysOpen] = useState(false);

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
        pb.seek(Math.min(pos + 5, track.duration));
        break;
      case "seekBack":
        pb.seek(Math.max(pos - 5, 0));
        break;
      case "mute":
        toggleMute();
        break;
      case "like":
        toggleLike(track.id);
        break;
      case "search":
        e.preventDefault();
        setView("search");
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
    showToast(had ? "Убрано из Любимого" : "Добавлено в Любимое", "heart");
    // каталожный трек при серверной сессии — синхронизируем (optimistic;
    // упало → откатываем и честно говорим)
    if (canSearch && isCatalogId(id)) {
      (had ? api.removeFavorite(id) : api.addFavorite(id)).catch(() => {
        setLikes((ls) => (had ? [...ls, id] : ls.filter((x) => x !== id)));
        showToast("Не удалось синхронизировать лайк", "x");
      });
    }
  };

  const openTrackMenu = (t: DemoTrack, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenu({
      open: true,
      x: Math.min(e.clientX, window.innerWidth - 250),
      y: Math.min(e.clientY, window.innerHeight - 220),
      track: t,
    });
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

  const createPlaylist = async () => {
    const name = plName.trim() || "Новый плейлист";
    if (canSearch) {
      try {
        const created = await api.createPlaylist(name);
        await reloadServerPlaylists();
        setDialogOpen(false);
        setPlName("");
        showToast("Плейлист создан", "list-music");
        setOpenPlaylistId(created.id);
        setView("playlist");
        return;
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Не удалось создать плейлист", "x");
        return;
      }
    }
    setPlaylists((ps) => [...ps, { id: `p${ps.length + 1}${Date.now()}`, name, meta: "0 треков", cover: NEW_PLAYLIST_COVER }]);
    setDialogOpen(false);
    setPlName("");
    showToast("Плейлист создан", "list-music");
  };

  // Сайдбар: серверная сессия видит настоящие плейлисты (Stage 7: + совместные),
  // аноним — демо
  const sidebarPlaylists = canSearch
    ? srvPlaylists.map((p) => ({
        id: p.id,
        name: p.name,
        meta:
          p.role === "collaborator"
            ? `${p.trackCount} тр. · от ${p.ownerUsername}`
            : p.collaboratorsCount > 0
              ? `${p.trackCount} тр. · совместный`
              : `${p.trackCount} тр.`,
        shared: p.role === "collaborator" || p.collaboratorsCount > 0,
      }))
    : playlists;

  const openPlaylist = (id: string) => {
    if (!canSearch) {
      setView("library"); // демо-плейлисты без страниц
      return;
    }
    setOpenPlaylistId(id);
    setView("playlist");
  };

  const addToPlaylist = async (playlistId: string, playlistName: string) => {
    if (!plPick) return;
    setPlPick(null);
    try {
      await api.addPlaylistTrack(playlistId, plPick.id);
      await reloadServerPlaylists();
      showToast(`Добавлено в «${playlistName}»`, "list-music");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось добавить", "x");
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

  // Фон за интерфейсом (Stage 6): тип + затемнение поверх (читаемость)
  const backdrop =
    prefs.bgType === "cover" ? (
      <img
        key={track.cover}
        src={track.cover}
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

  return (
    <div data-theme={prefs.theme} data-accent={accentAttr} data-radius={prefs.radius} style={rootStyle}>
      {/* CSS-тир (Stage 6): свой CSS поверх всех токенов — «опасная зона» */}
      {prefs.customCssOn && prefs.customCss ? <style>{prefs.customCss}</style> : null}
      {backdrop}
      {backdrop && prefs.bgDim > 0 ? (
        <div style={{ position: "absolute", inset: 0, background: `rgba(0, 0, 0, ${prefs.bgDim / 100})` }} />
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
          setView={setView}
          navItems={prefs.navItems}
          playlists={sidebarPlaylists}
          onCreatePlaylist={() => setDialogOpen(true)}
          onOpenPlaylist={openPlaylist}
          // DnD: строка трека брошена на плейлист (только серверные списки)
          onDropTrack={
            canSearch
              ? (playlistId, trackId) => {
                  const name = sidebarPlaylists.find((p) => p.id === playlistId)?.name ?? "плейлист";
                  api
                    .addPlaylistTrack(playlistId, trackId)
                    .then(async () => {
                      await reloadServerPlaylists();
                      showToast(`Добавлено в «${name}»`, "list-music");
                    })
                    .catch((e: unknown) => showToast(e instanceof Error ? e.message : "Не удалось добавить", "x"));
                }
              : undefined
          }
          isAdmin={isAdmin}
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
                currentId={track.id}
                playing={playing}
                likes={likes}
                onPlayTrack={playTrack}
                onPlayCatalog={playCatalog}
                onQueueCatalog={onQueueCatalog}
                onQueueDemo={onQueueDemo}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onTrackMenu={openTrackMenu}
                onCatalogMenu={openCatalogMenu}
                onOpen={setView}
                onOpenWrapped={canSearch ? () => setWrappedOpen(true) : undefined}
              />
            ) : view === "search" ? (
              <SearchView
                api={api}
                canSearch={canSearch}
                currentId={track.id}
                playing={playing}
                likes={likes}
                instantSearch={prefs.instantSearch}
                searchScope={prefs.searchScope}
                onPlayTrack={playTrack}
                onPlayCatalog={playCatalog}
                onQueueCatalog={onQueueCatalog}
                onQueueDemo={onQueueDemo}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onTrackMenu={openTrackMenu}
                onNotify={showToast}
                onCatalogMenu={openCatalogMenu}
              />
            ) : view === "favorites" ? (
              <FavoritesView
                api={api}
                canSearch={canSearch}
                likes={likes}
                currentId={track.id}
                playing={playing}
                onPlayTrack={playTrack}
                onPlayCatalog={playCatalog}
                onQueueCatalog={onQueueCatalog}
                onQueueDemo={onQueueDemo}
                rowShow={prefs.rowShow}
                onLike={toggleLike}
                onTrackMenu={openTrackMenu}
                onCatalogMenu={openCatalogMenu}
              />
            ) : view === "playlist" && openPlaylistId ? (
              <PlaylistView
                api={api}
                playlistId={openPlaylistId}
                userId={userId}
                likes={likes}
                currentId={track.id}
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
                onChanged={() => void reloadServerPlaylists()}
                onDeleted={() => {
                  setOpenPlaylistId(null);
                  setView("home");
                }}
              />
            ) : view === "library" ? (
              <LibraryView
                api={api}
                canSearch={canSearch}
                srvPlaylists={srvPlaylists}
                currentId={track.id}
                playing={playing}
                onOpenPlaylist={openPlaylist}
                onPlayTrack={playTrack}
                onPlayLocal={playLocal}
                onAddToPlaylist={(t) => setPlPick(t)}
                onAddLink={() => setAddLinkOpen(true)}
                onImport={() => setImportOpen(true)}
                onJoinCode={() => setJoinOpen(true)}
                onNotify={showToast}
              />
            ) : view === "stats" ? (
              <StatsView
                api={api}
                canSearch={canSearch}
                prefs={prefs}
                currentId={track.id}
                playing={playing}
                likes={likes}
                onPlayCatalog={playCatalog}
                onLike={toggleLike}
                onCatalogMenu={openCatalogMenu}
                onOpenWrapped={() => setWrappedOpen(true)}
                onCustomize={() => {
                  setView("settings");
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
                onLogout={onLogout}
                onNotify={showToast}
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
            liked={likes.includes(track.id)}
            onLike={() => toggleLike(track.id)}
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
          showToast("Хвост очереди очищен", "list-x");
        }}
        onSaveAsPlaylist={() => void saveQueueAsPlaylist()}
      />

      <PlayerBar
        track={track}
        playing={playing}
        buttons={prefs.barButtons}
        buffering={pb.buffering}
        onTogglePlay={pb.toggle}
        onPrev={pb.prev}
        onNext={pb.next}
        pos={pos}
        onSeek={pb.seek}
        vol={vol}
        onVol={pb.setVol}
        liked={likes.includes(track.id)}
        onLike={() => toggleLike(track.id)}
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
          engineAvailable()
            ? async () => {
                try {
                  return await exportCachedTrack(track.id, track.artist, track.title);
                } catch (e) {
                  showToast(e instanceof Error ? e.message : "Не удалось подготовить файл", "x");
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
              Отпусти — добавим в Muza
            </span>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
              Аудиофайлы и папки станут локальными треками
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

      <Menu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu((m) => ({ ...m, open: false }))}
        items={[
          { icon: "list-plus", label: "В очередь", onClick: () => showToast("Добавлено в очередь", "list-plus") },
          { icon: "plus", label: "В плейлист", onClick: () => showToast("Добавлено в «Ночной вайб»", "list-music") },
          {
            icon: "mic-vocal",
            label: "Показать текст",
            onClick: () => {
              if (menu.track) playTrack(menu.track.id);
              setExpanded(true);
            },
          },
          "-",
          { icon: "link", label: "Скопировать ссылку", onClick: () => showToast("Ссылка скопирована", "link") },
        ]}
      />

      {/* Меню каталожного трека (Stage 4): плейлист + версии/источники;
          Stage 7: поделиться, гостю jam — докинуть трек хосту */}
      <Menu
        open={catMenu.open}
        x={catMenu.x}
        y={catMenu.y}
        onClose={() => setCatMenu((m) => ({ ...m, open: false }))}
        items={[
          {
            icon: "radio",
            label: "Радио по треку",
            onClick: () => {
              if (catMenu.track) void startRadio(catMenu.track);
            },
          },
          {
            icon: "plus",
            label: "В плейлист",
            onClick: () => {
              if (catMenu.track) setPlPick(catMenu.track);
            },
          },
          ...(jam.active && !jam.isHost
            ? [
                {
                  icon: "radio-tower",
                  label: "В jam",
                  onClick: () => {
                    if (catMenu.track) void jam.addTrack(catMenu.track.id);
                  },
                },
              ]
            : []),
          {
            icon: "share-2",
            label: "Поделиться",
            onClick: () => {
              const t = catMenu.track;
              if (t) setShareData({ kind: "track", title: t.title, artist: t.artist, coverUrl: t.coverUrl });
            },
          },
          {
            icon: "git-branch",
            label: "Версии и источники",
            onClick: () => {
              if (catMenu.track) setVersionsTrack(catMenu.track);
            },
          },
          {
            icon: catMenu.track && pins.has(catMenu.track.id) ? "cloud-off" : "download",
            label: catMenu.track && pins.has(catMenu.track.id) ? "Убрать из оффлайна" : "Сохранить оффлайн",
            onClick: () => {
              if (catMenu.track) void toggleOffline(catMenu.track);
            },
          },
        ]}
      />

      <VersionsDialog api={api} track={versionsTrack} onClose={() => setVersionsTrack(null)} onNotify={showToast} />

      {/* «Добавить по ссылке» (Stage 4): прямой источник + сразу «в плейлист» */}
      <AddLinkDialog
        api={api}
        open={addLinkOpen}
        onClose={() => setAddLinkOpen(false)}
        onNotify={showToast}
        onAdded={(t) => {
          showToast(`«${t.title}» добавлен`, "link");
          setPlPick(t); // сразу предлагаем положить в плейлист
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
          setOpenPlaylistId(report.playlist.id);
          setView("playlist");
        }}
      />

      {/* Вход в совместный плейлист по коду (Stage 7) */}
      <JoinPlaylistDialog
        api={api}
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={(p) => {
          setJoinOpen(false);
          void reloadServerPlaylists();
          showToast(`Ты в плейлисте «${p.name}» (от ${p.ownerUsername})`, "users");
          setOpenPlaylistId(p.id);
          setView("playlist");
        }}
      />

      {/* Jam — слушать вместе (Stage 7) */}
      <JamDialog jam={jam} open={jamOpen} canUse={canSearch} onClose={() => setJamOpen(false)} onNotify={showToast} />

      {/* Шеринг-карточка (Stage 7): трек/плейлист/Wrapped */}
      <ShareDialog data={shareData} onClose={() => setShareData(null)} onNotify={showToast} />

      {/* Wrapped «Итоги года» (Stage 7) */}
      <WrappedOverlay
        api={api}
        open={wrappedOpen}
        onClose={() => setWrappedOpen(false)}
        onShare={setShareData}
      />

      <Dialog
        open={dialogOpen}
        title="Новый плейлист"
        onClose={() => setDialogOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="plus" onClick={createPlaylist}>
              Создать
            </Button>
          </>
        }
      >
        <SearchInput value={plName} onChange={setPlName} placeholder="Название" icon="list-music" autoFocus />
      </Dialog>

      {/* Выбор плейлиста для найденного трека («⋯ → В плейлист») */}
      <Dialog
        open={plPick !== null}
        title={plPick ? `«${plPick.title}» — в плейлист` : "В плейлист"}
        onClose={() => setPlPick(null)}
        actions={
          <Button variant="ghost" onClick={() => setPlPick(null)}>
            Отмена
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 280 }}>
          {srvPlaylists.map((p) => (
            <Button key={p.id} variant="secondary" icon="list-music" onClick={() => void addToPlaylist(p.id, p.name)} style={{ justifyContent: "flex-start" }}>
              {p.name}
            </Button>
          ))}
          {srvPlaylists.length === 0 ? (
            <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.5 }}>
              Плейлистов пока нет — создай первый кнопкой «+» в сайдбаре.
            </div>
          ) : null}
        </div>
      </Dialog>

      {/* Справка по клавишам: «?» или вкладка настроек */}
      <Dialog open={hotkeysOpen} title="Горячие клавиши" onClose={() => setHotkeysOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 320 }}>
          {[
            ...HOTKEY_ACTIONS.map((a) => ({ action: a.label, combo: formatCombo(prefs.hotkeys[a.id]) })),
            { action: "Поиск / закрыть оверлей", combo: "Esc" },
            { action: "Эта справка", combo: "?" },
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
            Переназначить — Настройки → Клавиши.
          </div>
        </div>
      </Dialog>

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
        visualizer={prefs.visualizer}
        getAnalyser={pb.getAnalyser}
      />
      <MeaningDialog
        open={meaningLine !== null}
        line={meaningLine !== null ? lyrics[meaningLine] ?? null : null}
        annotation={meaningLine !== null ? annotationNotes.get(meaningLine) : undefined}
        geniusUrl={geniusUrl}
        onClose={() => setMeaningLine(null)}
      />
    </div>
  );
}
