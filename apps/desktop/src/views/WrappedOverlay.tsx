/** Wrapped «Итоги года» (Stage 7): полноэкранные story-слайды по агрегатам
 *  сервера (/me/wrapped). Клик/стрелки — навигация, Escape — выход,
 *  финальный слайд — шеринг-карточка. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, IconButton } from "@muza/ui";
import type { MuzaApi, Wrapped } from "@muza/api-client";
import type { ShareData } from "../lib/shareCard";

/** Плавный count-up числа при появлении слайда. */
function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // easeOutCubic: цифры «прилетают» и мягко тормозят
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{shown.toLocaleString("ru")}</>;
}

const HOURS_LABEL: Record<number, string> = { 0: "полуночник", 5: "ранняя пташка", 11: "дневной ритм", 17: "вечерний слушатель", 22: "полуночник" };

function hourLabel(hour: number): string {
  const keys = Object.keys(HOURS_LABEL)
    .map(Number)
    .sort((a, b) => a - b);
  let label = HOURS_LABEL[0];
  for (const k of keys) if (hour >= k) label = HOURS_LABEL[k];
  return label;
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
      .getWrapped()
      .then(setWrapped)
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось получить итоги"));
  }, [api, open]);

  // Слайды строятся по данным: пустые пропускаются
  const slides = useMemo(() => {
    if (!wrapped) return [];
    if (wrapped.totalPlays === 0) return ["empty" as const];
    const list: ("intro" | "minutes" | "tracks" | "artists" | "rhythm" | "final")[] = ["intro", "minutes"];
    if (wrapped.topTracks.length > 0) list.push("tracks");
    if (wrapped.topArtists.length > 0) list.push("artists");
    list.push("rhythm", "final");
    return list;
  }, [wrapped]);

  const next = () => setSlide((s) => Math.min(s + 1, slides.length - 1));
  const prev = () => setSlide((s) => Math.max(s - 1, 0));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") onClose();
      else if (e.code === "ArrowRight" || e.code === "Space") {
        e.preventDefault();
        next();
      } else if (e.code === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slides.length]);

  // фокус в оверлей: стрелки работают сразу
  useEffect(() => {
    if (open) rootRef.current?.focus();
  }, [open, wrapped]);

  if (!open) return null;

  const minutes = wrapped ? Math.round(wrapped.totalMs / 60_000) : 0;
  const kind = slides[slide];
  const caps: React.CSSProperties = {
    fontSize: "var(--fs-caption)",
    fontWeight: 600,
    letterSpacing: "var(--ls-caps)",
    textTransform: "uppercase",
    color: "rgba(244,243,241,0.55)",
  };
  const bigNumber: React.CSSProperties = {
    fontSize: 132,
    fontWeight: 800,
    lineHeight: 1,
    color: "var(--accent)",
    fontVariantNumeric: "tabular-nums",
  };
  const h2: React.CSSProperties = { margin: 0, fontSize: 40, fontWeight: 700, color: "var(--text-1)" };

  const statRow = (icon: string, label: string, value: string) => (
    <div key={label} style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
      <span
        aria-hidden="true"
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--r-sm)",
          background: "var(--accent-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon name={icon} size={20} color="var(--accent-text)" />
      </span>
      <span style={{ flex: 1, textAlign: "left", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 700, color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-label={`Итоги ${wrapped?.year ?? ""}`}
      onClick={next}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 80,
        background:
          "radial-gradient(80% 60% at 85% 10%, color-mix(in srgb, var(--accent) 28%, transparent), transparent), radial-gradient(70% 55% at 10% 95%, color-mix(in srgb, var(--accent) 18%, transparent), transparent), var(--bg-0)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        outline: "none",
        cursor: slides.length > 1 ? "pointer" : "default",
      }}
    >
      <div style={{ position: "absolute", top: "var(--sp-5)", right: "var(--sp-5)" }} onClick={(e) => e.stopPropagation()}>
        <IconButton icon="x" label="Закрыть итоги" onClick={onClose} />
      </div>

      {/* прогресс-точки */}
      {slides.length > 1 ? (
        <div style={{ position: "absolute", top: "var(--sp-6)", display: "flex", gap: 8 }} aria-hidden="true">
          {slides.map((s, i) => (
            <span
              key={s}
              style={{
                width: i === slide ? 26 : 8,
                height: 8,
                borderRadius: 4,
                background: i === slide ? "var(--accent)" : "rgba(244,243,241,0.25)",
                transition: "width var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out)",
              }}
            />
          ))}
        </div>
      ) : null}

      <div
        key={slide}
        className="muza-view"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-5)", maxWidth: 640, padding: "0 var(--sp-6)", textAlign: "center" }}
      >
        {!wrapped && !error ? (
          <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>Считаем твой год…</div>
        ) : error ? (
          <div style={{ color: "var(--danger)", fontSize: "var(--fs-body)" }}>{error}</div>
        ) : kind === "empty" ? (
          <>
            <span style={caps}>Итоги {wrapped!.year}</span>
            <h2 style={h2}>Пока нечего показывать</h2>
            <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
              В этом году ещё не было прослушиваний с аккаунта. Послушай что-нибудь — и возвращайся!
            </div>
          </>
        ) : kind === "intro" ? (
          <>
            <span style={caps}>Muza · твой год в музыке</span>
            <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
              {wrapped!.year}
            </div>
            <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
              {wrapped!.firstTrack
                ? `Год начался с «${wrapped!.firstTrack.title}» — ${wrapped!.firstTrack.artist}`
                : "Посмотрим, как он звучал"}
            </div>
            <span style={{ ...caps, marginTop: "var(--sp-4)" }}>клик или → — дальше</span>
          </>
        ) : kind === "minutes" ? (
          <>
            <span style={caps}>Времени с музыкой</span>
            <div style={bigNumber}>
              <CountUp value={minutes} />
            </div>
            <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
              минут · {wrapped!.totalPlays.toLocaleString("ru")} прослушиваний · {wrapped!.uniqueTracks.toLocaleString("ru")} треков
            </div>
          </>
        ) : kind === "tracks" ? (
          <>
            <span style={caps}>Треки года</span>
            {wrapped!.topTracks[0]?.track.coverUrl ? (
              <img
                src={wrapped!.topTracks[0].track.coverUrl!}
                alt=""
                style={{ width: 200, height: 200, borderRadius: "var(--r-lg)", objectFit: "cover", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
              />
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", width: "100%", maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
              {wrapped!.topTracks.map((t, i) => (
                <div key={t.track.id} style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-3)" }}>
                  <span style={{ width: 28, textAlign: "right", color: i === 0 ? "var(--accent-text)" : "var(--text-3)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, textAlign: "left", color: "var(--text-1)", fontWeight: i === 0 ? 700 : 500, fontSize: i === 0 ? 22 : 17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.track.title} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· {t.track.artist}</span>
                  </span>
                  <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", fontVariantNumeric: "tabular-nums" }}>{t.plays}×</span>
                </div>
              ))}
            </div>
          </>
        ) : kind === "artists" ? (
          <>
            <span style={caps}>Артисты года</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", width: "100%", maxWidth: 460 }}>
              {wrapped!.topArtists.map((a, i) => (
                <div key={a.artist} style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-3)" }}>
                  <span style={{ width: 28, textAlign: "right", color: i === 0 ? "var(--accent-text)" : "var(--text-3)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, textAlign: "left", color: "var(--text-1)", fontWeight: i === 0 ? 800 : 500, fontSize: i === 0 ? 30 : 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.artist}
                  </span>
                  <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(a.playedMs / 60_000).toLocaleString("ru")} мин
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : kind === "rhythm" ? (
          <>
            <span style={caps}>Твой ритм</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", width: "100%", maxWidth: 440 }}>
              {statRow("calendar-days", "Дней с музыкой", String(wrapped!.activeDays))}
              {statRow("flame", "Самая длинная серия подряд", `${wrapped!.longestStreakDays} дн.`)}
              {wrapped!.peakDay
                ? statRow(
                    "trophy",
                    "Самый музыкальный день",
                    new Date(`${wrapped!.peakDay.date}T00:00:00`).toLocaleDateString("ru", { day: "numeric", month: "long" }),
                  )
                : null}
              {wrapped!.topHour !== null
                ? statRow("clock", `Любимый час (${hourLabel(wrapped!.topHour)})`, `${wrapped!.topHour}:00`)
                : null}
              {statRow("heart", "Лайков за год", String(wrapped!.favoritesAdded))}
            </div>
          </>
        ) : (
          <>
            <span style={caps}>Итоги {wrapped!.year}</span>
            <div style={bigNumber}>{minutes.toLocaleString("ru")}</div>
            <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
              минут музыки · {wrapped!.uniqueArtists} артистов
              {wrapped!.topArtists[0] ? (
                <>
                  <br />
                  Артист года — <b style={{ color: "var(--text-1)" }}>{wrapped!.topArtists[0].artist}</b>
                </>
              ) : null}
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <Button
                variant="primary"
                icon="share-2"
                onClick={() =>
                  onShare({
                    kind: "wrapped",
                    year: wrapped!.year,
                    minutes,
                    plays: wrapped!.totalPlays,
                    artists: wrapped!.uniqueArtists,
                    topArtist: wrapped!.topArtists[0]?.artist ?? null,
                    topTrack: wrapped!.topTracks[0] ? `${wrapped!.topTracks[0].track.title} — ${wrapped!.topTracks[0].track.artist}` : null,
                  })
                }
              >
                Поделиться карточкой
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
