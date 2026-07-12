/** Wrapped «Итоги года» (Stage 7): полноэкранная история по агрегатам.
 * Данные и порядок слайдов остаются прежними; визуальный язык — музыкальный
 * фильм, где обложки пользователя становятся сценографией. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "@muza/ui";
import type { MuzaApi, Wrapped } from "@muza/api-client";
import { hourLabel } from "../lib/hourLabel";
import { wrappedSeason } from "../lib/wrappedSeason";
import type { ShareData } from "../lib/shareCard";
import "./WrappedOverlay.css";

type SlideKind = "empty" | "intro" | "minutes" | "tracks" | "artists" | "rhythm" | "final";

/** Плавный count-up числа при появлении слайда. */
function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{shown.toLocaleString("ru")}</>;
}

function rank(index: number) {
  return String(index + 1).padStart(2, "0");
}

export function WrappedOverlay({
  api,
  open,
  onClose,
  onShare,
}: {
  api: MuzaApi;
  open: boolean;
  onClose: () => void;
  /** Открыть шеринг-карточку с итогами (ShareDialog в App). */
  onShare: (data: ShareData) => void;
}) {
  const [wrapped, setWrapped] = useState<Wrapped | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlide(0);
    setWrapped(null);
    setError(null);
    api
      .getWrapped({ year: wrappedSeason().year })
      .then(setWrapped)
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось получить итоги"));
  }, [api, open]);

  const slides = useMemo<SlideKind[]>(() => {
    if (!wrapped) return [];
    if (wrapped.totalPlays === 0) return ["empty"];
    const list: SlideKind[] = ["intro", "minutes"];
    if (wrapped.topTracks.length > 0) list.push("tracks");
    if (wrapped.topArtists.length > 0) list.push("artists");
    list.push("rhythm", "final");
    return list;
  }, [wrapped]);

  const next = () => setSlide((current) => Math.min(current + 1, slides.length - 1));
  const prev = () => setSlide((current) => Math.max(current - 1, 0));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") onClose();
      else if (event.code === "ArrowRight" || event.code === "Space") {
        event.preventDefault();
        next();
      } else if (event.code === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slides.length]);

  useEffect(() => {
    if (open) rootRef.current?.focus();
  }, [open, wrapped]);

  if (!open) return null;

  const minutes = wrapped ? Math.round(wrapped.totalMs / 60_000) : 0;
  const kind = slides[slide];
  const topTrack = wrapped?.topTracks[0] ?? null;
  const topArtist = wrapped?.topArtists[0] ?? null;
  const heroCover = topTrack?.track.coverUrl ?? wrapped?.firstTrack?.coverUrl ?? null;
  const sceneCover = kind === "intro" ? wrapped?.firstTrack?.coverUrl ?? heroCover : heroCover;
  const covers = wrapped?.topTracks.map((entry) => entry.track).filter((track) => track.coverUrl).slice(0, 3) ?? [];
  const artistMaxMs = Math.max(1, ...(wrapped?.topArtists.map((artist) => artist.playedMs) ?? [1]));
  const position = slides.length > 0 ? slide + 1 : 0;
  // В story-ветках recap существует: loading/error отсекаются первыми двумя
  // условиями ниже. Отдельная ссылка сохраняет эту инварианту для TypeScript.
  const recap = wrapped as Wrapped;

  const openShare = () => {
    if (!wrapped) return;
    onShare({
      kind: "wrapped",
      year: wrapped.year,
      minutes,
      plays: wrapped.totalPlays,
      artists: wrapped.uniqueArtists,
      topArtist: topArtist?.artist ?? null,
      topTrack: topTrack ? `${topTrack.track.title} — ${topTrack.track.artist}` : null,
    });
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Итоги ${wrapped?.year ?? ""}`}
      className="wrapped"
      data-slide={kind ?? "loading"}
      onClick={next}
    >
      <div className="wrapped__backdrop" aria-hidden="true">
        {sceneCover ? <img key={sceneCover} src={sceneCover} alt="" draggable={false} /> : null}
        <span className="wrapped__scrim" />
        <span className="wrapped__ambient wrapped__ambient--a" />
        <span className="wrapped__ambient wrapped__ambient--b" />
      </div>

      <header className="wrapped__chrome">
        <div className="wrapped__brand" aria-hidden="true">
          <b>MUZA</b>
          <span>{wrapped?.year ?? "ИТОГИ"}</span>
        </div>

        {slides.length > 1 ? (
          <div
            className="wrapped__progress"
            role="progressbar"
            aria-label={`Слайд ${position} из ${slides.length}`}
            aria-valuemin={1}
            aria-valuemax={slides.length}
            aria-valuenow={position}
          >
            {slides.map((item, index) => (
              <span
                key={item}
                className={index < slide ? "is-done" : index === slide ? "is-current" : undefined}
              />
            ))}
          </div>
        ) : <span />}

        <div className="wrapped__close" onClick={(event) => event.stopPropagation()}>
          <IconButton icon="x" label="Закрыть итоги" size="sm" variant="surface" onClick={onClose} />
        </div>
      </header>

      <main className="wrapped__content">
        <div key={`${kind}-${slide}`} className={`wrapped__slide wrapped__slide--${kind ?? "loading"}`}>
          {!wrapped && !error ? (
            <section className="wrapped__state" aria-live="polite">
              <span className="wrapped__kicker">Muza · {wrappedSeason().year}</span>
              <h1>Собираем твой год</h1>
              <div className="wrapped__loading-line" aria-hidden="true"><span /></div>
              <p>Вспоминаем треки, минуты и моменты.</p>
            </section>
          ) : error ? (
            <section className="wrapped__state" role="alert">
              <span className="wrapped__kicker">Что-то сбилось с ритма</span>
              <h1>Итоги пока не загрузились</h1>
              <p>{error}</p>
            </section>
          ) : kind === "empty" ? (
            <section className="wrapped__state wrapped__state--empty">
              <span className="wrapped__kicker">Итоги {recap.year}</span>
              <div className="wrapped__empty-year" aria-hidden="true">{recap.year}</div>
              <h1>Этот год ещё ждёт свой первый трек</h1>
              <p>Послушай что-нибудь — и здесь начнёт собираться твоя музыкальная история.</p>
            </section>
          ) : kind === "intro" ? (
            <section className="wrapped__intro">
              <div className="wrapped__intro-copy">
                <span className="wrapped__kicker">Твой год в музыке</span>
                <h1 className="wrapped__year wrapped__primary">{recap.year}</h1>
                <p className="wrapped__intro-line">Это был твой год.<br />Послушай, как он звучал.</p>
                <div className="wrapped__first-track">
                  <span>Первый звук года</span>
                  {recap.firstTrack ? (
                    <>
                      <strong>«{recap.firstTrack.title}»</strong>
                      <em>{recap.firstTrack.artist}</em>
                    </>
                  ) : <strong>Твоя история начинается здесь</strong>}
                </div>
              </div>

              <div className="wrapped__cover-stage wrapped__art" aria-hidden="true">
                <div className="wrapped__record"><span /></div>
                {covers.length > 0 ? covers.map((track, index) => (
                  <img
                    key={track.id}
                    className={`wrapped__stack-cover wrapped__stack-cover--${index + 1}`}
                    src={track.coverUrl!}
                    alt=""
                    draggable={false}
                  />
                )) : <span className="wrapped__cover-fallback">M</span>}
              </div>
            </section>
          ) : kind === "minutes" ? (
            <section className="wrapped__minutes">
              <div className="wrapped__minutes-copy">
                <span className="wrapped__kicker">Время, которое было твоим</span>
                <div className="wrapped__metric wrapped__primary">
                  <strong><CountUp value={minutes} /></strong>
                  <span>минут</span>
                </div>
                <h1>Столько музыки поместилось в твоём году.</h1>
                <div className="wrapped__supporting-stats">
                  <div><strong>{recap.totalPlays.toLocaleString("ru")}</strong><span>прослушиваний</span></div>
                  <div><strong>{recap.uniqueTracks.toLocaleString("ru")}</strong><span>разных треков</span></div>
                </div>
              </div>

              <div className="wrapped__disc-stage wrapped__art" aria-hidden="true">
                <div className="wrapped__disc">
                  {heroCover ? <img src={heroCover} alt="" draggable={false} /> : null}
                  <span className="wrapped__disc-ring wrapped__disc-ring--outer" />
                  <span className="wrapped__disc-ring wrapped__disc-ring--inner" />
                  <span className="wrapped__disc-label">MUZA</span>
                </div>
              </div>
            </section>
          ) : kind === "tracks" && topTrack ? (
            <section className="wrapped__tracks">
              <div className="wrapped__track-poster wrapped__art">
                {topTrack.track.coverUrl ? (
                  <img src={topTrack.track.coverUrl} alt="" draggable={false} />
                ) : <span className="wrapped__cover-fallback">M</span>}
                <span className="wrapped__poster-rank">01</span>
              </div>

              <div className="wrapped__track-story">
                <span className="wrapped__kicker">Трек года</span>
                <h1 className="wrapped__track-title wrapped__primary">{topTrack.track.title}</h1>
                <p className="wrapped__track-artist">{topTrack.track.artist}</p>
                <p className="wrapped__track-plays">Ты возвращался к нему <b>{topTrack.plays.toLocaleString("ru")}×</b></p>

                {recap.topTracks.length > 1 ? (
                  <ol className="wrapped__track-list" onClick={(event) => event.stopPropagation()}>
                    {recap.topTracks.slice(1).map((entry, index) => (
                      <li key={entry.track.id}>
                        <span className="wrapped__list-rank">{rank(index + 1)}</span>
                        {entry.track.coverUrl ? <img src={entry.track.coverUrl} alt="" draggable={false} /> : null}
                        <span className="wrapped__list-title">
                          <strong>{entry.track.title}</strong>
                          <small>{entry.track.artist}</small>
                        </span>
                        <span className="wrapped__list-count">{entry.plays}×</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            </section>
          ) : kind === "artists" && topArtist ? (
            <section className="wrapped__artists">
              <div className="wrapped__artist-headline">
                <span className="wrapped__kicker">В главной роли</span>
                <span className="wrapped__artist-rank">01</span>
                <h1 className="wrapped__primary">{topArtist.artist}</h1>
                <p><b>{Math.round(topArtist.playedMs / 60_000).toLocaleString("ru")}</b> минут рядом с тобой</p>
              </div>

              <ol className="wrapped__artist-list">
                {recap.topArtists.slice(1).map((artist, index) => {
                  const share = Math.max(8, Math.round((artist.playedMs / artistMaxMs) * 100));
                  return (
                    <li key={artist.artist}>
                      <span className="wrapped__list-rank">{rank(index + 1)}</span>
                      <span className="wrapped__artist-name">{artist.artist}</span>
                      <span className="wrapped__artist-time">{Math.round(artist.playedMs / 60_000).toLocaleString("ru")} мин</span>
                      <span className="wrapped__artist-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : kind === "rhythm" ? (
            <section className="wrapped__rhythm">
              <div className="wrapped__rhythm-lead">
                <span className="wrapped__kicker">Когда звучал твой год</span>
                {recap.topHour !== null ? (
                  <>
                    <h1 className="wrapped__primary">{String(recap.topHour).padStart(2, "0")}:00</h1>
                    <p>Твой любимый час · {hourLabel(recap.topHour)}</p>
                  </>
                ) : (
                  <>
                    <h1 className="wrapped__primary">{recap.activeDays}</h1>
                    <p>дней с музыкой</p>
                  </>
                )}
              </div>

              <div className="wrapped__timeline" aria-hidden="true"><span /></div>

              <div className="wrapped__rhythm-facts">
                {recap.topHour !== null ? (
                  <div><strong>{recap.activeDays}</strong><span>дней с музыкой</span></div>
                ) : null}
                <div className="is-accent"><strong>{recap.longestStreakDays} дн.</strong><span>самая длинная серия</span></div>
                {recap.peakDay ? (
                  <div>
                    <strong>{new Date(`${recap.peakDay.date}T00:00:00`).toLocaleDateString("ru", { day: "numeric", month: "long" })}</strong>
                    <span>самый музыкальный день</span>
                  </div>
                ) : null}
                <div><strong>{recap.favoritesAdded}</strong><span>лайков за год</span></div>
              </div>
            </section>
          ) : kind === "final" ? (
            <section className="wrapped__final">
              <div className="wrapped__final-copy">
                <span className="wrapped__kicker">Финальный трек</span>
                <h1 className="wrapped__primary">Это был<br />твой <b>{recap.year}</b></h1>
                <p>Не просто цифры. Музыка, к которой ты возвращался.</p>

                <div className="wrapped__final-stats">
                  <div><strong>{minutes.toLocaleString("ru")}</strong><span>минут музыки</span></div>
                  <div><strong>{recap.uniqueArtists.toLocaleString("ru")}</strong><span>артистов</span></div>
                  <div><strong>{recap.uniqueTracks.toLocaleString("ru")}</strong><span>треков</span></div>
                </div>

                {topArtist ? (
                  <div className="wrapped__final-artist"><span>Артист года</span><strong>{topArtist.artist}</strong></div>
                ) : null}

                <div className="wrapped__share" onClick={(event) => event.stopPropagation()}>
                  <Button variant="primary" size="lg" icon="share-2" onClick={openShare}>
                    Поделиться итогами
                  </Button>
                </div>
              </div>

              <div className="wrapped__final-art wrapped__art" aria-hidden="true">
                <div className="wrapped__final-year">{recap.year}</div>
                {covers.map((track, index) => (
                  <img
                    key={track.id}
                    className={`wrapped__final-cover wrapped__final-cover--${index + 1}`}
                    src={track.coverUrl!}
                    alt=""
                    draggable={false}
                  />
                ))}
                <span className="wrapped__final-seal">MUZA</span>
              </div>
            </section>
          ) : null}
        </div>
      </main>

      <footer className="wrapped__footer" aria-hidden="true">
        <span>{slides.length > 0 ? `${String(position).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}` : "— / —"}</span>
        <span>{kind === "final" ? "Сохрани свой музыкальный постер" : "Клик в любом месте или →"}</span>
      </footer>
    </div>
  );
}
