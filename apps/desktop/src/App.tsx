import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Menu, SearchInput, Toast } from "@muza/ui";
import { HttpMuzaApi, type Session } from "@muza/api-client";
import { NEW_PLAYLIST_COVER, PLAYLISTS, TRACKS, type DemoCollection, type DemoTrack } from "./data/demo";
import { DEFAULT_PREFS, type Prefs, type View } from "./types";
import { LoginScreen } from "./auth/LoginScreen";
import { Sidebar } from "./shell/Sidebar";
import { NowPlayingPanel } from "./shell/NowPlayingPanel";
import { PlayerBar } from "./shell/PlayerBar";
import { QueuePanel } from "./shell/QueuePanel";
import { ListeningMode } from "./shell/ListeningMode";
import { HomeFeed } from "./views/HomeFeed";
import { SearchView } from "./views/SearchView";
import { LibraryView } from "./views/LibraryView";
import { SettingsView } from "./views/SettingsView";

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
      username={session.user.anonymous ? "Аноним (без синхронизации)" : (session.user.username ?? "")}
      onLogout={async () => {
        await api.logout();
        setSession(null);
      }}
    />
  );
}

/** Каркас плеера Stage 1: воспроизведение имитируется таймером (реальный движок — Stage 3). */
function Player({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [view, setView] = useState<View>("home");
  const [currentId, setCurrentId] = useState(TRACKS[0].id);
  const [playing, setPlaying] = useState(true);
  const [pos, setPos] = useState(24);
  const [vol, setVol] = useState(64);
  const [likes, setLikes] = useState<string[]>(["t3"]);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
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
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  const track = TRACKS.find((t) => t.id === currentId) ?? TRACKS[0];
  const idx = TRACKS.indexOf(track);

  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      setPos((p) => (p + 1 > track.duration ? 0 : p + 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [playing, track]);

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

  const accentAttr = prefs.accent === "blue" ? undefined : prefs.accent;
  const rootStyle = {
    position: "absolute",
    inset: 0,
    background: "var(--bg-0)",
    overflow: "hidden",
    fontFamily: "var(--font-ui)",
    "--blur-glass": `${prefs.blur}px`,
    "--glass-panel": `rgba(23, 22, 20, ${prefs.glassOpacity / 100})`,
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
          gridTemplateColumns: lyricsOn ? "var(--w-sidebar) 1fr var(--w-nowplaying)" : "var(--w-sidebar) 1fr",
          gap: "var(--gap-zone)",
          padding: "var(--gap-zone)",
          paddingBottom: "calc(var(--h-playerbar) + 2 * var(--gap-zone))",
        }}
      >
        <Sidebar view={view} setView={setView} playlists={playlists} onCreatePlaylist={() => setDialogOpen(true)} />
        <main style={{ overflowY: "auto", scrollbarWidth: "none", borderRadius: "var(--r-lg)" }}>
          <div key={view} className="muza-view">
            {view === "home" ? (
              <HomeFeed currentId={currentId} playing={playing} onPlayTrack={playTrack} onOpen={setView} />
            ) : view === "search" ? (
              <SearchView
                currentId={currentId}
                playing={playing}
                likes={likes}
                onPlayTrack={playTrack}
                onLike={toggleLike}
                onTrackMenu={openTrackMenu}
              />
            ) : view === "library" ? (
              <LibraryView onPlayTrack={playTrack} />
            ) : (
              <SettingsView prefs={prefs} setPrefs={setPrefs} username={username} onLogout={onLogout} />
            )}
          </div>
        </main>
        {lyricsOn ? (
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
        onRepeat={() => setRepeat(!repeat)}
        lyricsOn={lyricsOn}
        onLyrics={() => setLyricsOn(!lyricsOn)}
        queueOn={queueOn}
        onQueue={() => setQueueOn(!queueOn)}
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
