/** Wrapped «Итоги года» (Stage 7): полноэкранная история по агрегатам.
 * Данные и порядок слайдов остаются прежними; визуальный язык — музыкальный
 * фильм, где обложки пользователя становятся сценографией. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "@muza/ui";
import type { MuzaApi, Wrapped } from "@muza/api-client";
import { hourLabel } from "../lib/hourLabel";
import { wrappedSeason } from "../lib/wrappedSeason";
import type { ShareData } from "../lib/shareCard";
import { useT } from "../i18n";
import "./WrappedOverlay.css";

type SlideKind = "empty" | "intro" | "minutes" | "tracks" | "artists" | "rhythm" | "final";

/** Плавный count-up числа при появлении слайда. */
function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const { lang } = useT();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{shown.toLocaleString(lang)}</>;
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
  const { t, lang } = useT();
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
      .catch((e) => setError(e instanceof Error ? e.message : t("views.wrapped.errors.fetchFailed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      aria-label={t("views.wrapped.ariaLabel", { year: wrapped?.year ?? "" })}
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
          <span>{wrapped?.year ?? t("views.wrapped.brandFallback")}</span>
        </div>

        {slides.length > 1 ? (
          <div
            className="wrapped__progress"
            role="progressbar"
            aria-label={t("views.wrapped.slideProgress", { position, total: slides.length })}
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
          <IconButton icon="x" label={t("views.wrapped.close")} size="sm" variant="surface" onClick={onClose} />
        </div>
      </header>

      <main className="wrapped__content">
        <div key={`${kind}-${slide}`} className={`wrapped__slide wrapped__slide--${kind ?? "loading"}`}>
          {!wrapped && !error ? (
            <section className="wrapped__state" aria-live="polite">
              <span className="wrapped__kicker">{t("views.wrapped.loading.kicker", { year: wrappedSeason().year })}</span>
              <h1>{t("views.wrapped.loading.title")}</h1>
              <div className="wrapped__loading-line" aria-hidden="true"><span /></div>
              <p>{t("views.wrapped.loading.hint")}</p>
            </section>
          ) : error ? (
            <section className="wrapped__state" role="alert">
              <span className="wrapped__kicker">{t("views.wrapped.error.kicker")}</span>
              <h1>{t("views.wrapped.error.title")}</h1>
              <p>{error}</p>
            </section>
          ) : kind === "empty" ? (
            <section className="wrapped__state wrapped__state--empty">
              <span className="wrapped__kicker">{t("views.wrapped.empty.kicker", { year: recap.year })}</span>
              <div className="wrapped__empty-year" aria-hidden="true">{recap.year}</div>
              <h1>{t("views.wrapped.empty.title")}</h1>
              <p>{t("views.wrapped.empty.hint")}</p>
            </section>
          ) : kind === "intro" ? (
            <section className="wrapped__intro">
              <div className="wrapped__intro-copy">
                <span className="wrapped__kicker">{t("views.wrapped.intro.kicker")}</span>
                <h1 className="wrapped__year wrapped__primary">{recap.year}</h1>
                <p className="wrapped__intro-line">{t("views.wrapped.intro.line1")}<br />{t("views.wrapped.intro.line2")}</p>
                <div className="wrapped__first-track">
                  <span>{t("views.wrapped.intro.firstSoundLabel")}</span>
                  {recap.firstTrack ? (
                    <>
                      <strong>{t("views.wrapped.intro.firstTrackTitle", { title: recap.firstTrack.title })}</strong>
                      <em>{recap.firstTrack.artist}</em>
                    </>
                  ) : <strong>{t("views.wrapped.intro.historyStarts")}</strong>}
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
                <span className="wrapped__kicker">{t("views.wrapped.minutes.kicker")}</span>
                <div className="wrapped__metric wrapped__primary">
                  <strong><CountUp value={minutes} /></strong>
                  <span>{t("views.wrapped.minutes.unit")}</span>
                </div>
                <h1>{t("views.wrapped.minutes.headline")}</h1>
                <div className="wrapped__supporting-stats">
                  <div><strong>{recap.totalPlays.toLocaleString(lang)}</strong><span>{t("views.wrapped.minutes.playsLabel")}</span></div>
                  <div><strong>{recap.uniqueTracks.toLocaleString(lang)}</strong><span>{t("views.wrapped.minutes.uniqueTracksLabel")}</span></div>
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
                <span className="wrapped__kicker">{t("views.wrapped.tracks.kicker")}</span>
                <h1 className="wrapped__track-title wrapped__primary">{topTrack.track.title}</h1>
                <p className="wrapped__track-artist">{topTrack.track.artist}</p>
                <p className="wrapped__track-plays">{t("views.wrapped.tracks.playsPrefix")} <b>{topTrack.plays.toLocaleString(lang)}×</b></p>

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
                <span className="wrapped__kicker">{t("views.wrapped.artists.kicker")}</span>
                <span className="wrapped__artist-rank">01</span>
                <h1 className="wrapped__primary">{topArtist.artist}</h1>
                <p><b>{Math.round(topArtist.playedMs / 60_000).toLocaleString(lang)}</b> {t("views.wrapped.artists.minutesSuffix")}</p>
              </div>

              <ol className="wrapped__artist-list">
                {recap.topArtists.slice(1).map((artist, index) => {
                  const share = Math.max(8, Math.round((artist.playedMs / artistMaxMs) * 100));
                  return (
                    <li key={artist.artist}>
                      <span className="wrapped__list-rank">{rank(index + 1)}</span>
                      <span className="wrapped__artist-name">{artist.artist}</span>
                      <span className="wrapped__artist-time">{Math.round(artist.playedMs / 60_000).toLocaleString(lang)} {t("views.wrapped.artists.minAbbrev")}</span>
                      <span className="wrapped__artist-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : kind === "rhythm" ? (
            <section className="wrapped__rhythm">
              <div className="wrapped__rhythm-lead">
                <span className="wrapped__kicker">{t("views.wrapped.rhythm.kicker")}</span>
                {recap.topHour !== null ? (
                  <>
                    <h1 className="wrapped__primary">{String(recap.topHour).padStart(2, "0")}:00</h1>
                    <p>{t("views.wrapped.rhythm.favoriteHour", { label: hourLabel(recap.topHour, lang) })}</p>
                    {/* Ось суток 00→24 с отметкой пикового часа: осмысленный
                        график (не случайная линия) — заливка растёт до пика,
                        точка = любимый час. Данные — recap.topHour. */}
                    <div className="wrapped__dayline">
                      <div className="wrapped__dayline-track" aria-hidden="true">
                        <span className="wrapped__dayline-fill" style={{ width: `${(recap.topHour / 24) * 100}%` }} />
                        <span className="wrapped__dayline-peak" style={{ left: `${(recap.topHour / 24) * 100}%` }} />
                      </div>
                      <div className="wrapped__dayline-scale" aria-hidden="true">
                        <span>00</span>
                        <span>06</span>
                        <span>12</span>
                        <span>18</span>
                        <span>24</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <h1 className="wrapped__primary">{recap.activeDays}</h1>
                    <p>{t("views.wrapped.rhythm.daysWithMusic")}</p>
                  </>
                )}
              </div>

              <div className="wrapped__rhythm-facts">
                {recap.topHour !== null ? (
                  <div><strong>{recap.activeDays}</strong><span>{t("views.wrapped.rhythm.daysWithMusic")}</span></div>
                ) : null}
                <div className="is-accent"><strong>{recap.longestStreakDays} {t("views.wrapped.rhythm.daysSuffix")}</strong><span>{t("views.wrapped.rhythm.longestStreak")}</span></div>
                {recap.peakDay ? (
                  <div>
                    <strong>{new Date(`${recap.peakDay.date}T00:00:00`).toLocaleDateString(lang, { day: "numeric", month: "long" })}</strong>
                    <span>{t("views.wrapped.rhythm.mostMusicalDay")}</span>
                  </div>
                ) : null}
                <div><strong>{recap.favoritesAdded}</strong><span>{t("views.wrapped.rhythm.favoritesThisYear")}</span></div>
              </div>
            </section>
          ) : kind === "final" ? (
            <section className="wrapped__final">
              <div className="wrapped__final-copy">
                <span className="wrapped__kicker">{t("views.wrapped.final.kicker")}</span>
                <h1 className="wrapped__primary">{t("views.wrapped.final.headlinePart1")}<br />{t("views.wrapped.final.headlinePart2")} <b>{recap.year}</b></h1>
                <p>{t("views.wrapped.final.subtext")}</p>

                <div className="wrapped__final-stats">
                  <div><strong>{minutes.toLocaleString(lang)}</strong><span>{t("views.wrapped.final.minutesOfMusic")}</span></div>
                  <div><strong>{recap.uniqueArtists.toLocaleString(lang)}</strong><span>{t("views.wrapped.final.artistsLabel")}</span></div>
                  <div><strong>{recap.uniqueTracks.toLocaleString(lang)}</strong><span>{t("views.wrapped.final.tracksLabel")}</span></div>
                </div>

                {topArtist ? (
                  <div className="wrapped__final-artist"><span>{t("views.wrapped.final.artistOfYear")}</span><strong>{topArtist.artist}</strong></div>
                ) : null}

                <div className="wrapped__share" onClick={(event) => event.stopPropagation()}>
                  <Button variant="primary" size="lg" icon="share-2" onClick={openShare}>
                    {t("views.wrapped.final.shareButton")}
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
        <span>{kind === "final" ? t("views.wrapped.footer.savePoster") : t("views.wrapped.footer.clickHint")}</span>
      </footer>
    </div>
  );
}
