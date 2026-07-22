"use client";

import { useEffect, useState } from "react";
import { EmptyState, Spinner, Tabs } from "@muza/ui";
import type { StatsOverview, StatsPeriod } from "@muza/api-client";
import { useT, type Lang } from "@muza/app";
import { getApi } from "../../../src/api";
import { TrackList } from "../../../src/components/TrackList";

/** Статистика веба: сводка/активность/ритм/топы/серия по `/me/stats/overview`
 *  (`getStatsOverview` уже шлёт tz_offset_min сам — см. http.ts). Мобильный
 *  первым классом: панели в одну колонку, топ-артисты — своя вёрстка (не
 *  фикс-колонки десктопа, узкие экраны не тянут четыре жёстких ширины).
 *  По мотивам apps/desktop/src/views/StatsView.tsx (после T11), НЕ шарит код —
 *  своя лёгкая реализация. Настраиваемые блоки (prefs.statsBlocks) и «Итоги
 *  года» (wrapped) сознательно не перенесены — беклог веба, не MVP. */

/** Ключи периода — те же week/month/year/all, что prefs.statsBlocks десктопа;
 *  подписи реюзают settings.stats.period.* (И5-веб, 22.07). */
const PERIOD_KEYS: { key: StatsPeriod; labelKey: "week" | "month" | "year" | "allTime" }[] = [
  { key: "week", labelKey: "week" },
  { key: "month", labelKey: "month" },
  { key: "year", labelKey: "year" },
  { key: "all", labelKey: "allTime" },
];

const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_SHORT_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function bucketLabel(bucket: string, lang: Lang): string {
  if (!bucket) return "";
  if (bucket.length === 7) {
    const [y, m] = bucket.split("-").map(Number);
    return `${(lang === "ru" ? MONTHS_SHORT_RU : MONTHS_SHORT_EN)[m - 1]} ${y}`;
  }
  return new Date(`${bucket}T00:00:00`).toLocaleDateString(lang, { day: "numeric", month: "long" });
}

function fmtMinutes(ms: number, lang: Lang): string {
  return Math.round(ms / 60_000).toLocaleString(lang);
}

const panelHead: React.CSSProperties = {
  margin: "0 0 var(--sp-4)",
  fontSize: "var(--fs-title)",
  fontWeight: 700,
  color: "var(--text-1)",
};

