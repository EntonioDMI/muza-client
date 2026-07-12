"use client";

import { useEffect, useState } from "react";
import { Tile } from "@muza/ui";
import type { HomeSection, Track } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { usePlayer } from "../../../src/player";
import { useSession } from "../../../src/session";
import { TrackList } from "../../../src/components/TrackList";

/** Главная веба: живые секции `/home` (рекомендации Stage 5). Первая секция —
 *  список (быстрый play), остальные — карусели обложек, как полки десктопа. */

function Shelf({ section }: { section: HomeSection }) {
  const { current, playing, playContext } = usePlayer();
  const withCovers = section.tracks.filter((t) => t.coverUrl && !t.localHash);
  if (withCovers.length < 3) return <TrackList tracks={section.tracks.slice(0, 8)} />;
  return (
    <div className="shelf">
      {withCovers.slice(0, 16).map((t: Track, i: number) => (
        <Tile
          key={t.id}
          cover={t.coverUrl!}
          title={t.title}
          subtitle={t.artist}
          width="auto"
          playing={current?.id === t.id && playing}
          onPlay={() => playContext(withCovers, i)}
          onClick={() => playContext(withCovers, i)}
        />
      ))}
    </div>
  );
}

export default function HomePage() {
  const { session } = useSession();
  const [sections, setSections] = useState<HomeSection[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!session) return;
    getApi()
      .getHome()
      .then(setSections)
      .catch(() => setFailed(true));
  }, [session]);

  const greeting = (() => {
    const h = new Date().getHours();
    const word = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
    const name = session?.user.username;
    return name ? `${word}, ${name}!` : `${word}!`;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <h1 className="page-title">{greeting}</h1>
      {failed ? (
        <p style={noteStyle}>Сервер недоступен — обнови страницу, когда он вернётся.</p>
      ) : sections === null ? (
        // спокойные плейсхолдеры (ДС запрещает мерцание)
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }} aria-hidden="true">
          <div className="ph" style={{ height: 20, width: 140 }} />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ph" style={{ height: 56 }} />
          ))}
          <div className="ph" style={{ height: 20, width: 180, marginTop: "var(--sp-3)" }} />
          <div className="ph" style={{ height: 180 }} />
        </div>
      ) : sections.length === 0 ? (
        <p style={noteStyle}>Послушай что-нибудь — лента соберётся из твоих прослушиваний.</p>
      ) : (
        sections.map((s, idx) => (
          <section key={s.key}>
            <h2 className="section-title">{s.title}</h2>
            {idx === 0 ? <TrackList tracks={s.tracks.slice(0, 8)} /> : <Shelf section={s} />}
          </section>
        ))
      )}
    </div>
  );
}

const noteStyle: React.CSSProperties = { margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-2)" };
