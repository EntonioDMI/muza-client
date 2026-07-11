import { useEffect, useState } from "react";
import { Icon, Tabs } from "@muza/ui";
import type { AdminContent, AdminHealth, AdminOverview, AdminUsers, MuzaApi } from "@muza/api-client";

/** Админ-панель (Stage 5) — экраны из заметки «аналитика-и-админка»:
 *  Обзор / Контент / Здоровье добычи / Пользователи. Виден только админам
 *  (пункт сайдбара появляется после удачного adminPing). Все данные —
 *  агрегаты; в «Пользователях» PII-минимум (email не приходит вовсе). */

const TABS = [
  { key: "overview", label: "Обзор" },
  { key: "content", label: "Контент" },
  { key: "health", label: "Здоровье добычи" },
  { key: "users", label: "Пользователи" },
];

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const dt = (iso: string | null) =>
  iso === null ? "—" : new Date(iso).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
        if (alive) setError(e instanceof Error ? e.message : "Не удалось загрузить");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

function Loading({ error }: { error: string | null }) {
  return (
    <div style={{ padding: "var(--sp-6) 0", color: error ? "var(--danger)" : "var(--text-3)", fontSize: "var(--fs-body)" }}>
      {error ?? "Загружаем…"}
    </div>
  );
}

function OverviewTab({ api }: { api: MuzaApi }) {
  const { data, error } = useAdminData<AdminOverview>(() => api.getAdminOverview(), [api]);
  if (!data) return <Loading error={error} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <Section title="Слушатели">
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label="DAU" value={data.listeners.dau} hint="слушали за сутки" />
          <StatCard label="WAU" value={data.listeners.wau} hint="за неделю" />
          <StatCard label="MAU" value={data.listeners.mau} hint="за месяц" />
        </div>
      </Section>
      <Section title="Прослушивания">
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label="За сутки" value={data.plays.today} />
          <StatCard label="За неделю" value={data.plays.week} hint={`${data.plays.completedWeek} дослушано`} />
          <StatCard label="Всего" value={data.plays.total} />
        </div>
      </Section>
      <Section title="Пользователи">
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label="Всего" value={data.users.total} hint={`${data.users.withEmail} с почтой`} />
          <StatCard label="Новых за неделю" value={data.users.new7d} />
          <StatCard label="Админов" value={data.users.admins} />
        </div>
      </Section>
      <Section title="Каталог">
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label="Треков" value={data.catalog.tracks} />
          <StatCard label="Источников" value={data.catalog.sources} hint={`${data.catalog.deadSources} мёртвых`} />
          <StatCard label="В серверном кэше" value={data.catalog.cached} />
        </div>
      </Section>
    </div>
  );
}

function ContentTab({ api }: { api: MuzaApi }) {
  const { data, error } = useAdminData<AdminContent>(() => api.getAdminContent(), [api]);
  if (!data) return <Loading error={error} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <Section title="Покрытие каталога">
        <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
          <StatCard label="Треков" value={data.coverage.tracks} />
          <StatCard label="С текстом" value={data.coverage.withLyrics} hint={`${data.coverage.withSynced} синхронизировано`} />
          <StatCard label="С аннотациями" value={data.coverage.withAnnotations} />
        </div>
      </Section>
      <Section title="Источники">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Row header cells={["Провайдер · вид", "Всего", "Мёртвых"]} />
          {data.sourcesByProvider.map((s) => (
            <Row key={`${s.provider}:${s.kind}`} cells={[`${s.provider} · ${s.kind}`, s.count, s.dead]} />
          ))}
        </div>
      </Section>
      <Section title="Топ треков (14 дней)">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Row header cells={["Трек", "Прослушиваний"]} />
          {data.topTracks.map((r) => (
            <Row key={r.track.id} cells={[`${r.track.artist} — ${r.track.title}`, r.plays]} />
          ))}
        </div>
      </Section>
      <Section title="Топ артистов (14 дней)">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Row header cells={["Артист", "Прослушиваний"]} />
          {data.topArtists.map((r) => (
            <Row key={r.artist} cells={[r.artist, r.plays]} />
          ))}
        </div>
      </Section>
      <Section title="Новое в каталоге">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.recentTracks.map((t) => (
            <Row key={t.id} cells={[`${t.artist} — ${t.title}`, t.sources.join(", ") || "нет источников"]} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function HealthTab({ api }: { api: MuzaApi }) {
  const [hours, setHours] = useState(24);
  const { data, error } = useAdminData<AdminHealth>(() => api.getAdminHealth(hours), [api, hours]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <div style={{ maxWidth: 360 }}>
        <Tabs
          items={[
            { key: "24", label: "Сутки" },
            { key: "168", label: "Неделя" },
            { key: "720", label: "30 дней" },
          ]}
          value={String(hours)}
          onChange={(k: string) => setHours(Number(k))}
        />
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <Section title="Добыча (анонимные агрегаты клиентов)">
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <StatCard label="Success-rate" value={pct(data.totals.successRate)} hint={`${data.totals.resolveOk} ok / ${data.totals.resolveFail} fail`} />
              <StatCard label="Кэш-хиты" value={pct(data.totals.cacheHitRate)} hint={`${data.totals.cacheHits} хитов`} />
              <StatCard label="Отчётов" value={data.totals.reports} hint={`${data.totals.attempts} попыток добычи`} />
            </div>
          </Section>
          <Section title="Ошибки по классам (KPI SABR/403)">
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <StatCard label="403" value={data.totals.fail403} />
              <StatCard label="Bot-check" value={data.totals.failBot} />
              <StatCard label="Форматы (SABR/DRM)" value={data.totals.failFormat} />
              <StatCard label="Прочее" value={data.totals.failOther} />
            </div>
          </Section>
          <Section title="По версии рецепта">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Row header cells={["Рецепт", "Отчётов", "OK", "Fail", "Success"]} />
              {data.byRecipe.map((r) => (
                <Row
                  key={r.recipeVersion}
                  cells={[
                    `v${r.recipeVersion}${r.recipeVersion === data.recipeVersion ? " (текущий)" : ""}`,
                    r.reports,
                    r.ok,
                    r.fail,
                    pct(r.successRate),
                  ]}
                />
              ))}
            </div>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              Рецепт на сервере: v{data.recipeVersion}. Раскатка рецепта = деплой сервера; канареи и фиче-флаги — беклог.
            </div>
          </Section>
          <Section title="По версии приложения">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Row header cells={["Версия", "Отчётов", "OK", "Fail"]} />
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
  const { data, error } = useAdminData<AdminUsers>(() => api.getAdminUsers({ limit: 100 }), [api]);
  if (!data) return <Loading error={error} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
        Всего {data.total}. PII-минимум: почта не показывается — только факт её наличия. Права админа выдаются
        вручную на сервере.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Row header cells={["Пользователь", "Создан", "Прослушиваний (30д)", "Последнее"]} />
        {data.users.map((u) => (
          <Row
            key={u.id}
            cells={[
              `${u.username}${u.isAdmin ? " · админ" : ""}${u.hasEmail ? " · ✉" : ""}`,
              dt(u.createdAt),
              u.plays30d,
              dt(u.lastPlayAt),
            ]}
          />
        ))}
      </div>
    </div>
  );
}

export function AdminView({ api }: { api: MuzaApi }) {
  const [tab, setTab] = useState("overview");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6)", maxWidth: 860 }}>
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
          Админка
        </h1>
      </div>
      <Tabs items={TABS} value={tab} onChange={setTab} />
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
