/** Статистика прослушиваний: агрегаты /me/stats/overview за период
 *  (Неделя/Месяц/Год/Всё). Блоки включаются и переставляются в настройках
 *  (prefs.statsBlocks, под-экран «Статистика»); период по умолчанию —
 *  prefs.statsPeriod. Графики — div-бары на токенах ДС, без библиотек.
 *
 *  Композиция (T11): центрированная колонка, каждый блок — тихая панель
 *  (surface-1, r-md) с заголовком, чтобы страница читалась собранной сеткой,
 *  а не текстом от левого края. «Итоги года» — панель того же корпуса с
 *  акцентной подложкой (без чужеродного градиента), вписанная в ряд блоков. */

import { useEffect, useState } from "react";
import { Button, Icon, IconButton, Spinner, Tabs, Tooltip, TrackRow } from "@muza/ui";
import type { MuzaApi, StatsOverview, StatsPeriod, Track } from "@muza/api-client";
import { normalizeStatsBlocks, statsBlockLabel } from "../lib/statsBlocks";
import { hourLabel } from "../lib/hourLabel";
import { wrappedSeason } from "../lib/wrappedSeason";
import { withSnapshot } from "../lib/offlineSnapshot";
import type { Prefs, StatsBlockKey } from "../types";
import { useT } from "../i18n";
import type { Lang } from "../i18n";

/** Заголовок панели: одинаковый для всех блоков — секции читаются рядом. */
const panelHead: React.CSSProperties = {
  margin: "0 0 var(--sp-4)",
  fontSize: "var(--fs-title)",
  fontWeight: 700,
  color: "var(--text-1)",
};

/** Подпись ведра для тултипа/оси: день «11 июля» или месяц «июл 2026»
 *  (T31 i18n: месяц/день форматируются через `lang`, не захардкожены на
 *  "ru" — Intl сам подбирает нужные названия месяцев). */
function bucketLabel(bucket: string, lang: Lang): string {
  if (bucket.length === 7) {
    const [y, m] = bucket.split("-").map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleDateString(lang, { month: "short" });
    return `${monthName} ${y}`;
  }
  return new Date(`${bucket}T00:00:00`).toLocaleDateString(lang, { day: "numeric", month: "long" });
}

function fmtMinutes(ms: number, lang: Lang): string {
  return Math.round(ms / 60_000).toLocaleString(lang);
}

/** Панель блока: единый «карточный» корпус секции. flush — списки TrackRow
 *  идут во всю ширину (у строки свой внутренний отступ и ховер). */
function Panel({
  title,
  flush,
  children,
}: {
  title: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
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

/** Крупное число с подписью снизу — типографикой, без плиток и иконок. */
function BigStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div
        style={{
          fontSize: 36,
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

/** Бар-график на div'ах: высоты от максимума, тултип браузерным title.
 *  Нулевые вёдра — тонкая подложка, чтобы ряд читался как ось. */
function Bars({
  values,
  titles,
  height,
  ariaLabel,
}: {
  values: number[];
  titles: string[];
  height: number;
  ariaLabel: string;
}) {
  const max = Math.max(...values, 1);
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{ display: "flex", alignItems: "flex-end", gap: 3, height, width: "100%" }}
    >
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

/** Вход в «Итоги года»: панель того же корпуса, что и блоки (surface-1) —
 *  вписана в ряд, а не чужеродный градиент-баннер. Кликабельность несут
 *  акцентная плитка года, шеврон и акцентный ховер, а не крикливая подложка;
 *  подпись читается ровно как во всех остальных блоках (тот же контраст). */
function WrappedPanel({ year, onOpen }: { year: number; onOpen: () => void }) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        width: "100%",
        boxSizing: "border-box",
        padding: "var(--sp-5)",
        border: "none",
        borderRadius: "var(--r-md)",
        background: hover
          ? "color-mix(in srgb, var(--accent) 14%, var(--surface-1))"
          : "var(--surface-1)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-ui)",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          width: 60,
          height: 60,
          flex: "none",
          borderRadius: "var(--r-sm)",
          background: "var(--accent)",
          color: "var(--text-on-accent)",
          fontFamily: "var(--font-display)",
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "var(--ls-display)",
          lineHeight: 1,
        }}
      >
        {year}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "var(--fs-strong)", fontWeight: 700, color: "var(--text-1)" }}>
          {t("views.stats.wrappedPanel.title", { year })}
        </span>
        <span style={{ display: "block", marginTop: 2, fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.45 }}>
          {t("views.stats.wrappedPanel.hint")}
        </span>
      </span>
      <Icon name="chevron-right" size={20} color={hover ? "var(--accent-text)" : "var(--text-3)"} />
    </button>
  );
}

