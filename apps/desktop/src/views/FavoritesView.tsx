import { Icon, TrackRow } from "@muza/ui";
import { TRACKS, type DemoTrack } from "../data/demo";
import { fmtTime } from "../lib/format";

/** «Любимое» — стандартная вкладка с лайкнутыми треками (не демо-плейлист).
 *  Пока лайки локальные (демо-каталог); в Stage 2 слайс 4 сюда придут
 *  favorites с сервера. */
export function FavoritesView({
  likes,
  currentId,
  playing,
  onPlayTrack,
  onLike,
  onTrackMenu,
}: {
  likes: string[];
  currentId: string;
  playing: boolean;
  onPlayTrack: (id: string) => void;
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
}) {
  const liked = TRACKS.filter((t) => likes.includes(t.id));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <Icon name="heart" size={26} color="var(--accent-text)" filled />
        <h1 style={{ margin: 0, fontSize: "var(--fs-h1)", fontWeight: 700, color: "var(--text-1)" }}>Любимое</h1>
        <span style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", alignSelf: "flex-end", paddingBottom: 4 }}>
          {liked.length > 0 ? `${liked.length} тр.` : ""}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
        {liked.map((t, i) => (
          <TrackRow
            key={t.id}
            index={i + 1}
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
        {liked.length === 0 ? (
          <div style={{ padding: "var(--sp-7) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
            Пока пусто. Жми сердечко у трека — он появится здесь.
          </div>
        ) : null}
      </div>
    </div>
  );
}
