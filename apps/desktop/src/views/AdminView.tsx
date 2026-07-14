import { useEffect, useState } from "react";
import { Icon, Tabs } from "@muza/ui";
import type { AdminContent, AdminHealth, AdminOverview, AdminUsers, MuzaApi } from "@muza/api-client";
import { useT } from "../i18n";
import type { Lang } from "../i18n";

/** Админ-панель (Stage 5) — экраны из заметки «аналитика-и-админка»:
 *  Обзор / Контент / Здоровье добычи / Пользователи. Виден только админам
 *  (пункт сайдбара появляется после удачного adminPing). Все данные —
 *  агрегаты; в «Пользователях» PII-минимум (email не приходит вовсе). */

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
/** T31 i18n: дата/время форматируются под текущий `lang`, не захардкожены
 *  на "ru" (та же схема, что в SettingsView/StatsView). */
const dt = (iso: string | null, lang: Lang) =>
  iso === null ? "—" : new Date(iso).toLocaleString(lang, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div
      style={{
        flex: "1 1 150px",
        minWidth: 150,
        padding: "var(--sp-4)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 700, color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      {hint ? <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{hint}</span> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      <h2 style={{ margin: 0, fontSize: "var(--fs-strong)", fontWeight: 700, color: "var(--text-1)" }}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ cells, header }: { cells: (string | number)[]; header?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `2fr repeat(${cells.length - 1}, 1fr)`,
        gap: "var(--sp-3)",
        padding: "var(--sp-2) var(--sp-3)",
        borderRadius: "var(--r-sm)",
        background: header ? "transparent" : "var(--surface-2)",
        fontSize: header ? "var(--fs-caption)" : "var(--fs-body)",
        color: header ? "var(--text-3)" : "var(--text-2)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {cells.map((c, i) => (
        <span
          key={i}
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: i === 0 && !header ? "var(--text-1)" : undefined,
          }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/** Загрузка вкладки: единый паттерн «грузим → данные|ошибка». */
function useAdminData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null } {
  const { t } = useT();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    load()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : t("views.admin.loadFailed"));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

function Loading({ error }: { error: string | null }) {
  const { t } = useT();
  return (
    <div style={{ padding: "var(--sp-6) 0", color: error ? "var(--danger)" : "var(--text-3)", fontSize: "var(--fs-body)" }}>
      {error ?? t("common.loading")}
    </div>
  );
}

function OverviewTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const { data, error } = useAdminData<AdminOverview>(() => api.getAdminOverview(), [api]);
  if (!data) return <Loading error={error} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <Section title={t("views.admin.sections.listeners")}>
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label="DAU" value={data.listeners.dau} hint={t("views.admin.stats.dauHint")} />
          <StatCard label="WAU" value={data.listeners.wau} hint={t("views.admin.stats.wauHint")} />
          <StatCard label="MAU" value={data.listeners.mau} hint={t("views.admin.stats.mauHint")} />
        </div>
      </Section>
      <Section title={t("views.admin.sections.plays")}>
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label={t("views.admin.stats.today")} value={data.plays.today} />
          <StatCard label={t("views.admin.stats.thisWeek")} value={data.plays.week} hint={t("views.admin.stats.completedSuffix", { count: data.plays.completedWeek })} />
          <StatCard label={t("views.admin.stats.total")} value={data.plays.total} />
        </div>
      </Section>
      <Section title={t("views.admin.sections.users")}>
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label={t("views.admin.stats.total")} value={data.users.total} hint={t("views.admin.stats.withEmailSuffix", { count: data.users.withEmail })} />
          <StatCard label={t("views.admin.stats.newThisWeek")} value={data.users.new7d} />
          <StatCard label={t("views.admin.stats.admins")} value={data.users.admins} />
        </div>
      </Section>
      <Section title={t("views.admin.sections.catalog")}>
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label={t("views.admin.stats.tracks")} value={data.catalog.tracks} />
          <StatCard label={t("views.admin.stats.sourcesLabel")} value={data.catalog.sources} hint={t("views.admin.stats.deadSuffix", { count: data.catalog.deadSources })} />
          <StatCard label={t("views.admin.stats.inServerCache")} value={data.catalog.cached} />
        </div>
      </Section>
    </div>
  );
}

function ContentTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const { data, error } = useAdminData<AdminContent>(() => api.getAdminContent(), [api]);
  if (!data) return <Loading error={error} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <Section title={t("views.admin.sections.catalogCoverage")}>
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label={t("views.admin.stats.tracks")} value={data.coverage.tracks} />
          <StatCard label={t("views.admin.stats.withLyrics")} value={data.coverage.withLyrics} hint={t("views.admin.stats.syncedSuffix", { count: data.coverage.withSynced })} />
          <StatCard label={t("views.admin.stats.withAnnotations")} value={data.coverage.withAnnotations} />
        </div>
      </Section>
      <Section title={t("views.admin.sections.sources")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Row header cells={[t("views.admin.rows.providerKind"), t("views.admin.rows.total"), t("views.admin.rows.dead")]} />
          {data.sourcesByProvider.map((s) => (
            <Row key={`${s.provider}:${s.kind}`} cells={[`${s.provider} · ${s.kind}`, s.count, s.dead]} />
          ))}
        </div>
      </Section>
      <Section title={t("views.admin.sections.topTracks")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Row header cells={[t("views.admin.rows.track"), t("views.admin.rows.plays")]} />
          {data.topTracks.map((r) => (
            <Row key={r.track.id} cells={[`${r.track.artist} — ${r.track.title}`, r.plays]} />
          ))}
        </div>
      </Section>
      <Section title={t("views.admin.sections.topArtists")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Row header cells={[t("views.admin.rows.artist"), t("views.admin.rows.plays")]} />
          {data.topArtists.map((r) => (
            <Row key={r.artist} cells={[r.artist, r.plays]} />
          ))}
        </div>
      </Section>
      <Section title={t("views.admin.sections.newInCatalog")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.recentTracks.map((tr) => (
            <Row key={tr.id} cells={[`${tr.artist} — ${tr.title}`, tr.sources.join(", ") || t("views.admin.rows.noSources")]} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function HealthTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [hours, setHours] = useState(24);
  const { data, error } = useAdminData<AdminHealth>(() => api.getAdminHealth(hours), [api, hours]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <div style={{ maxWidth: 360 }}>
        <Tabs
          items={[
            { key: "24", label: t("views.admin.health.day") },
            { key: "168", label: t("views.admin.health.week") },
            { key: "720", label: t("views.admin.health.month30") },
          ]}
          value={String(hours)}
          onChange={(k: string) => setHours(Number(k))}
        />
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <Section title={t("views.admin.sections.extraction")}>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <StatCard label="Success-rate" value={pct(data.totals.successRate)} hint={`${data.totals.resolveOk} ok / ${data.totals.resolveFail} fail`} />
              <StatCard label={t("views.admin.health.cacheHits")} value={pct(data.totals.cacheHitRate)} hint={t("views.admin.health.hitsSuffix", { count: data.totals.cacheHits })} />
              <StatCard label={t("views.admin.health.reports")} value={data.totals.reports} hint={t("views.admin.health.attemptsSuffix", { count: data.totals.attempts })} />
            </div>
          </Section>
          <Section title={t("views.admin.sections.errorsByClass")}>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <StatCard label="403" value={data.totals.fail403} />
              <StatCard label="Bot-check" value={data.totals.failBot} />
              <StatCard label={t("views.admin.health.formatsLabel")} value={data.totals.failFormat} />
              <StatCard label={t("views.admin.health.other")} value={data.totals.failOther} />
            </div>
          </Section>
          <Section title={t("views.admin.sections.byRecipeVersion")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Row header cells={[t("views.admin.health.recipeCol"), t("views.admin.health.reports"), "OK", "Fail", "Success"]} />
              {data.byRecipe.map((r) => (
                <Row
                  key={r.recipeVersion}
                  cells={[
                    `v${r.recipeVersion}${r.recipeVersion === data.recipeVersion ? t("views.admin.health.currentSuffix") : ""}`,
                    r.reports,
                    r.ok,
                    r.fail,
                    pct(r.successRate),
                  ]}
                />
              ))}
            </div>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              {t("views.admin.health.recipeNote", { version: data.recipeVersion })}
            </div>
          </Section>
          <Section title={t("views.admin.sections.byAppVersion")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Row header cells={[t("views.admin.health.versionCol"), t("views.admin.health.reports"), "OK", "Fail"]} />
              {data.byApp.map((r) => (
                <Row key={r.appVersion} cells={[r.appVersion, r.reports, r.ok, r.fail]} />
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function UsersTab({ api }: { api: MuzaApi }) {
  const { t, lang } = useT();
  const { data, error } = useAdminData<AdminUsers>(() => api.getAdminUsers({ limit: 100 }), [api]);
  if (!data) return <Loading error={error} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
        {t("views.admin.users.piiNote", { count: data.total })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Row header cells={[t("views.admin.users.userCol"), t("views.admin.users.createdCol"), t("views.admin.users.plays30dCol"), t("views.admin.users.lastCol")]} />
        {data.users.map((u) => (
          <Row
            key={u.id}
            cells={[
              `${u.username}${u.isAdmin ? t("views.admin.users.adminSuffix") : ""}${u.hasEmail ? " · ✉" : ""}`,
              dt(u.createdAt, lang),
              u.plays30d,
              dt(u.lastPlayAt, lang),
            ]}
          />
        ))}
      </div>
    </div>
  );
}

export function AdminView({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [tab, setTab] = useState("overview");
  const tabs = [
    { key: "overview", label: t("views.admin.tabs.overview") },
    { key: "content", label: t("views.admin.tabs.content") },
    { key: "health", label: t("views.admin.tabs.health") },
    { key: "users", label: t("views.admin.tabs.users") },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6)", maxWidth: 860, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <Icon name="shield" size={22} color="var(--accent-text)" />
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "var(--fs-h1)",
            letterSpacing: "var(--ls-display)",
            color: "var(--text-1)",
          }}
        >
          {t("views.admin.title")}
        </h1>
      </div>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      <div key={tab} className="muza-view">
        {tab === "overview" ? (
          <OverviewTab api={api} />
        ) : tab === "content" ? (
          <ContentTab api={api} />
        ) : tab === "health" ? (
          <HealthTab api={api} />
        ) : (
          <UsersTab api={api} />
        )}
      </div>
    </div>
  );
}