function Panel({ title, flush, children }: { title: string; flush?: boolean; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--surface-1)",
        borderRadius: "var(--r-md)",
        padding: flush ? "var(--sp-5) var(--sp-3) var(--sp-3)" : "var(--sp-5)",
      }}
    >
      <h2 style={{ ...panelHead, marginLeft: flush ? "var(--sp-2)" : 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function BigStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 104 }}>
      <div
        style={{
          fontSize: 32,
          fontWeight: 800,
          lineHeight: 1.1,
          color: accent ? "var(--accent-text)" : "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

/** Бар-график на div'ах — без чарт-библиотек (как на десктопе). */
function Bars({ values, titles, height, ariaLabel }: { values: number[]; titles: string[]; height: number; ariaLabel: string }) {
  const max = Math.max(...values, 1);
  return (
    <div role="img" aria-label={ariaLabel} style={{ display: "flex", alignItems: "flex-end", gap: 3, height, width: "100%" }}>
      {values.map((v, i) => (
        <div
          key={i}
          title={titles[i]}
          style={{
            flex: 1,
            minWidth: 2,
            height: v > 0 ? `${Math.max((v / max) * 100, 4)}%` : 2,
            borderRadius: 3,
            background: v > 0 ? "var(--accent)" : "var(--surface-3)",
            transition: "height var(--dur-base) var(--ease-out)",
          }}
        />
      ))}
    </div>
  );
}

/** Топ-артисты: ранг + имя + минуты в одной строке, бар — отдельной строкой
 *  под ней. Fixed-колонки десктопа (24/180/84px) не тянут 320px вьюпорт —
 *  здесь всё гибко (flex + ellipsis), ширина экрана не ломает вёрстку. */
function ArtistRow({
  rank,
  artist,
  ms,
  share,
  lang,
  minSuffix,
}: {
  rank: number;
  artist: string;
  ms: number;
  share: number;
  lang: Lang;
  minSuffix: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <span style={{ width: 20, flex: "none", textAlign: "right", color: "var(--text-3)", fontVariantNumeric: "tabular-nums", fontSize: "var(--fs-caption)" }}>
          {rank}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--text-1)",
            fontSize: "var(--fs-body)",
            fontWeight: rank === 1 ? 600 : 400,
          }}
        >
          {artist}
        </span>
        <span style={{ flex: "none", fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
          {fmtMinutes(ms, lang)} {minSuffix}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", marginLeft: 28, overflow: "hidden" }}>
        <div style={{ width: `${share * 100}%`, height: "100%", borderRadius: 3, background: "var(--accent)", transition: "width var(--dur-base) var(--ease-out)" }} />
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      {[0, 1, 2].map((s) => (
        <div key={s} style={{ background: "var(--surface-1)", borderRadius: "var(--r-md)", padding: "var(--sp-5)" }}>
          <div className="ph" style={{ height: 16, width: 140, marginBottom: "var(--sp-4)" }} />
          <div className="ph" style={{ height: s === 1 ? 120 : 64 }} />
        </div>
      ))}
    </div>
  );
}

const noteStyle: React.CSSProperties = { margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-3)" };

export default function StatsPage() {
  const { t, lang } = useT();
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const [state, setState] = useState<{ status: "loading" | "live" | "error"; data: StatsOverview | null }>({
    status: "loading",
    data: null,
  });

  const load = () => {
    setState((prev) => ({ status: "loading", data: prev.data }));
    getApi()
      .getStatsOverview(period)
      .then((data) => setState({ status: "live", data }))
      .catch(() => setState((prev) => ({ status: "error", data: prev.data })));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [period]);

  const d = state.data;
  const daily = d ? d.series.length > 0 && d.series[0].bucket.length === 10 : false;
  const maxArtistMs = d ? Math.max(...d.topArtists.map((a) => a.playedMs), 1) : 1;

  const periodTabs = PERIOD_KEYS.map((p) => ({ key: p.key, label: t(`settings.stats.period.${p.labelKey}`) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          {t("views.stats.title")}
        </h1>
        {state.status === "loading" && d ? <Spinner size={16} color="var(--text-3)" /> : null}
      </div>

      <Tabs items={periodTabs} value={period} onChange={(k: string) => setPeriod(k as StatsPeriod)} />

      {!d ? (
        state.status === "error" ? (
          <p style={noteStyle}>{t("web.stats.serverDown")}</p>
        ) : (
          <StatsSkeleton />
        )
      ) : d.totalPlays === 0 && d.totalMs === 0 ? (
        <EmptyState icon="bar-chart-3" title={t("web.stats.emptyTitle")} hint={t("web.stats.emptyHint")} />
      ) : (
        <>
          {state.status === "error" ? <p style={noteStyle}>{t("views.stats.notice.updateFailedText")}</p> : null}

          <Panel title={t("media.statsBlocks.summary.label")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-5)", rowGap: "var(--sp-4)" }}>
              <BigStat value={fmtMinutes(d.totalMs, lang)} label={t("views.stats.summary.minutesLabel")} accent />
              <BigStat value={d.totalPlays.toLocaleString(lang)} label={t("views.stats.summary.playsLabel")} />
              <BigStat value={d.uniqueTracks.toLocaleString(lang)} label={t("views.stats.summary.tracksLabel")} />
              <BigStat value={d.uniqueArtists.toLocaleString(lang)} label={t("views.stats.summary.artistsLabel")} />
            </div>
          </Panel>

          <Panel title={t("media.statsBlocks.activity.label")}>
            <Bars
              values={d.series.map((s) => s.plays)}
              titles={d.series.map(
                (s) => `${bucketLabel(s.bucket, lang)}: ${s.plays} · ${fmtMinutes(s.ms, lang)} ${t("views.stats.topArtists.minSuffix")}`,
              )}
              height={110}
              ariaLabel={daily ? t("views.stats.activity.ariaByDay") : t("views.stats.activity.ariaByMonth")}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              <span>{bucketLabel(d.series[0]?.bucket ?? "", lang)}</span>
              <span>{bucketLabel(d.series[d.series.length - 1]?.bucket ?? "", lang)}</span>
            </div>
          </Panel>

          <Panel title={t("media.statsBlocks.rhythm.label")}>
            <Bars values={d.hours} titles={d.hours.map((v, h) => `${h}:00 — ${v}`)} height={64} ariaLabel={t("views.stats.rhythm.aria")} />
            <div style={{ marginTop: 6, fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
              {d.topHour !== null ? t("web.stats.topHour", { hour: d.topHour }) : t("web.stats.noTopHour")}
            </div>
          </Panel>

          {d.topTracks.length > 0 ? (
            <Panel title={t("media.statsBlocks.top_tracks.label")} flush>
              <TrackList tracks={d.topTracks.map((tt) => tt.track)} />
            </Panel>
          ) : null}

          {d.topArtists.length > 0 ? (
            <Panel title={t("media.statsBlocks.top_artists.label")}>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                {d.topArtists.map((a, i) => (
                  <ArtistRow
                    key={a.artist}
                    rank={i + 1}
                    artist={a.artist}
                    ms={a.playedMs}
                    share={a.playedMs / maxArtistMs}
                    lang={lang}
                    minSuffix={t("views.stats.topArtists.minSuffix")}
                  />
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel title={t("media.statsBlocks.streaks.label")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-5)", rowGap: "var(--sp-4)" }}>
              <BigStat
                value={`${d.currentStreakDays} ${t("views.stats.streaks.daysSuffix")}`}
                label={t("views.stats.streaks.current")}
                accent={d.currentStreakDays > 0}
              />
              <BigStat value={`${d.longestStreakDays} ${t("views.stats.streaks.daysSuffix")}`} label={t("views.stats.streaks.longest")} />
              <BigStat value={String(d.activeDays)} label={t("views.stats.streaks.activeDays")} />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
