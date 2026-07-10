import { useEffect, useState } from "react";
import { Icon, TrackRow } from "@muza/ui";
import type { MuzaApi, Track } from "@muza/api-client";
import { TRACKS, type DemoTrack } from "../data/demo";
import { fmtTime } from "../lib/format";

/** «Любимое»: при серверной сессии — настоящее избранное с сервера
 *  (слайс 4, переживает переустановку); демо-лайки показываются отдельной
 *  группой ниже, у анонима — только они. */
export function FavoritesView({
  api,
  canSearch,
  likes,
  currentId,
  playing,
  onPlayTrack,
  onLike,
  onTrackMenu,
  onNotify,
}: {
  api: MuzaApi;
  canSearch: boolean;
  likes: string[];
  currentId: string;
  playing: boolean;
  onPlayTrack: (id: string) => void;
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  const [server, setServer] = useState<Track[] | null>(null);

  useEffect(() => {
    if (!canSearch) return;
    api
      .getFavorites()
      .then(setServer)
      .catch(() => setServer([]));
    // likes меняются лайками в интерфейсе — перечитываем список
  }, [api, canSearch, likes]);

  const demoLiked = TRACKS.filter((t) => likes.includes(t.id));
  const total = (server?.length ?? 0) + demoLiked.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <Icon name="heart" size={26} color="var(--accent-text)" filled />
        <h1 style={{ margin: 0, fontSize: "var(--fs-h1)", fontWeight: 700, color: "var(--text-1)" }}>Любимое</h1>
        <span style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", alignSelf: "flex-end", paddingBottom: 4 }}>
          {total > 0 ? `${total} тр.` : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
        {(server ?? []).map((t, i) => (
          <TrackRow
            key={t.id}
            index={i + 1}
            cover={t.coverUrl ?? undefined}
            title={t.title}
            artist={t.artist}
            duration={fmtTime(t.durationSec)}
            active={currentId === t.id}
            playing={currentId === t.id && playing}
            liked
            onPlay={() => onNotify("Воспроизведение — в Stage 3 (движок)", "hourglass")}
            onLike={() => onLike(t.id)}
          />
        ))}

        {demoLiked.length > 0 ? (
          <>
            {canSearch ? (
              <h3
                style={{
                  margin: "var(--sp-5) 0 var(--sp-2)",
                  fontSize: "var(--fs-caption)",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                }}
              >
                Из демо-каталога (локальные)
              </h3>
            ) : null}
            {demoLiked.map((t, i) => (
              <TrackRow
                key={t.id}
                index={(server?.length ?? 0) + i + 1}
                cover={t.cover}
                title={t.title}
                artist={t.artist}
                duration={fmtTime(t.duration)}
                explicit={t.explicit}
                active={currentId === t.id}
                playing={currentId === t.id && playing}
                liked
                onPlay={() => onPlayTrack(t.id)}
                onLike={() => onLike(t.id)}
                onMore={(e: React.MouseEvent) => onTrackMenu(t, e)}
              />
            ))}
          </>
        ) : null}

        {total === 0 && server !== null ? (
          <div style={{ padding: "var(--sp-7) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
            Пока пусто. Жми сердечко у трека — он появится здесь.
          </div>
        ) : null}
        {!canSearch && total === 0 ? (
          <div style={{ padding: "var(--sp-7) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
            Пока пусто. Жми сердечко у трека — он появится здесь.
          </div>
        ) : null}
      </div>
    </div>
  );
}
