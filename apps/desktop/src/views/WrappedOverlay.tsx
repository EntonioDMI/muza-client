/** Wrapped «Итоги года» — редизайн 2026-07-16: «афиша года».
 *
 *  Визуальный язык: обложки пользователя как сценография (кроссфейд задника
 *  между слайдами), дисплейные цифры Unbounded, у каждого слайда своя сцена —
 *  кадр-обложка (intro), вращающийся винил (minutes), постер топ-трека
 *  (tracks), фестивальный line-up (artists), циферблат суток (rhythm),
 *  постер-коллаж (final). Перелистывание направленное: уходящий слайд
 *  рендерится второй копией с классом is-leaving-* (щадящий вариант для
 *  prefers-reduced-motion — мгновенная смена, фаза ухода пропускается в JS).
 *
 *  Эмбиент: пока оверлей открыт, топ-трек года тихо играет отдельным каналом
 *  (player/wrappedAmbient — НЕ через usePlayback, чтобы не трогать очередь);
 *  регулятор громкости спрятан за иконкой в правом верхнем углу. Оверлей
 *  владеет только жизненным циклом канала: старт после прихода данных
 *  (totalPlays > 0 и есть топ-трек), стоп на закрытии/размонтировании. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton, Slider } from "@muza/ui";
import type { MuzaApi, Wrapped } from "@muza/api-client";
import { hourLabel } from "../lib/hourLabel";
import { wrappedSeason } from "../lib/wrappedSeason";
import { useCoverArt } from "../lib/coverArt";
import type { ShareData } from "../lib/shareCard";
import { WrappedAmbient } from "../player/wrappedAmbient";
import { useT, type Lang } from "../i18n";
import "./WrappedOverlay.css";

type SlideKind = "empty" | "intro" | "minutes" | "tracks" | "artists" | "rhythm" | "final";

/** Длительность фазы ухода слайда; согласована с wrappedLeave* в CSS. */
const SLIDE_LEAVE_MS = 260;

/** Проводка эмбиента из App: резолв URL тем же путём, что у плеера
 *  (getTrackSources → политика источников → resolvePlayable, общий кэш),
 *  пауза/возврат основного плеера, громкость из prefs. */
export interface WrappedOverlayAmbient {
  resolveTrackUrl: (trackId: string) => Promise<string>;
  playerPlaying: boolean;
  pausePlayer: () => void;
  resumePlayer: () => void;
  /** Позиция слайдера 0–100 (prefs.wrappedAmbientVol). */
  volume: number;
  onVolumeChange: (v: number) => void;
}

/** Обложка с вырезанными вшитыми полями источника — тот же canvas-кроп, что у
 *  плеера (lib/coverArt, кэш общий на сессию). Recap отдаёт СЫРЫЕ coverUrl,
 *  мимо чищеного track.cover плеера, поэтому без кропа постер топ-трека и
 *  мини-обложки чарта снова показывали серые/чёрные рамки (жалоба 2026-07-16).
 *  Пока кроп не готов, рисуется исходник — данные приходят раньше, чем юзер
 *  долистывает до обложек, так что подмена глазу не видна. */
function CleanCover({ src, className }: { src: string; className?: string }) {
  const clean = useCoverArt(src);
  return clean ? <img className={className} src={clean} alt="" draggable={false} /> : null;
}

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


/** Циферблат суток: 24 деления по кругу, акцентная дуга и точка любимого
 *  часа. SVG-штрихи — графика данных (та же роль, что точка на старой оси
 *  00→24), не декоративные обводки. При topHour=null дуга — доля дней с
 *  музыкой в году. */
