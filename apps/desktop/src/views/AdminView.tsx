import { useEffect, useState } from "react";
import { Button, Icon, Spinner, Tabs } from "@muza/ui";
import type {
  AdminContent,
  AdminDayPoint,
  AdminErrors,
  AdminGrowth,
  AdminHealth,
  AdminOverview,
  AdminPublicPlaylist,
  AdminUsers,
  MuzaApi,
} from "@muza/api-client";
import { useT } from "../i18n";
import type { Lang } from "../i18n";
import { SeriesChart } from "./adminCharts";

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

/** Загрузка вкладки: единый паттерн «грузим → данные|ошибка».
 *
 *  Прежние данные при перезагрузке НЕ сбрасываются (2026-07-16): смена окна
 *  7/30/90 подменяла всю вкладку на «Загрузка…» и отстраивала заново — экран
 *  «моргал». Теперь старый контент стоит на месте, о фоновом обновлении
 *  говорит тонкий спиннер у табов (тот же приём, что в StatsView). */
function useAdminData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const { t } = useT();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load()
      .then((d) => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : t("views.admin.loadFailed"));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading };
}

/** Слот спиннера ФИКСИРОВАННОЙ ширины возле табов: появление/уход индикатора
 *  не двигает соседей ни на пиксель (прыжок шапки — то же «дёргание»). */
function BusyDot({ busy }: { busy: boolean }) {
  return (
    <span aria-hidden={!busy} style={{ width: 16, height: 16, flex: "none", display: "grid", placeItems: "center" }}>
      {busy ? <Spinner size={16} color="var(--text-3)" /> : null}
    </span>
  );
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
      <AdminPublicPlaylistsSection api={api} />
    </div>
  );
}

/** Рубильник публичных плейлистов (2026-07-17): обзор опубликованного +
 *  «Снять с публикации» (чекбокс — ещё и запретить публиковать снова).
 *  Экспорт — для точечного теста без остального ContentTab. */
