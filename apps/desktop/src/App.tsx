import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Menu, SearchInput, Toast } from "@muza/ui";
import { HttpMuzaApi, type MuzaApi, type Session } from "@muza/api-client";
import { NEW_PLAYLIST_COVER, PLAYLISTS, TRACKS, type DemoCollection, type DemoTrack } from "./data/demo";
import { DEFAULT_PREFS, type Prefs, type RepeatMode, type View } from "./types";
import { customAccentVars } from "./lib/accent";
import { useMediaQuery } from "./lib/useMediaQuery";
import { LoginScreen } from "./auth/LoginScreen";
import { Sidebar } from "./shell/Sidebar";
import { NowPlayingPanel } from "./shell/NowPlayingPanel";
import { PlayerBar } from "./shell/PlayerBar";
import { QueuePanel } from "./shell/QueuePanel";
import { ListeningMode } from "./shell/ListeningMode";
import { HomeFeed } from "./views/HomeFeed";
import { SearchView } from "./views/SearchView";
import { FavoritesView } from "./views/FavoritesView";
import { LibraryView } from "./views/LibraryView";
import { SettingsView, type SettingsIntent } from "./views/SettingsView";

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
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Каркас плеера Stage 1: воспроизведение имитируется таймером (реальный движок — Stage 3). */
function Player({
  api,
  canSearch,
  greetName,
  username,
  onLogout,
}: {
  api: MuzaApi;
  canSearch: boolean;
  /** Ник для приветствия на главной; null у анонима. */
  greetName: string | null;
  username: string;
  onLogout: () => void;
}) {
  const [view, setView] = useState<View>("home");
  const [currentId, setCurrentId] = useState(TRACKS[0].id);
  const [playing, setPlaying] = useState(true);
  const [pos, setPos] = useState(24);
  const [vol, setVol] = useState(64);
  const [likes, setLikes] = useState<string[]>(["t3"]);
  const [shuffle, setShuffle] = useState(false);
  // Повтор трёхрежимный: выкл → вся очередь → один трек (как в нормальных плеерах)
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  // Частая настройка — живёт в плеер-баре; в демо честно ускоряет таймер
  const [speed, setSpeed] = useState(1);
  // Запрос открыть конкретный под-экран настроек (кнопка эквалайзера в баре)
  const [settingsIntent, setSettingsIntent] = useState<SettingsIntent | null>(null);
  const [lyricsOn, setLyricsOn] = useState(true);
  const [queueOn, setQueueOn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [playlists, setPlaylists] = useState<DemoCollection[]>(PLAYLISTS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [plName, setPlName] = useState("");
  const [toast, setToast] = useState({ open: false, text: "", icon: "check" });
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

  const track = TRACKS.find((t) => t.id === currentId) ?? TRACKS[0];
  const idx = TRACKS.indexOf(track);

  // Адаптив окна: фиксированные колонки не должны душить контент.
  // < 1200px — прячем «Сейчас играет» (вторична), < 950px — ужимаем сайдбар.
  const wideEnoughForPanel = useMediaQuery("(min-width: 1200px)");
  const wideEnoughForSidebar = useMediaQuery("(min-width: 950px)");
  const showNowPlaying = lyricsOn && wideEnoughForPanel;

  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      setPos((p) => {
        if (p + 1 <= track.duration) return p + 1;
        // конец трека: повтор трека — сначала; иначе дальше по очереди,
        // а без повтора на последнем — стоп
        if (repeat === "one") return 0;
        const isLast = TRACKS.indexOf(track) === TRACKS.length - 1;
        if (repeat === "off" && isLast) {
          setPlaying(false);
          return track.duration;
        }
        stepRef.current(1);
        return 0;
      });
    }, 1000 / speed);
    return () => clearInterval(iv);
  }, [playing, track, speed, repeat]);

  const activeLine = useMemo(() => {
    let a = 0;
    track.lyrics.forEach((l, i) => {
      if (l.t <= pos) a = i;
    });
    return a;
  }, [pos, track]);

  const showToast = (text: string, icon = "check") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ open: true, text, icon });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), 2400);
  };

  const playTrack = (id: string) => {
    if (id === currentId) {
      setPlaying(!playing);
      return;
    }
    setCurrentId(id);
    setPos(0);
    setPlaying(true);
  };
  const step = (d: number) => {
    const n = (idx + d + TRACKS.length) % TRACKS.length;
    setCurrentId(TRACKS[n].id);
    setPos(0);
    setPlaying(true);
  };
  // таймеру конца трека нужен свежий step без пересоздания интервала
  const stepRef = useRef(step);
  stepRef.current = step;

  const cycleRepeat = () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
  const cycleSpeed = () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]);
  const openEqualizer = () => {
    setView("settings");
    setSettingsIntent({ sub: "equalizer", nonce: Date.now() });
  };

  // Mute: клик по иконке громкости или клавиша M; помним прежний уровень
  const prevVolRef = useRef(64);
  const toggleMute = () => {
    setVol((v) => {
      if (v > 0) {
        prevVolRef.current = v;
        return 0;
      }
      return prevVolRef.current || 64;
    });
  };

  // Глобальные горячие клавиши — база нативности десктоп-плеера.
  // Слушатель один на маунт, актуальные значения — через ref (без стейл-замыканий).
  const hotkeysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  hotkeysRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space") {
      e.preventDefault(); // иначе скроллит страницу / жмёт сфокусированную кнопку
      setPlaying((p) => !p);
    } else if (e.code === "ArrowRight" && e.ctrlKey) step(1);
    else if (e.code === "ArrowLeft" && e.ctrlKey) step(-1);
    else if (e.code === "ArrowRight") setPos((p) => Math.min(p + 5, track.duration));
    else if (e.code === "ArrowLeft") setPos((p) => Math.max(p - 5, 0));
    else if (k === "m" || k === "ь") toggleMute();
    else if (k === "l" || k === "д") toggleLike(currentId);
    else if ((k === "k" || k === "л") && e.ctrlKey) {
      e.preventDefault();
      setView("search");
    } else if (e.code === "Escape" && queueOn) setQueueOn(false);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => hotkeysRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const seekLine = (i: number) => setPos(track.lyrics[i].t);
  const toggleLike = (id: string) => {
    const had = likes.includes(id);
    setLikes((ls) => (had ? ls.filter((x) => x !== id) : [...ls, id]));
    showToast(had ? "Убрано из Любимого" : "Добавлено в Любимое", "heart");
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

  const createPlaylist = () => {
    const name = plName.trim() || "Новый плейлист";
    setPlaylists((ps) => [...ps, { id: `p${ps.length + 1}${Date.now()}`, name, meta: "0 треков", cover: NEW_PLAYLIST_COVER }]);
    setDialogOpen(false);
    setPlName("");
    showToast("Плейлист создан", "list-music");
  };

  const accentAttr = prefs.accent === "blue" || prefs.accent === "custom" ? undefined : prefs.accent;
  const rootStyle = {
    position: "absolute",
    inset: 0,
    background: "var(--bg-0)",
    overflow: "hidden",
    fontFamily: "var(--font-ui)",
    "--blur-glass": `${prefs.blur}px`,
    "--glass-panel": `rgba(23, 22, 20, ${prefs.glassOpacity / 100})`,
    // свой акцент: все четыре акцент-токена выводятся из выбранного hex
    ...(prefs.accent === "custom" ? customAccentVars(prefs.customAccent) : {}),
    ...(wideEnoughForSidebar ? {} : { "--w-sidebar": "220px" }),
    ...(prefs.anims ? {} : { "--dur-fast": "1ms", "--dur-base": "1ms", "--dur-slow": "1ms" }),
  } as React.CSSProperties;

  return (
    <div data-accent={accentAttr} data-radius={prefs.radius} style={rootStyle}>
      {prefs.bgCover ? (
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
          playlists={playlists}
          onCreatePlaylist={() => setDialogOpen(true)}
          onOpenPlaylist={() => setView("library")}
        />
        {/* key на main: смена экрана пересоздаёт скролл-контейнер — прокрутка
            прошлого экрана не протекает в новый (короткий экран улетал вверх) */}
        <main key={view} style={{ overflowY: "auto", scrollbarWidth: "none", borderRadius: "var(--r-lg)" }}>
          <div className="muza-view">
            {view === "home" ? (
              <HomeFeed
                greetName={greetName}
                currentId={currentId}
                playing={playing}
                likes={likes}
                onPlayTrack={playTrack}
                onLike={toggleLike}
                onTrackMenu={openTrackMenu}
                onOpen={setView}
              />
            ) : view === "search" ? (
              <SearchView
                api={api}
                canSearch={canSearch}
                currentId={currentId}
                playing={playing}
                likes={likes}
                onPlayTrack={playTrack}
                onLike={toggleLike}
                onTrackMenu={openTrackMenu}
                onNotify={showToast}
              />
            ) : view === "favorites" ? (
              <FavoritesView
                likes={likes}
                currentId={currentId}
                playing={playing}
                onPlayTrack={playTrack}
                onLike={toggleLike}
                onTrackMenu={openTrackMenu}
              />
            ) : view === "library" ? (
              <LibraryView onPlayTrack={playTrack} />
            ) : (
              <SettingsView prefs={prefs} setPrefs={setPrefs} username={username} onLogout={onLogout} intent={settingsIntent} />
            )}
          </div>
        </main>
        {showNowPlaying ? (
          <NowPlayingPanel
            track={track}
            liked={likes.includes(track.id)}
            onLike={() => toggleLike(track.id)}
            activeLine={activeLine}
            onSeekLine={seekLine}
          />
        ) : null}
      </div>

      <QueuePanel
        open={queueOn}
        tracks={TRACKS}
        currentId={currentId}
        playing={playing}
        onPlayTrack={playTrack}
        onClose={() => setQueueOn(false)}
      />

      <PlayerBar
        track={track}
        playing={playing}
        onTogglePlay={() => setPlaying(!playing)}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        pos={pos}
        onSeek={setPos}
        vol={vol}
        onVol={setVol}
        liked={likes.includes(track.id)}
        onLike={() => toggleLike(track.id)}
        shuffle={shuffle}
        onShuffle={() => setShuffle(!shuffle)}
        repeat={repeat}
        onRepeat={cycleRepeat}
        speed={speed}
        onSpeed={cycleSpeed}
        lyricsOn={lyricsOn}
        onLyrics={() => setLyricsOn(!lyricsOn)}
        queueOn={queueOn}
        onQueue={() => setQueueOn(!queueOn)}
        onEqualizer={openEqualizer}
        onMute={toggleMute}
        onExpand={() => setExpanded(true)}
      />

      <Toast
        open={toast.open}
        message={toast.text}
        icon={toast.icon}
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

      <ListeningMode
        open={expanded}
        track={track}
        playing={playing}
        pos={pos}
        activeLine={activeLine}
        onTogglePlay={() => setPlaying(!playing)}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onSeek={setPos}
        onSeekLine={seekLine}
        onClose={() => setExpanded(false)}
      />
    </div>
  );
}
