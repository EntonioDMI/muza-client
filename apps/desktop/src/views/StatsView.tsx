/** Статистика прослушиваний: агрегаты /me/stats/overview за период
 *  (Неделя/Месяц/Год/Всё). Блоки включаются и переставляются в настройках
 *  (prefs.statsBlocks, под-экран «Статистика»); период по умолчанию —
 *  prefs.statsPeriod. Графики — div-бары на токенах ДС, без библиотек. */

import { useEffect, useState } from "react";
import { Button, Icon, IconButton, Spinner, Tabs, Tooltip, TrackRow } from "@muza/ui";
import type { MuzaApi, StatsOverview, StatsPeriod, Track } from "@muza/api-client";
import { normalizeStatsBlocks, STATS_BLOCK_META } from "../lib/statsBlocks";
import { hourLabel } from "../lib/hourLabel";
import { wrappedSeason } from "../lib/wrappedSeason";
import { withSnapshot } from "../lib/offlineSnapshot";
import type { Prefs, StatsBlockKey } from "../types";

const PERIOD_TABS = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "year", label: "Год" },
  { key: "all", label: "Всё время" },
];

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const h2: React.CSSProperties = {
  margin: "0 0 var(--sp-3)",
  fontSize: "var(--fs-title)",
  fontWeight: 700,
  color: "var(--text-1)",
};

/** Подпись ведра для тултипа/оси: день «11 июля» или месяц «июл 2026». */
function bucketLabel(bucket: string): string {
  if (bucket.length === 7) {
    const [y, m] = bucket.split("-").map(Number);
    return `${MONTHS_SHORT[m - 1]} ${y}`;
  }
  return new Date(`${bucket}T00:00:00`).toLocaleDateString("ru", { day: "numeric", month: "long" });
}