export function AdminPublicPlaylistsSection({ api }: { api: MuzaApi }) {
  const { t, lang } = useT();
  const [rows, setRows] = useState<AdminPublicPlaylist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ban, setBan] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () =>
    api
      .getAdminPublicPlaylists()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const unpublish = async (id: string) => {
    setBusyId(id);
    try {
      await api.unpublishAdminPlaylist(id, ban);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section title={t("views.admin.publicPlaylists.title")}>
      {rows === null ? (
        <Loading error={error} />
      ) : rows.length === 0 ? (
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-body)" }}>
          {t("views.admin.publicPlaylists.empty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              fontSize: "var(--fs-caption)",
              color: "var(--text-2)",
              cursor: "pointer",
            }}
          >
            <input type="checkbox" checked={ban} onChange={(e) => setBan(e.target.checked)} />
            {t("views.admin.publicPlaylists.banToggle")}
          </label>
          {rows.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minHeight: 36 }}>
              <span style={{ flex: 1, minWidth: 0, color: "var(--text-1)", fontSize: "var(--fs-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
                <span style={{ color: "var(--text-3)" }}> · {p.ownerUsername}</span>
              </span>
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", flex: "none" }}>
                {t("views.admin.publicPlaylists.meta", { tracks: p.trackCount, followers: p.followersCount })}
              </span>
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", flex: "none" }}>
                {dt(p.publishedAt, lang)}
              </span>
              <Button variant="secondary" disabled={busyId === p.id} onClick={() => void unpublish(p.id)}>
                {t("views.admin.publicPlaylists.unpublish")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function HealthTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [hours, setHours] = useState(24);
  const { data, error, loading } = useAdminData<AdminHealth>(() => api.getAdminHealth(hours), [api, hours]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <div style={{ maxWidth: 360, flex: "1 1 auto" }}>
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
        <BusyDot busy={loading && data !== null} />
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

/** Окно диапазона (кусок C): один контрол на вкладки «Рост» и «Ошибки». */
function DaysTabs({ value, onChange, busy = false }: { value: number; onChange: (d: number) => void; busy?: boolean }) {
  const { t } = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
      <div style={{ maxWidth: 360, flex: "1 1 auto" }}>
        <Tabs
          items={[
            { key: "7", label: t("views.admin.growth.d7") },
            { key: "30", label: t("views.admin.growth.d30") },
            { key: "90", label: t("views.admin.growth.d90") },
          ]}
          value={String(value)}
          onChange={(k: string) => onChange(Number(k))}
        />
      </div>
      <BusyDot busy={busy} />
    </div>
  );
}

const sumOf = (pts: AdminDayPoint[]) => pts.reduce((s, p) => s + p.count, 0);

function Note({ text }: { text: string }) {
  return <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{text}</div>;
}

/** Кусок C: метрики роста — посещения/регистрации/скачивания, графики свои
 *  (adminCharts, токены ДС, без чарт-библиотек — конвенция проекта). */
function GrowthTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [days, setDays] = useState(30);
  const { data, error, loading } = useAdminData<AdminGrowth>(() => api.getAdminGrowth(days), [api, days]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <DaysTabs value={days} onChange={setDays} busy={loading && data !== null} />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <Section title={t("views.admin.growth.visits")}>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <StatCard
                label={t("views.admin.growth.visitsWindow")}
                value={sumOf(data.visits)}
                hint={t("views.admin.growth.visitsHint")}
              />
            </div>
            <SeriesChart points={data.visits} mode="line" ariaLabel={t("views.admin.growth.visits")} />
            <Note text={t("views.admin.growth.visitsNote")} />
          </Section>
          <Section title={t("views.admin.growth.registrations")}>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <StatCard label={t("views.admin.growth.registrationsWindow")} value={sumOf(data.registrations)} />
            </div>
            <SeriesChart points={data.registrations} mode="bars" ariaLabel={t("views.admin.growth.registrations")} />
          </Section>
          <Section title={t("views.admin.growth.downloads")}>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <StatCard label={t("views.admin.growth.downloadsTotal")} value={data.downloads.total} />
              <StatCard label={t("views.admin.growth.downloadsWindow")} value={sumOf(data.downloads.series)} />
            </div>
            <SeriesChart points={data.downloads.series} mode="bars" ariaLabel={t("views.admin.growth.downloads")} />
            {data.downloads.byAsset.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Row
                  header
                  cells={[
                    t("views.admin.growth.assetCol"),
                    t("views.admin.growth.tagCol"),
                    t("views.admin.growth.countCol"),
                  ]}
                />
                {data.downloads.byAsset.slice(0, 10).map((a) => (
                  <Row key={`${a.tag}:${a.asset}`} cells={[a.asset, a.tag, a.count]} />
                ))}
              </div>
            ) : null}
            <Note text={t("views.admin.growth.downloadsNote")} />
          </Section>
        </>
      )}
    </div>
  );
}

/** Раскрываемая строка одной группы ошибок: шапка (класс · текст, счётчик,
 *  дата) кликается и разворачивает детали + кнопку удаления группы. */
function ErrorGroupRow({
  group,
  open,
  onToggle,
  onDelete,
  busy,
  kindName,
  lang,
}: {
  group: AdminErrors["top"][number];
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
  kindName: (k: string) => string;
  lang: Lang;
}) {
  const { t } = useT();
  const detailRow = (label: string, value: string, mono?: boolean) => (
    <div style={{ display: "flex", gap: "var(--sp-3)", fontSize: "var(--fs-caption)" }}>
      <span style={{ flex: "0 0 92px", color: "var(--text-3)" }}>{label}</span>
      <span
        style={{
          flex: 1,
          color: "var(--text-2)",
          wordBreak: "break-word",
          fontFamily: mono ? "var(--font-mono, monospace)" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          width: "100%",
          padding: "var(--sp-2) var(--sp-3)",
          border: "none",
          background: "transparent",
          color: "var(--text-1)",
          fontSize: "var(--fs-body)",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <Icon
          name="chevron-right"
          size={16}
          color="var(--text-3)"
          style={{ flex: "none", transform: open ? "rotate(90deg)" : "none", transition: "transform var(--dur-fast) var(--ease-out)" }}
        />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {kindName(group.kind)} · {group.message || "—"}
        </span>
        <span style={{ flex: "none", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{group.count}</span>
        <span style={{ flex: "none", color: "var(--text-3)", fontSize: "var(--fs-caption)", whiteSpace: "nowrap" }}>
          {dt(group.lastSeen, lang)}
        </span>
      </button>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", padding: "0 var(--sp-3) var(--sp-3)" }}>
          {detailRow(t("views.admin.errors.detailMessage"), group.message || "—")}
          {detailRow(t("views.admin.errors.detailVersions"), group.appVersions.join(", ") || "—")}
          {detailRow(t("views.admin.errors.detailLast"), dt(group.lastSeen, lang))}
          {detailRow(t("views.admin.errors.detailHash"), group.stackHash, true)}
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            style={{
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 2,
              padding: "6px var(--sp-3)",
              border: "1px solid var(--danger)",
              borderRadius: "var(--r-sm)",
              background: "transparent",
              color: "var(--danger)",
              fontSize: "var(--fs-caption)",
              fontWeight: "var(--fw-medium)",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            <Icon name="trash-2" size={14} color="var(--danger)" />
            {t("views.admin.errors.deleteOne")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Кусок C: ошибки клиентов — серия, топ по stackHash, фильтры класс/версия.
 *  message приходит уже проскрабленным сервером; стеков нет — только хэш.
 *  Строки раскрываются в детали; группу или всё окно фильтров можно стереть. */
function ErrorsTab({ api }: { api: MuzaApi }) {
  const { t, lang } = useT();
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState("all");
  const [appVersion, setAppVersion] = useState("all");
  const [reload, setReload] = useState(0);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, error, loading } = useAdminData<AdminErrors>(
    () =>
      api.getAdminErrors({
        days,
        kind: kind === "all" ? undefined : kind,
        appVersion: appVersion === "all" ? undefined : appVersion,
      }),
    [api, days, kind, appVersion, reload],
  );
  const filterArg = { kind: kind === "all" ? undefined : kind, appVersion: appVersion === "all" ? undefined : appVersion };
  const refresh = () => {
    setOpenHash(null);
    setConfirmClear(false);
    setReload((n) => n + 1);
  };
  const doClear = async () => {
    setBusy(true);
    try {
      await api.clearAdminErrors(filterArg);
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const doDeleteGroup = async (hash: string) => {
    setBusy(true);
    try {
      await api.deleteAdminErrorGroup(hash);
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const kindLabels: Record<string, string> = {
    error: t("views.admin.errors.kindError"),
    unhandledrejection: t("views.admin.errors.kindRejection"),
    react: t("views.admin.errors.kindReact"),
  };
  const kindName = (k: string) => kindLabels[k] ?? k;
  // выбранный фильтр мог пропасть из окна — оставляем его пунктом, чтобы Tabs
  // не потерял значение, а юзер мог вернуться на «Все»
  const kindItems = data
    ? [
        { key: "all", label: t("views.admin.errors.all") },
        ...data.byKind.map((k) => ({ key: k.kind, label: `${kindName(k.kind)} · ${k.count}` })),
        ...(kind !== "all" && !data.byKind.some((k) => k.kind === kind)
          ? [{ key: kind, label: `${kindName(kind)} · 0` }]
          : []),
      ]
    : [];
  const appItems = data
    ? [
        { key: "all", label: t("views.admin.errors.all") },
        ...data.byApp.slice(0, 5).map((a) => ({ key: a.appVersion, label: `${a.appVersion} · ${a.count}` })),
        ...(appVersion !== "all" && !data.byApp.slice(0, 5).some((a) => a.appVersion === appVersion)
          ? [{ key: appVersion, label: `${appVersion} · 0` }]
          : []),
      ]
    : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <DaysTabs value={days} onChange={setDays} busy={loading && data !== null} />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
            <StatCard label={t("views.admin.errors.totalWindow")} value={data.totals.count} />
            <StatCard label={t("views.admin.errors.distinct")} value={data.totals.distinct} />
            {data.totals.count > 0 ? (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                {confirmClear ? (
                  <>
                    <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
                      {t("views.admin.errors.clearConfirm")}
                    </span>
                    <button
                      type="button"
                      onClick={doClear}
                      disabled={busy}
                      style={{
                        padding: "8px var(--sp-4)",
                        border: "none",
                        borderRadius: "var(--r-sm)",
                        background: "var(--danger)",
                        color: "var(--text-on-accent, #fff)",
                        fontSize: "var(--fs-caption)",
                        fontWeight: "var(--fw-semibold)",
                        cursor: busy ? "default" : "pointer",
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      {t("views.admin.errors.clearYes")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      disabled={busy}
                      style={{
                        padding: "8px var(--sp-4)",
                        border: "1px solid var(--surface-4)",
                        borderRadius: "var(--r-sm)",
                        background: "transparent",
                        color: "var(--text-2)",
                        fontSize: "var(--fs-caption)",
                        cursor: "pointer",
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px var(--sp-4)",
                      border: "1px solid var(--danger)",
                      borderRadius: "var(--r-sm)",
                      background: "transparent",
                      color: "var(--danger)",
                      fontSize: "var(--fs-caption)",
                      fontWeight: "var(--fw-medium)",
                      cursor: "pointer",
                    }}
                  >
                    <Icon name="trash-2" size={14} color="var(--danger)" />
                    {t("views.admin.errors.clear")}
                  </button>
                )}
              </div>
            ) : null}
          </div>
          {data.byKind.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <Tabs items={kindItems} value={kind} onChange={setKind} wrap />
              {data.byApp.length > 1 ? <Tabs items={appItems} value={appVersion} onChange={setAppVersion} wrap /> : null}
            </div>
          ) : null}
          <Section title={t("views.admin.errors.series")}>
            <SeriesChart
              points={data.series}
              mode="bars"
              color="var(--danger)"
              ariaLabel={t("views.admin.errors.series")}
            />
          </Section>
          <Section title={t("views.admin.errors.topTitle")}>
            {data.top.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: "var(--fs-body)" }}>
                {t("views.admin.errors.emptyTop")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {data.top.map((g) => (
                  <ErrorGroupRow
                    key={g.stackHash}
                    group={g}
                    open={openHash === g.stackHash}
                    onToggle={() => setOpenHash((h) => (h === g.stackHash ? null : g.stackHash))}
                    onDelete={() => doDeleteGroup(g.stackHash)}
                    busy={busy}
                    kindName={kindName}
                    lang={lang}
                  />
                ))}
              </div>
            )}
            <Note text={t("views.admin.errors.note")} />
          </Section>
        </>
      )}
    </div>
  );
}

export function AdminView({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [tab, setTab] = useState("overview");
  const tabs = [
    { key: "overview", label: t("views.admin.tabs.overview") },
    { key: "growth", label: t("views.admin.tabs.growth") },
    { key: "content", label: t("views.admin.tabs.content") },
    { key: "health", label: t("views.admin.tabs.health") },
    { key: "errors", label: t("views.admin.tabs.errors") },
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
        ) : tab === "growth" ? (
          <GrowthTab api={api} />
        ) : tab === "content" ? (
          <ContentTab api={api} />
        ) : tab === "health" ? (
          <HealthTab api={api} />
        ) : tab === "errors" ? (
          <ErrorsTab api={api} />
        ) : (
          <UsersTab api={api} />
        )}
      </div>
    </div>
  );
}
