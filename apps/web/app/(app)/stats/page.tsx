"use client";

import { useEffect, useState } from "react";
import { EmptyState, Spinner, Tabs } from "@muza/ui";
import type { StatsOverview, StatsPeriod } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { TrackList } from "../../../src/components/TrackList";

/** Статистика веба: сводка/активность/ритм/топы/серия по `/me/stats/overview`
 *  (`getStatsOverview` уже шлёт tz_offset_min сам — см. http.ts). Мобильный
 *  первым классом: панели в одну колонку, топ-артисты — своя вёрстка (не
 *  фикс-колонки десктопа, узкие экраны не тянут четыре жёстких ширины).
 *  По мотивам apps/desktop/src/views/StatsView.tsx (после T11), НЕ шарит код —
 *  своя лёгкая реализация. Настраиваемые блоки (prefs.statsBlocks) и «Итоги
 *  года» (wrapped) сознательно не перенесены — беклог веба, не MVP. */

const PERIOD_TABS = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "year", label: "Год" },
  { key: "all", label: "Всё время" },
];

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function bucketLabel(bucket: string): string {
  if (!bucket) return "";
  if (bucket.length === 7) {
    const [y, m] = bucket.split("-").map(Number);
    return `${MONTHS_SHORT[m - 1]} ${y}`;
  }
  return new Date(`${bucket}T00:00:00`).toLocaleDateString("ru", { day: "numeric", month: "long" });
}

function fmtMinutes(ms: number): string {
  return Math.round(ms / 60_000).toLocaleString("ru");
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
function ArtistRow({ rank, artist, ms, share }: { rank: number; artist: string; ms: number; share: number }) {
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
          {fmtMinutes(ms)} мин
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Статистика
        </h1>
        {state.status === "loading" && d ? <Spinner size={16} color="var(--text-3)" /> : null}
      </div>

      <Tabs items={PERIOD_TABS} value={period} onChange={(k: string) => setPeriod(k as StatsPeriod)} />

      {!d ? (
        state.status === "error" ? (
          <p style={noteStyle}>Сервер недоступен — обнови страницу, когда он вернётся.</p>
        ) : (
          <StatsSkeleton />
        )
      ) : d.totalPlays === 0 && d.totalMs === 0 ? (
        <EmptyState
          icon="bar-chart-3"
          title="Пока нечего показать"
          hint="Послушай что-нибудь — минуты, топы и серии появятся здесь после первых прослушиваний."
        />
      ) : (
        <>
          {state.status === "error" ? <p style={noteStyle}>Не удалось обновить — показаны прежние данные.</p> : null}

          <Panel title="Сводка">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-5)", rowGap: "var(--sp-4)" }}>
              <BigStat value={fmtMinutes(d.totalMs)} label="минут с музыкой" accent />
              <BigStat value={d.totalPlays.toLocaleString("ru")} label="прослушиваний" />
              <BigStat value={d.uniqueTracks.toLocaleString("ru")} label="треков" />
              <BigStat value={d.uniqueArtists.toLocaleString("ru")} label="артистов" />
            </div>
          </Panel>

          <Panel title="Активность">
            <Bars
              values={d.series.map((s) => s.plays)}
              titles={d.series.map((s) => `${bucketLabel(s.bucket)}: ${s.plays} · ${fmtMinutes(s.ms)} мин`)}
              height={110}
              ariaLabel={`Прослушивания по ${daily ? "дням" : "месяцам"}`}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              <span>{bucketLabel(d.series[0]?.bucket ?? "")}</span>
              <span>{bucketLabel(d.series[d.series.length - 1]?.bucket ?? "")}</span>
            </div>
          </Panel>

          <Panel title="Ритм дня">
            <Bars values={d.hours} titles={d.hours.map((v, h) => `${h}:00 — ${v}`)} height={64} ariaLabel="Прослушивания по часам суток" />
            <div style={{ marginTop: 6, fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
              {d.topHour !== null ? `Любимый час — ${d.topHour}:00` : "Пока без любимого часа"}
            </div>
          </Panel>

          {d.topTracks.length > 0 ? (
            <Panel title="Топ-треки" flush>
              <TrackList tracks={d.topTracks.map((t) => t.track)} />
            </Panel>
          ) : null}

          {d.topArtists.length > 0 ? (
            <Panel title="Топ-артисты">
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                {d.topArtists.map((a, i) => (
                  <ArtistRow key={a.artist} rank={i + 1} artist={a.artist} ms={a.playedMs} share={a.playedMs / maxArtistMs} />
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel title="Серия">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-5)", rowGap: "var(--sp-4)" }}>
              <BigStat value={`${d.currentStreakDays} дн.`} label="текущая серия" accent={d.currentStreakDays > 0} />
              <BigStat value={`${d.longestStreakDays} дн.`} label="рекордная серия" />
              <BigStat value={String(d.activeDays)} label="дней с музыкой за период" />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