function RhythmDial({
  topHour,
  activeDays,
  lang,
}: {
  topHour: number | null;
  activeDays: number;
  lang: Lang;
}) {
  const C = 2 * Math.PI * 88;
  const share = topHour !== null ? topHour / 24 : Math.min(1, activeDays / 365);
  const arc = Math.max(0.02, share) * C;
  const angle = share * 360 - 90;
  const dotX = 110 + 88 * Math.cos((angle * Math.PI) / 180);
  const dotY = 110 + 88 * Math.sin((angle * Math.PI) / 180);
  return (
    <div className="wrapped__dial wrapped__art" aria-hidden="true">
      <svg viewBox="0 0 220 220">
        {Array.from({ length: 24 }, (_, i) => {
          const a = ((i / 24) * 360 - 90) * (Math.PI / 180);
          const major = i % 6 === 0;
          const r1 = major ? 97 : 100;
          return (
            <line
              key={i}
              x1={110 + r1 * Math.cos(a)}
              y1={110 + r1 * Math.sin(a)}
              x2={110 + 105 * Math.cos(a)}
              y2={110 + 105 * Math.sin(a)}
              stroke={major ? "var(--text-3)" : "var(--surface-4)"}
              strokeWidth={major ? 2 : 1.5}
              strokeLinecap="round"
            />
          );
        })}
        <circle cx="110" cy="110" r="88" fill="none" stroke="var(--surface-3)" strokeWidth="3" />
        <circle
          className="wrapped__dial-arc"
          cx="110"
          cy="110"
          r="88"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${C}`}
          transform="rotate(-90 110 110)"
          style={{ "--arc": String(arc) } as React.CSSProperties}
        />
        <circle className="wrapped__dial-dot" cx={dotX} cy={dotY} r="7" fill="var(--accent)" />
      </svg>
      <div className="wrapped__dial-center">
        {topHour !== null ? (
          <>
            <b>{String(topHour).padStart(2, "0")}:00</b>
            <span>{hourLabel(topHour, lang)}</span>
          </>
        ) : (
          <>
            <b>{Math.round((activeDays / 365) * 100)}%</b>
            <span>{new Date().getFullYear()}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function WrappedOverlay({
  api,
  open,
  onClose,
  onShare,
  ambient,
}: {
  api: MuzaApi;
  open: boolean;
  onClose: () => void;
  /** Открыть шеринг-карточку с итогами (ShareDialog в App). */
  onShare: (data: ShareData) => void;
  ambient: WrappedOverlayAmbient;
}) {
  const { t, lang } = useT();
  const [wrapped, setWrapped] = useState<Wrapped | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  /** Уходящая копия слайда (направленное перелистывание). */
  const [leaving, setLeaving] = useState<{ kind: SlideKind; dir: 1 | -1 } | null>(null);
  /** Направление последнего перехода — класс входа новой копии. */
  const [dir, setDir] = useState<1 | -1 | null>(null);
  const [soundOpen, setSoundOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leaveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlide(0);
    setDir(null);
    setLeaving(null);
    setSoundOpen(false);
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

  // ── Эмбиент: канал живёт, пока открыт оверлей и есть что играть ──
  const topTrack = wrapped?.topTracks[0] ?? null;
  const ambientTrackId = wrapped && wrapped.totalPlays > 0 ? (topTrack?.track.id ?? null) : null;
  const ambientRef = useRef(ambient);
  ambientRef.current = ambient;
  const ambientTrackRef = useRef<string | null>(null);
  ambientTrackRef.current = ambientTrackId;
  const engineRef = useRef<WrappedAmbient | null>(null);

  useEffect(() => {
    if (!open || !ambientTrackId) return;
    const engine = (engineRef.current ??= new WrappedAmbient({
      resolve: () => {
        const id = ambientTrackRef.current;
        if (!id) return Promise.reject(new Error("wrapped ambient: нет топ-трека"));
        return ambientRef.current.resolveTrackUrl(id);
      },
      pausePlayer: () => ambientRef.current.pausePlayer(),
      resumePlayer: () => ambientRef.current.resumePlayer(),
      isPlayerPlaying: () => ambientRef.current.playerPlaying,
    }));
    engine.start(ambientRef.current.volume);
    return () => engine.stop();
  }, [open, ambientTrackId]);

  const handleVolume = (v: number) => {
    const vol = Math.round(v);
    engineRef.current?.setVolume(vol);
    ambientRef.current.onVolumeChange(vol);
  };

  // ── Направленное перелистывание ──
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const soundOpenRef = useRef(soundOpen);
  soundOpenRef.current = soundOpen;

  const navigate = (target: number) => {
    const current = slideRef.current;
    const list = slidesRef.current;
    const next = Math.max(0, Math.min(target, list.length - 1));
    if (next === current || list.length === 0) return;
    const d: 1 | -1 = next > current ? 1 : -1;
    // Фаза ухода — только при живых анимациях: под reduced-motion смена
    // мгновенная (глобальный 1ms-фолбэк ДС всё равно схлопнул бы её в кадр).
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setLeaving({ kind: list[current], dir: d });
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
      leaveTimer.current = window.setTimeout(() => setLeaving(null), SLIDE_LEAVE_MS);
    }
    setDir(d);
    setSlide(next);
  };
  const next = () => navigate(slideRef.current + 1);
  const prev = () => navigate(slideRef.current - 1);

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // Клавиши из регулятора громкости не листают историю: слайдер ДС сам
      // ходит стрелками по ARIA-контракту и зовёт stopPropagation, но наш
      // window-слушатель capture получает событие РАНЬШЕ него (живой репро
      // 16.07: 10×ArrowRight в слайдере умчали историю на финал). Esc из
      // слайдера при этом закрыть поповер обязан.
      if (event.target instanceof HTMLElement && event.target.closest(".wrapped__sound")) {
        if (event.code === "Escape") setSoundOpen(false);
        return;
      }
      if (event.code === "Escape") {
        // Первый Esc закрывает поповер громкости, второй — оверлей
        if (soundOpenRef.current) setSoundOpen(false);
        else onClose();
      } else if (event.code === "ArrowRight" || event.code === "Space") {
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

  // ── Кроссфейд задника: прошлая обложка гаснет под новой ──
  const topArtist = wrapped?.topArtists[0] ?? null;
  const heroCover = topTrack?.track.coverUrl ?? wrapped?.firstTrack?.coverUrl ?? null;
  const kind = slides[slide];
  const sceneCover = kind === "intro" ? (wrapped?.firstTrack?.coverUrl ?? heroCover) : heroCover;
  const [scene, setScene] = useState<{ cur: string | null; prev: string | null }>({
    cur: null,
    prev: null,
  });
  useEffect(() => {
    setScene((s) => (s.cur === sceneCover ? s : { cur: sceneCover ?? null, prev: s.cur }));
  }, [sceneCover]);

  if (!open) return null;

  const minutes = wrapped ? Math.round(wrapped.totalMs / 60_000) : 0;
  const covers =
    wrapped?.topTracks.map((entry) => entry.track).filter((track) => track.coverUrl).slice(0, 3) ?? [];
  const position = slides.length > 0 ? slide + 1 : 0;
  // В story-ветках recap существует: loading/error отсекаются первыми двумя
  // условиями renderSlide. Отдельная ссылка сохраняет инварианту для TypeScript.
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

  /** Разметка одного слайда; зовётся и для текущего, и для уходящей копии. */
  const renderSlide = (which: SlideKind | undefined) => {
    if (!wrapped && !error) {
      return (
        <section className="wrapped__state" aria-live="polite">
          <span className="wrapped__kicker">{t("views.wrapped.loading.kicker", { year: wrappedSeason().year })}</span>
          <h1>{t("views.wrapped.loading.title")}</h1>
          <div className="wrapped__loading-line" aria-hidden="true"><span /></div>
          <p>{t("views.wrapped.loading.hint")}</p>
        </section>
      );
    }
    if (error) {
      return (
        <section className="wrapped__state" role="alert">
          <span className="wrapped__kicker">{t("views.wrapped.error.kicker")}</span>
          <h1>{t("views.wrapped.error.title")}</h1>
          <p>{error}</p>
        </section>
      );
    }
    if (which === "empty") {
      return (
        <section className="wrapped__state wrapped__state--empty">
          <div className="wrapped__empty-year" aria-hidden="true">{recap.year}</div>
          <span className="wrapped__kicker">{t("views.wrapped.empty.kicker", { year: recap.year })}</span>
          <h1>{t("views.wrapped.empty.title")}</h1>
          <p>{t("views.wrapped.empty.hint")}</p>
        </section>
      );
    }
    if (which === "intro") {
      const frameCover = recap.firstTrack?.coverUrl ?? heroCover;
      return (
        <section className="wrapped__intro">
          <div className="wrapped__intro-copy">
            <span className="wrapped__kicker">{t("views.wrapped.intro.kicker")}</span>
            <h1 className="wrapped__year">{recap.year}</h1>
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
          <div className="wrapped__intro-art wrapped__art" aria-hidden="true">
            <span className="wrapped__frame-back" />
            <div className="wrapped__frame">
              {frameCover ? (
                <CleanCover src={frameCover} />
              ) : (
                <span className="wrapped__cover-fallback">M</span>
              )}
            </div>
          </div>
        </section>
      );
    }
    if (which === "minutes") {
      return (
        <section className="wrapped__minutes">
          <div className="wrapped__minutes-copy">
            <span className="wrapped__kicker">{t("views.wrapped.minutes.kicker")}</span>
            <div className="wrapped__metric">
              <strong><CountUp value={minutes} /></strong>
              <span>{t("views.wrapped.minutes.unit")}</span>
            </div>
            <h1>{t("views.wrapped.minutes.headline")}</h1>
            <p className="wrapped__meta-line">
              <b>{recap.totalPlays.toLocaleString(lang)}</b> {t("views.wrapped.minutes.playsLabel")}
              <i aria-hidden="true">·</i>
              <b>{recap.uniqueTracks.toLocaleString(lang)}</b> {t("views.wrapped.minutes.uniqueTracksLabel")}
            </p>
          </div>
          <div className="wrapped__vinyl wrapped__art" aria-hidden="true">
            {/* ⚠ Гоча приёмки: CDP-скриншоты (Page.captureScreenshot) рисуют
                ВРАЩАЮЩИЙСЯ растр без круглого клипа — «обложка квадратом
                поверх диска» — независимо от видимости окна; экран при этом
                корректен (проверено PrintWindow, 16.07; перебор span-фона,
                SVG clipPath и canvas даёт тот же артефакт в скриншоте).
                Не чинить разметку по CDP-скринам — сверяться PrintWindow. */}
            <div className="wrapped__vinyl-disc">
              <span className="wrapped__vinyl-spin">
                {heroCover ? <CleanCover className="wrapped__vinyl-art" src={heroCover} /> : null}
              </span>
              <span className="wrapped__vinyl-shade" />
              <span className="wrapped__vinyl-center" />
              <span className="wrapped__vinyl-label">MUZA</span>
            </div>
          </div>
        </section>
      );
    }
    if (which === "tracks" && topTrack) {
      return (
        <section className="wrapped__tracks">
          <div className="wrapped__poster wrapped__art">
            <span className="wrapped__poster-rank" aria-hidden="true">01</span>
            <div className="wrapped__poster-cover">
              {topTrack.track.coverUrl ? (
                <CleanCover src={topTrack.track.coverUrl} />
              ) : <span className="wrapped__cover-fallback">M</span>}
            </div>
          </div>
          <div className="wrapped__track-story">
            <span className="wrapped__kicker">{t("views.wrapped.tracks.kicker")}</span>
            <h1 className="wrapped__track-title">{topTrack.track.title}</h1>
            <p className="wrapped__track-artist">{topTrack.track.artist}</p>
            <p className="wrapped__track-plays">
              {t("views.wrapped.tracks.playsPrefix")} <b>{topTrack.plays.toLocaleString(lang)}×</b>
            </p>
            {recap.topTracks.length > 1 ? (
              <ol className="wrapped__chart" onClick={(event) => event.stopPropagation()}>
                {recap.topTracks.slice(1).map((entry, index) => (
                  <li key={entry.track.id}>
                    <span className="wrapped__chart-rank">{rank(index + 1)}</span>
                    {entry.track.coverUrl ? <CleanCover src={entry.track.coverUrl} /> : null}
                    <span className="wrapped__chart-title">
                      <strong>{entry.track.title}</strong>
                      <small>{entry.track.artist}</small>
                    </span>
                    <span className="wrapped__chart-count">{entry.plays}×</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </section>
      );
    }
    if (which === "artists" && topArtist) {
      return (
        <section className="wrapped__artists">
          <div className="wrapped__artists-head">
            <span className="wrapped__kicker">{t("views.wrapped.artists.kicker")}</span>
            <h1 className="wrapped__headliner">{topArtist.artist}</h1>
            <p className="wrapped__headliner-sub">
              <b>{Math.round(topArtist.playedMs / 60_000).toLocaleString(lang)}</b> {t("views.wrapped.artists.minutesSuffix")}
            </p>
          </div>
          {recap.topArtists.length > 1 ? (
            <ol className="wrapped__lineup">
              {recap.topArtists.slice(1).map((artist, index) => (
                <li key={artist.artist}>
                  <span className="wrapped__lineup-rank" aria-hidden="true">{rank(index + 1)}</span>
                  <span className="wrapped__lineup-name">{artist.artist}</span>
                  <span className="wrapped__lineup-min">
                    {Math.round(artist.playedMs / 60_000).toLocaleString(lang)} {t("views.wrapped.artists.minAbbrev")}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      );
    }
    if (which === "rhythm") {
      return (
        <section className="wrapped__rhythm">
          <div className="wrapped__rhythm-lead">
            <span className="wrapped__kicker">{t("views.wrapped.rhythm.kicker")}</span>
            {recap.topHour !== null ? (
              <>
                <h1>{String(recap.topHour).padStart(2, "0")}:00</h1>
                <p>{t("views.wrapped.rhythm.favoriteHour", { label: hourLabel(recap.topHour, lang) })}</p>
              </>
            ) : (
              <>
                <h1>{recap.activeDays}</h1>
                <p>{t("views.wrapped.rhythm.daysWithMusic")}</p>
              </>
            )}
            <dl className="wrapped__rhythm-facts">
              {recap.topHour !== null ? (
                <div>
                  <dt>{t("views.wrapped.rhythm.daysWithMusic")}</dt>
                  <dd>{recap.activeDays}</dd>
                </div>
              ) : null}
              <div className="is-accent">
                <dt>{t("views.wrapped.rhythm.longestStreak")}</dt>
                <dd>{recap.longestStreakDays} {t("views.wrapped.rhythm.daysSuffix")}</dd>
              </div>
              {recap.peakDay ? (
                <div>
                  <dt>{t("views.wrapped.rhythm.mostMusicalDay")}</dt>
                  <dd>{new Date(`${recap.peakDay.date}T00:00:00`).toLocaleDateString(lang, { day: "numeric", month: "long" })}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t("views.wrapped.rhythm.favoritesThisYear")}</dt>
                <dd>{recap.favoritesAdded}</dd>
              </div>
            </dl>
          </div>
          <RhythmDial topHour={recap.topHour} activeDays={recap.activeDays} lang={lang} />
        </section>
      );
    }
    if (which === "final") {
      return (
        <section className="wrapped__final">
          <div className="wrapped__final-copy">
            <span className="wrapped__kicker">{t("views.wrapped.final.kicker")}</span>
            <h1>
              {t("views.wrapped.final.headlinePart1")}<br />
              {t("views.wrapped.final.headlinePart2")} <b>{recap.year}</b>
            </h1>
            <p>{t("views.wrapped.final.subtext")}</p>
            <p className="wrapped__meta-line">
              <b>{minutes.toLocaleString(lang)}</b> {t("views.wrapped.final.minutesOfMusic")}
              <i aria-hidden="true">·</i>
              <b>{recap.uniqueArtists.toLocaleString(lang)}</b> {t("views.wrapped.final.artistsLabel")}
              <i aria-hidden="true">·</i>
              <b>{recap.uniqueTracks.toLocaleString(lang)}</b> {t("views.wrapped.final.tracksLabel")}
            </p>
            {topArtist ? (
              <div className="wrapped__final-artist">
                <span>{t("views.wrapped.final.artistOfYear")}</span>
                <strong>{topArtist.artist}</strong>
              </div>
            ) : null}
            <div className="wrapped__share" onClick={(event) => event.stopPropagation()}>
              <Button variant="primary" size="lg" icon="share-2" onClick={openShare}>
                {t("views.wrapped.final.shareButton")}
              </Button>
            </div>
          </div>
          <div className="wrapped__final-art wrapped__art" aria-hidden="true">
            <div className="wrapped__final-yearbg">{recap.year}</div>
            {covers.map((track, index) => (
              <CleanCover
                key={track.id}
                className={`wrapped__final-cover wrapped__final-cover--${index + 1}`}
                src={track.coverUrl!}
              />
            ))}
            <span className="wrapped__seal">MUZA</span>
          </div>
        </section>
      );
    }
    return null;
  };

  const showSound = ambientTrackId !== null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t("views.wrapped.ariaLabel", { year: wrapped?.year ?? "" })}
      className="wrapped"
      data-slide={kind ?? "loading"}
      onClick={() => {
        // Открытый поповер громкости: первый клик по сцене лишь закрывает его
        if (soundOpenRef.current) {
          setSoundOpen(false);
          return;
        }
        next();
      }}
    >
      <div className="wrapped__backdrop" aria-hidden="true">
        {/* Сценография тоже через CleanCover: блюр размывает, но серые рамки
            источника «грязнили» края кадра тёмными полосами */}
        {scene.prev ? (
          <CleanCover key={`prev-${scene.prev}`} className="wrapped__scenery is-past" src={scene.prev} />
        ) : null}
        {scene.cur ? (
          <CleanCover key={scene.cur} className="wrapped__scenery" src={scene.cur} />
        ) : null}
        <span className="wrapped__scrim" />
        <span className="wrapped__glow wrapped__glow--a" />
        <span className="wrapped__glow wrapped__glow--b" />
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
            onClick={(event) => event.stopPropagation()}
          >
            {slides.map((item, index) => (
              <span
                key={item}
                className={index < slide ? "is-done" : index === slide ? "is-current" : undefined}
                onClick={() => navigate(index)}
              />
            ))}
          </div>
        ) : <span />}

        <div className="wrapped__controls" onClick={(event) => event.stopPropagation()}>
          {showSound ? (
            <div className="wrapped__sound">
              <IconButton
                icon={ambient.volume <= 0 ? "volume-x" : "volume-2"}
                label={t("views.wrapped.ambient.toggleLabel")}
                size="sm"
                variant="surface"
                onClick={() => setSoundOpen((o) => !o)}
              />
              {soundOpen ? (
                <div className="wrapped__sound-pop" role="group" aria-label={t("views.wrapped.ambient.popoverTitle")}>
                  <span className="wrapped__sound-title">{t("views.wrapped.ambient.popoverTitle")}</span>
                  <div className="wrapped__sound-row">
                    <Slider
                      value={ambient.volume}
                      max={100}
                      onChange={handleVolume}
                      ariaLabel={t("views.wrapped.ambient.sliderLabel")}
                      valueText={`${Math.round(ambient.volume)}%`}
                    />
                    <span className="wrapped__sound-val">{Math.round(ambient.volume)}%</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <IconButton icon="x" label={t("views.wrapped.close")} size="sm" variant="surface" onClick={onClose} />
        </div>
      </header>

      <main className="wrapped__content">
        {leaving ? (
          <div
            key={`leave-${leaving.kind}-${slide}`}
            className={`wrapped__slide wrapped__slide--${leaving.kind} is-leaving ${leaving.dir === 1 ? "is-leaving-next" : "is-leaving-prev"}`}
            aria-hidden="true"
          >
            {renderSlide(leaving.kind)}
          </div>
        ) : null}
        <div
          key={`${kind}-${slide}`}
          className={`wrapped__slide wrapped__slide--${kind ?? "loading"}${dir === 1 ? " is-entering-next" : dir === -1 ? " is-entering-prev" : ""}`}
        >
          {renderSlide(kind)}
        </div>
      </main>

      <footer className="wrapped__footer" aria-hidden="true">
        <span>{slides.length > 0 ? `${String(position).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}` : "— / —"}</span>
        {/* Хинт «клик листает» уместен, только когда листать есть что:
            на empty/error/загрузке он обещал бы пустое действие */}
        <span>
          {slides.length > 1
            ? kind === "final"
              ? t("views.wrapped.footer.savePoster")
              : t("views.wrapped.footer.clickHint")
            : ""}
        </span>
      </footer>
    </div>
  );
}