/** Скелетон страницы: тихие поверхности без мерцания (как лента). */
function StatsSkeleton() {
  const { t } = useT();
  return (
    <div
      aria-label={t("views.stats.skeletonAria")}
      role="status"
      style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}
    >
      {[0, 1, 2].map((s) => (
        <div key={s} style={{ background: "var(--surface-1)", borderRadius: "var(--r-md)", padding: "var(--sp-5)" }}>
          <div style={{ height: 16, width: 140, borderRadius: 8, background: "var(--surface-2)", marginBottom: "var(--sp-4)" }} />
          <div style={{ height: s === 1 ? 120 : 64, borderRadius: "var(--r-sm)", background: "var(--surface-2)" }} />
        </div>
      ))}
    </div>
  );
}

/** Плашка состояния (та же, что на главной): оффлайн / ошибка / пусто. */
function Notice({ icon, text, action, onAction }: { icon: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-4) var(--sp-5)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
      }}
    >
      <Icon name={icon} size={18} color="var(--text-3)" />
      <span style={{ flex: 1, fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>{text}</span>
      {action && onAction ? (
        <Button variant="secondary" onClick={onAction} style={{ flex: "none" }}>
          {action}
        </Button>
      ) : null}
    </div>
  );
}

export function StatsView({
  api,
  canSearch,
  prefs,
  currentId,
  playing,
  likes,
  onPlayCatalog,
  onLike,
  onCatalogMenu,
  onOpenWrapped,
  onCustomize,
}: {
  api: MuzaApi;
  /** false у анонима: истории на сервере нет — честная заглушка. */
  canSearch: boolean;
  prefs: Prefs;
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  likes: string[];
  onPlayCatalog: (tracks: Track[], id: string) => void;
  onLike: (id: string) => void;
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  onOpenWrapped: () => void;
  /** Открыть под-экран настроек «Статистика» (кнопка «Настроить»). */
  onCustomize: () => void;
}) {
  const { t, lang } = useT();
  const [period, setPeriod] = useState<StatsPeriod>(prefs.statsPeriod);
  const [state, setState] = useState<{
    status: "loading" | "live" | "error";
    data: StatsOverview | null;
    offline: boolean;
  }>({ status: "loading", data: null, offline: false });

  const load = () => {
    if (!canSearch) return () => undefined;
    let alive = true;
    // Держим прежние данные видимыми во время загрузки — иначе на смене периода
    // контент мигает скелетоном (fetch часто мгновенный из кэша/снапшота).
    setState((prev) => ({ status: "loading", data: prev.data, offline: prev.offline }));
    withSnapshot(`stats:${period}`, () => api.getStatsOverview(period))
      .then(({ data, offline }) => {
        if (alive) setState({ status: "live", data, offline });
      })
      .catch(() => {
        // ошибка при уже показанных данных — сохраняем их (плашку рисуем ниже)
        if (alive) setState((prev) => ({ status: "error", data: prev.data, offline: prev.offline }));
      });
    return () => {
      alive = false;
    };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api, canSearch, period]);

  const d = state.data;
  const blocks = normalizeStatsBlocks(prefs.statsBlocks).filter((b) => b.on);
  const season = wrappedSeason();
  // Тот же словарь, что у пресета периода в настройках (settings.stats.period.*) —
  // одно и то же понятие «период статистики», не вводим синоним.
  const periodTabs = [
    { key: "week", label: t("settings.stats.period.week") },
    { key: "month", label: t("settings.stats.period.month") },
    { key: "year", label: t("settings.stats.period.year") },
    { key: "all", label: t("settings.stats.period.allTime") },
  ];

  const renderBlock = (key: StatsBlockKey) => {
    if (!d) return null;
    switch (key) {
      case "summary":
        return (
          <Panel key={key} title={statsBlockLabel("summary", lang).label}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-6)", rowGap: "var(--sp-4)" }}>
              <BigStat value={fmtMinutes(d.totalMs, lang)} label={t("views.stats.summary.minutesLabel")} accent />
              <BigStat value={d.totalPlays.toLocaleString(lang)} label={t("views.stats.summary.playsLabel")} />
              <BigStat value={d.uniqueTracks.toLocaleString(lang)} label={t("views.stats.summary.tracksLabel")} />
              <BigStat value={d.uniqueArtists.toLocaleString(lang)} label={t("views.stats.summary.artistsLabel")} />
            </div>
          </Panel>
        );
      case "activity": {
        const daily = d.series.length > 0 && d.series[0].bucket.length === 10;
        return (
          <Panel key={key} title={statsBlockLabel("activity", lang).label}>
            <Bars
              values={d.series.map((s) => s.plays)}
              titles={d.series.map((s) => `${bucketLabel(s.bucket, lang)}: ${s.plays} · ${fmtMinutes(s.ms, lang)} ${t("views.stats.topArtists.minSuffix")}`)}
              height={120}
              ariaLabel={daily ? t("views.stats.activity.ariaByDay") : t("views.stats.activity.ariaByMonth")}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 6,
                fontSize: "var(--fs-caption)",
                color: "var(--text-3)",
              }}
            >
              <span>{bucketLabel(d.series[0]?.bucket ?? "", lang)}</span>
              <span>{bucketLabel(d.series[d.series.length - 1]?.bucket ?? "", lang)}</span>
            </div>
          </Panel>
        );
      }
      case "rhythm":
        return (
          <Panel key={key} title={statsBlockLabel("rhythm", lang).label}>
            <Bars
              values={d.hours}
              titles={d.hours.map((v, h) => `${h}:00 — ${v}`)}
              height={72}
              ariaLabel={t("views.stats.rhythm.aria")}
            />
            <div style={{ marginTop: 6, fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
              {d.topHour !== null
                ? t("views.stats.rhythm.topHour", { hour: d.topHour, label: hourLabel(d.topHour, lang) })
                : t("views.stats.rhythm.noTopHour")}
            </div>
          </Panel>
        );
      case "top_tracks":
        return d.topTracks.length > 0 ? (
          <Panel key={key} title={statsBlockLabel("top_tracks", lang).label} flush>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {d.topTracks.map((entry, i) => (
                <TrackRow
                  key={entry.track.id}
                  index={i + 1}
                  cover={entry.track.coverUrl ?? undefined}
                  title={entry.track.title}
                  artist={entry.track.artist}
                  // поле длительности показывает счётчик прослушиваний —
                  // для топа это информативнее хронометража
                  duration={`${entry.plays}×`}
                  active={currentId === entry.track.id}
                  playing={currentId === entry.track.id && playing}
                  liked={likes.includes(entry.track.id)}
                  onPlay={() => onPlayCatalog(d.topTracks.map((x) => x.track), entry.track.id)}
                  onLike={() => onLike(entry.track.id)}
                  onMore={(e: React.MouseEvent) => onCatalogMenu(entry.track, e)}
                />
              ))}
            </div>
          </Panel>
        ) : null;
      case "top_artists": {
        if (d.topArtists.length === 0) return null;
        const maxMs = Math.max(...d.topArtists.map((a) => a.playedMs), 1);
        return (
          <Panel key={key} title={statsBlockLabel("top_artists", lang).label}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {d.topArtists.map((a, i) => (
                <div key={a.artist} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                  <span
                    style={{
                      width: 24,
                      textAlign: "right",
                      color: "var(--text-3)",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: "var(--fs-caption)",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      width: 180,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--text-1)",
                      fontSize: "var(--fs-body)",
                      fontWeight: i === 0 ? 600 : 400,
                    }}
                  >
                    {a.artist}
                  </span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${(a.playedMs / maxMs) * 100}%`,
                        height: "100%",
                        borderRadius: 4,
                        background: "var(--accent)",
                        transition: "width var(--dur-base) var(--ease-out)",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 84,
                      textAlign: "right",
                      fontSize: "var(--fs-caption)",
                      color: "var(--text-3)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtMinutes(a.playedMs, lang)} {t("views.stats.topArtists.minSuffix")}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        );
      }
      case "streaks":
        return (
          <Panel key={key} title={statsBlockLabel("streaks", lang).label}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-6)", rowGap: "var(--sp-4)" }}>
              <BigStat
                value={`${d.currentStreakDays} ${t("views.stats.streaks.daysSuffix")}`}
                label={t("views.stats.streaks.current")}
                accent={d.currentStreakDays > 0}
              />
              <BigStat value={`${d.longestStreakDays} ${t("views.stats.streaks.daysSuffix")}`} label={t("views.stats.streaks.longest")} />
              <BigStat value={String(d.activeDays)} label={t("views.stats.streaks.activeDays")} />
            </div>
          </Panel>
        );
      case "likes":
        return (
          <Panel key={key} title={statsBlockLabel("likes", lang).label}>
            <BigStat value={`+${d.favoritesAdded}`} label={t("views.stats.likes.addedThisPeriod")} />
          </Panel>
        );
      case "wrapped":
        return <WrappedPanel key={key} year={season.year} onOpen={onOpenWrapped} />;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-5)",
        padding: "var(--sp-6)",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
          paddingBottom: "var(--sp-4)",
          borderBottom: "1px solid var(--surface-2)",
        }}
      >
        <h1
          style={{
            margin: 0,
            flex: 1,
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "var(--fs-greet)",
            letterSpacing: "var(--ls-display)",
            color: "var(--text-1)",
            lineHeight: "var(--lh-tight)",
          }}
        >
          {t("views.stats.title")}
        </h1>
        {canSearch ? (
          <>
            {/* тонкий индикатор обновления — контент при этом остаётся на месте */}
            {state.status === "loading" && d ? <Spinner size={16} color="var(--text-3)" /> : null}
            <Tabs items={periodTabs} value={period} onChange={(k: string) => setPeriod(k as StatsPeriod)} />
            <Tooltip label={t("views.stats.customizeBlocksTooltip")}>
              <IconButton icon="settings-2" label={t("views.stats.customizeBlocksLabel")} onClick={onCustomize} />
            </Tooltip>
          </>
        ) : null}
      </div>

      {!canSearch ? (
        <Notice
          icon="user-round"
          text={t("views.stats.notice.needsAccount")}
        />
      ) : !d ? (
        // данных ещё нет вообще: первый заход — скелетон, глухая ошибка — плашка
        state.status === "error" ? (
          <Notice
            icon="server-off"
            text={t("views.stats.notice.errorText")}
            action={t("views.stats.notice.retry")}
            onAction={load}
          />
        ) : (
          <StatsSkeleton />
        )
      ) : d.totalPlays === 0 && d.totalMs === 0 ? (
        <>
          {state.offline ? (
            <Notice
              icon="cloud-off"
              text={t("views.stats.notice.offlineText")}
              action={t("views.stats.notice.refresh")}
              onAction={load}
            />
          ) : null}
          <Notice icon="sparkles" text={t("views.stats.notice.emptyText")} />
        </>
      ) : (
        <>
          {/* данные есть — рисуем их; при неудачном обновлении показываем прежние + плашку */}
          {state.status === "error" ? (
            <Notice icon="server-off" text={t("views.stats.notice.updateFailedText")} action={t("views.stats.notice.retry")} onAction={load} />
          ) : state.offline ? (
            <Notice
              icon="cloud-off"
              text={t("views.stats.notice.offlineText")}
              action={t("views.stats.notice.refresh")}
              onAction={load}
            />
          ) : null}
          {blocks.map((b) => renderBlock(b.key))}
        </>
      )}
    </div>
  );
}