function fmtMinutes(ms: number): string {
  return Math.round(ms / 60_000).toLocaleString("ru");
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

/** Скелетон страницы: тихие поверхности без мерцания (как лента). */
function StatsSkeleton() {
  return (
    <div
      aria-label="Считаем статистику"
      role="status"
      style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}
    >
      {[0, 1, 2].map((s) => (
        <div key={s}>
          <div style={{ height: 16, width: 140, borderRadius: 8, background: "var(--surface-2)", marginBottom: "var(--sp-4)" }} />
          <div style={{ height: s === 1 ? 120 : 64, borderRadius: "var(--r-md)", background: "var(--surface-2)" }} />
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
        padding: "var(--sp-3) var(--sp-4)",
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
  currentId: string;
  playing: boolean;
  likes: string[];
  onPlayCatalog: (tracks: Track[], id: string) => void;
  onLike: (id: string) => void;
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  onOpenWrapped: () => void;
  /** Открыть под-экран настроек «Статистика» (кнопка «Настроить»). */
  onCustomize: () => void;
}) {
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

  const renderBlock = (key: StatsBlockKey) => {
    if (!d) return null;
    switch (key) {
      case "summary":
        return (
          <section key={key}>
            <h2 style={h2}>{STATS_BLOCK_META.summary.label}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-6)", rowGap: "var(--sp-4)" }}>
              <BigStat value={fmtMinutes(d.totalMs)} label="минут с музыкой" accent />
              <BigStat value={d.totalPlays.toLocaleString("ru")} label="прослушиваний" />
              <BigStat value={d.uniqueTracks.toLocaleString("ru")} label="треков" />
              <BigStat value={d.uniqueArtists.toLocaleString("ru")} label="артистов" />
            </div>
          </section>
        );
      case "activity": {
        const daily = d.series.length > 0 && d.series[0].bucket.length === 10;
        return (
          <section key={key}>
            <h2 style={h2}>{STATS_BLOCK_META.activity.label}</h2>
            <Bars
              values={d.series.map((s) => s.plays)}
              titles={d.series.map((s) => `${bucketLabel(s.bucket)}: ${s.plays} · ${fmtMinutes(s.ms)} мин`)}
              height={120}
              ariaLabel={`Прослушивания по ${daily ? "дням" : "месяцам"}`}
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
              <span>{bucketLabel(d.series[0]?.bucket ?? "")}</span>
              <span>{bucketLabel(d.series[d.series.length - 1]?.bucket ?? "")}</span>
            </div>
          </section>
        );
      }
      case "rhythm":
        return (
          <section key={key}>
            <h2 style={h2}>{STATS_BLOCK_META.rhythm.label}</h2>
            <Bars
              values={d.hours}
              titles={d.hours.map((v, h) => `${h}:00 — ${v}`)}
              height={72}
              ariaLabel="Прослушивания по часам суток"
            />
            <div style={{ marginTop: 6, fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
              {d.topHour !== null ? `Любимый час — ${d.topHour}:00 (${hourLabel(d.topHour)})` : "Пока без любимого часа"}
            </div>
          </section>
        );
      case "top_tracks":
        return d.topTracks.length > 0 ? (
          <section key={key}>
            <h2 style={h2}>{STATS_BLOCK_META.top_tracks.label}</h2>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {d.topTracks.map((t, i) => (
                <TrackRow
                  key={t.track.id}
                  index={i + 1}
                  cover={t.track.coverUrl ?? undefined}
                  title={t.track.title}
                  artist={t.track.artist}
                  // поле длительности показывает счётчик прослушиваний —
                  // для топа это информативнее хронометража
                  duration={`${t.plays}×`}
                  active={currentId === t.track.id}
                  playing={currentId === t.track.id && playing}
                  liked={likes.includes(t.track.id)}
                  onPlay={() => onPlayCatalog(d.topTracks.map((x) => x.track), t.track.id)}
                  onLike={() => onLike(t.track.id)}
                  onMore={(e: React.MouseEvent) => onCatalogMenu(t.track, e)}
                />
              ))}
            </div>
          </section>
        ) : null;
      case "top_artists": {
        if (d.topArtists.length === 0) return null;
        const maxMs = Math.max(...d.topArtists.map((a) => a.playedMs), 1);
        return (
          <section key={key}>
            <h2 style={h2}>{STATS_BLOCK_META.top_artists.label}</h2>
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
                    {fmtMinutes(a.playedMs)} мин
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      }
      case "streaks":
        return (
          <section key={key}>
            <h2 style={h2}>{STATS_BLOCK_META.streaks.label}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-6)", rowGap: "var(--sp-4)" }}>
              <BigStat value={`${d.currentStreakDays} дн.`} label="текущая серия" accent={d.currentStreakDays > 0} />
              <BigStat value={`${d.longestStreakDays} дн.`} label="рекордная серия" />
              <BigStat value={String(d.activeDays)} label="дней с музыкой за период" />
            </div>
          </section>
        );
      case "likes":
        return (
          <section key={key}>
            <h2 style={h2}>{STATS_BLOCK_META.likes.label}</h2>
            <BigStat value={`+${d.favoritesAdded}`} label="в любимое за период" />
          </section>
        );
      case "wrapped":
        return (
          <section key={key}>
            <button
              type="button"
              onClick={onOpenWrapped}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-5)",
                width: "100%",
                boxSizing: "border-box",
                padding: "var(--sp-4) var(--sp-5)",
                border: "none",
                borderRadius: "var(--r-md)",
                background:
                  "linear-gradient(120deg, color-mix(in srgb, var(--accent) 26%, var(--surface-1)), var(--surface-1) 70%)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 34,
                  fontWeight: 700,
                  letterSpacing: "var(--ls-display)",
                  lineHeight: 1,
                  color: "var(--accent-text)",
                  flex: "none",
                }}
              >
                {season.year}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "var(--fs-body)", fontWeight: 700, color: "var(--text-1)" }}>
                  Итоги {season.year}
                </span>
                <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
                  Story-слайды года: минуты, треки, артисты — и карточка на поделиться
                </span>
              </span>
              <Icon name="chevron-right" size={18} color="var(--text-3)" />
            </button>
          </section>
        );
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
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
          Статистика
        </h1>
        {canSearch ? (
          <>
            {/* тонкий индикатор обновления — контент при этом остаётся на месте */}
            {state.status === "loading" && d ? <Spinner size={16} color="var(--text-3)" /> : null}
            <Tabs items={PERIOD_TABS} value={period} onChange={(k: string) => setPeriod(k as StatsPeriod)} />
            <Tooltip label="Настроить блоки">
              <IconButton icon="settings-2" label="Настроить блоки статистики" onClick={onCustomize} />
            </Tooltip>
          </>
        ) : null}
      </div>

      {!canSearch ? (
        <Notice
          icon="user-round"
          text="Статистика считается на сервере по истории аккаунта. Войди с аккаунтом — и здесь появятся минуты, топы и серии."
        />
      ) : !d ? (
        // данных ещё нет вообще: первый заход — скелетон, глухая ошибка — плашка
        state.status === "error" ? (
          <Notice
            icon="server-off"
            text="Сервер недоступен, а оффлайн-копии статистики ещё нет."
            action="Повторить"
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
              text="Оффлайн-копия: сервер сейчас недоступен, показано последнее загруженное."
              action="Обновить"
              onAction={load}
            />
          ) : null}
          <Notice icon="sparkles" text="За этот период прослушиваний не было. Включи что-нибудь — статистика начнёт собираться." />
        </>
      ) : (
        <>
          {/* данные есть — рисуем их; при неудачном обновлении показываем прежние + плашку */}
          {state.status === "error" ? (
            <Notice icon="server-off" text="Не удалось обновить — показаны прежние данные." action="Повторить" onAction={load} />
          ) : state.offline ? (
            <Notice
              icon="cloud-off"
              text="Оффлайн-копия: сервер сейчас недоступен, показано последнее загруженное."
              action="Обновить"
              onAction={load}
            />
          ) : null}
          {blocks.map((b) => renderBlock(b.key))}
        </>
      )}
    </div>
  );
}
