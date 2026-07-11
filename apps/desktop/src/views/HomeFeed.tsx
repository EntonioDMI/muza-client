import { useEffect, useState } from "react";
import { ChipGroup, Shelf, Tile, TrackRow } from "@muza/ui";
import type { HomeSection, MuzaApi, Track } from "@muza/api-client";
import { PLAYLISTS, RELEASES, TRACKS, type DemoTrack } from "../data/demo";
import { withSnapshot } from "../lib/offlineSnapshot";
import { fmtTime } from "../lib/format";
import type { View } from "../types";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

/** Плейсхолдер обложки: у части каталожных треков cover_url нет, а Tile
 *  требует картинку (нейтральный градиент в токенах бренда). */
const COVER_FALLBACK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a33"/><stop offset="1" stop-color="#17171c"/></linearGradient></defs><rect width="176" height="176" fill="url(#g)"/></svg>`,
  );

const sectionH2: React.CSSProperties = {
  margin: "0 0 var(--sp-3)",
  fontSize: "var(--fs-title)",
  fontWeight: 700,
  color: "var(--text-1)",
};

/** Главная (Stage 5): при серверной сессии — живая лента рекомендаций
 *  (/home: «Для тебя», «Потому что вы любите X», «В тренде», «Новое»),
 *  «Для тебя» — списком с действиями, остальные — карусели. Аноним или
 *  пустая лента (совсем свежий аккаунт без каталога) — демо-полки Stage 1. */
export function HomeFeed({
  api,
  canSearch,
  greetName,
  currentId,
  playing,
  likes,
  onPlayTrack,
  onPlayCatalog,
  onLike,
  onTrackMenu,
  onCatalogMenu,
  onOpen,
}: {
  api: MuzaApi;
  /** false у анонима: сервер его не знает, лента недоступна. */
  canSearch: boolean;
  /** Ник для приветствия; null у анонима — просто «Доброе утро». */
  greetName: string | null;
  currentId: string;
  playing: boolean;
  likes: string[];
  onPlayTrack: (id: string) => void;
  /** Играть каталожный трек в контексте секции (очередь = секция). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
  /** «⋯» на каталожном треке (плейлист/версии/оффлайн/радио). */
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  onOpen: (v: View) => void;
}) {
  const [chip, setChip] = useState("Всё");
  // null — ещё грузим; [] — ленты нет (аноним/сбой/пусто) → демо
  const [sections, setSections] = useState<HomeSection[] | null>(canSearch ? null : []);

  useEffect(() => {
    if (!canSearch) {
      setSections([]);
      return;
    }
    let alive = true;
    withSnapshot("home", () => api.getHome())
      .then(({ data }) => {
        if (alive) setSections(data);
      })
      .catch(() => {
        if (alive) setSections([]); // сервер лёг и снапшота нет — демо-полки
      });
    return () => {
      alive = false;
    };
  }, [api, canSearch]);

  const live = sections !== null && sections.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "var(--fs-greet)",
          letterSpacing: "var(--ls-display)",
          color: "var(--text-1)",
          lineHeight: "var(--lh-tight)",
        }}
      >
        {greetName ? `${greeting()}, ${greetName}!` : greeting()}
      </h1>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <ChipGroup items={["Всё", "Музыка", "Плейлисты", "С текстом"]} value={chip} onChange={setChip} />
      </div>

      {live ? (
        <>
          {sections.map((s) =>
            s.key === "for_you" ? (
              // «Для тебя» — главный контент: список с лайками и меню
              <div key={s.key}>
                <h2 style={sectionH2}>{s.title}</h2>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {s.tracks.map((t, i) => (
                    <TrackRow
                      key={t.id}
                      index={i + 1}
                      cover={t.coverUrl ?? undefined}
                      title={t.title}
                      artist={t.artist}
                      duration={fmtTime(t.durationSec)}
                      active={currentId === t.id}
                      playing={currentId === t.id && playing}
                      liked={likes.includes(t.id)}
                      onPlay={() => onPlayCatalog(s.tracks, t.id)}
                      onLike={() => onLike(t.id)}
                      onMore={(e: React.MouseEvent) => onCatalogMenu(t, e)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              // остальные секции — карусели
              <Shelf key={s.key} title={s.title}>
                {s.tracks.map((t) => (
                  <Tile
                    key={t.id}
                    cover={t.coverUrl ?? COVER_FALLBACK}
                    title={t.title}
                    subtitle={t.artist}
                    playing={currentId === t.id && playing}
                    onPlay={() => onPlayCatalog(s.tracks, t.id)}
                    onClick={() => onPlayCatalog(s.tracks, t.id)}
                  />
                ))}
              </Shelf>
            ),
          )}
          <div style={{ paddingBottom: "var(--sp-6)" }} />
        </>
      ) : sections === null ? (
        // грузим ленту — тихая пауза вместо демо-мигания
        <div style={{ minHeight: 240 }} />
      ) : (
        <>
          <Shelf title="Продолжить слушать">
            {TRACKS.map((t) => (
              <Tile
                key={t.id}
                cover={t.cover}
                title={t.title}
                subtitle={t.artist}
                playing={currentId === t.id && playing}
                onPlay={() => onPlayTrack(t.id)}
                onClick={() => onPlayTrack(t.id)}
              />
            ))}
          </Shelf>
          <Shelf title="Собрано для тебя" onAction={() => onOpen("library")}>
            {PLAYLISTS.map((p) => (
              <Tile key={p.id} cover={p.cover} title={p.name} subtitle={p.meta} onPlay={() => onPlayTrack(TRACKS[0].id)} />
            ))}
          </Shelf>
          <Shelf title="Новые релизы" onAction={() => onOpen("library")}>
            {RELEASES.map((r) => (
              <Tile key={r.id} cover={r.cover} title={r.name} subtitle={r.meta} onPlay={() => onPlayTrack(TRACKS[1].id)} />
            ))}
          </Shelf>
          {/* Простой список под полками — «как библиотека», без тяжёлых плиток */}
          <div style={{ paddingBottom: "var(--sp-6)" }}>
            <h2 style={sectionH2}>Подборка</h2>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {TRACKS.map((t, i) => (
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
                  liked={likes.includes(t.id)}
                  onPlay={() => onPlayTrack(t.id)}
                  onLike={() => onLike(t.id)}
                  onMore={(e: React.MouseEvent) => onTrackMenu(t, e)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
