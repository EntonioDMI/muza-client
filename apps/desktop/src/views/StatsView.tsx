/** Статистика прослушиваний: агрегаты /me/stats/overview за период
 *  (Неделя/Месяц/Год/Всё). Блоки включаются и переставляются в настройках
 *  (prefs.statsBlocks, под-экран «Статистика»); период по умолчанию —
 *  prefs.statsPeriod. Графики — div-бары на токенах ДС, без библиотек.
 *
 *  Композиция (T11): центрированная колонка, каждый блок — тихая панель
 *  (surface-1, r-md) с заголовком, чтобы страница читалась собранной сеткой,
 *  а не текстом от левого края. Блока «Итоги года» здесь больше нет — вход
 *  во Wrapped остаётся только с главной (решение владельца, 2026-07-16). */

import { useEffect, useState } from "react";
import { Button, Icon, IconButton, Spinner, Tabs, Tooltip, TrackRow } from "@muza/ui";
import type { MuzaApi, StatsOverview, StatsPeriod, Track } from "@muza/api-client";
import { normalizeStatsBlocks, statsBlockLabel } from "../lib/statsBlocks";
import { BAR_MAX_WIDTH, barSpecs } from "../lib/statsBars";
import { hourLabel } from "../lib/hourLabel";
import { withSnapshot } from "../lib/offlineSnapshot";
import { trackRowL10n } from "../lib/dsLabels";
import { useWarmRow } from "../player/useWarmer";
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

/** Бар-график на div'ах: высоты — barSpecs (чистая геометрия, под тестами),
 *  тултип — <Tooltip> ДС (был браузерный title: стоковая плашка WebView2
 *  выбивалась из языка приложения — жалоба 2026-07-16). Нулевые вёдра —
 *  тонкая подложка (ось ряда).
 *
 *  Фикс «сплошной плашки» (2026-07-16): ширина бара ограничена BAR_MAX_WIDTH,
 *  ряд раскладывается space-between — короткая серия (одно ведро «Всё» у
 *  молодой истории, семь недельных) остаётся стройными колонками, а не
 *  плитами во всю панель. Единственное ведро центрируется. Анимацию высоты
 *  глушит reduced-motion глобально (base.css ДС: 1ms).
 *  Экспорт — для юнит-тестов формы. */
export function Bars({
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
  const specs = barSpecs(values);
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: values.length === 1 ? "center" : "space-between",
        gap: 3,
        height,
        width: "100%",
      }}
    >
      {specs.map((pct, i) => (
        // Обёртка-Tooltip тянется на всю высоту ряда: ховер ловится по колонке,
        // а не по узкому столбику, и подсказка не прыгает по вертикали.
        <Tooltip
          key={i}
          label={titles[i]}
          style={{ flex: 1, minWidth: 2, maxWidth: BAR_MAX_WIDTH, height: "100%", alignItems: "flex-end" }}
        >
          <div
            style={{
              width: "100%",
              height: pct !== null ? `${pct}%` : 2,
              borderRadius: 3,
              background: pct !== null ? "var(--accent)" : "var(--surface-3)",
              transition: "height var(--dur-base) var(--ease-out)",
            }}
          />
        </Tooltip>
      ))}
    </div>
  );
}

/** Крупное «геройское» число плитки: типографический якорь (56px,
 *  tabular-nums), суффикс тише и мельче, подпись — caption снизу. */
function Hero({ value, suffix, label, accent }: { value: string; suffix?: string; label: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-2)" }}>
        <span
          style={{
            fontSize: 56,
            fontWeight: 800,
            lineHeight: 1,
            color: accent ? "var(--accent-text)" : "var(--text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        {suffix ? (
          <span style={{ fontSize: "var(--fs-title)", fontWeight: 600, color: "var(--text-3)" }}>{suffix}</span>
        ) : null}
      </div>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: "var(--sp-2)" }}>{label}</div>
    </div>
  );
}

/** Строка «подпись слева — значение справа» (язык слайда «Твой ритм», §2
 *  спеки статистики): без иконок, значение крупным табличным числом. */
function StatRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--sp-4)",
        padding: "var(--sp-3) 0",
      }}
    >
      <span style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{label}</span>
      <span
        style={{
          fontSize: "var(--fs-title)",
          fontWeight: 700,
          color: accent ? "var(--accent-text)" : "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
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
  // Тот же словарь, что у пресета периода в настройках (settings.stats.period.*) —
  // одно и то же понятие «период статистики», не вводим синоним.
  const periodTabs = [
    { key: "week", label: t("settings.stats.period.week") },
    { key: "month", label: t("settings.stats.period.month") },
    { key: "year", label: t("settings.stats.period.year") },
    { key: "all", label: t("settings.stats.period.allTime") },
  ];

  const warmRow = useWarmRow();

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
                // одно ведро — один центрированный ярлык (не дублируем дату по краям)
                justifyContent: d.series.length === 1 ? "center" : "space-between",
                marginTop: 6,
                fontSize: "var(--fs-caption)",
                color: "var(--text-3)",
              }}
            >
              <span>{bucketLabel(d.series[0]?.bucket ?? "", lang)}</span>
              {d.series.length > 1 ? <span>{bucketLabel(d.series[d.series.length - 1]?.bucket ?? "", lang)}</span> : null}
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
                // обёртка — точка прогрева (hover/видимость), как DnD-обёртки
                // в остальных вьюхах; у топа DnD нет, поэтому div голый
                <div key={entry.track.id} {...warmRow(entry.track.id)}>
                <TrackRow
                  {...trackRowL10n(t)}
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
                </div>
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
      case "streaks": {
        // Плитка в две зоны: слева герой-число текущей серии (+ полоса «до
        // рекорда» в языке баров топ-артистов), справа — строки «подпись —
        // табличное значение» с тонкими разделителями (§2, без иконок).
        const cur = d.currentStreakDays;
        const rec = d.longestStreakDays;
        const days = t("views.stats.streaks.daysSuffix");
        return (
          <Panel key={key} title={statsBlockLabel("streaks", lang).label}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--sp-6)", rowGap: "var(--sp-5)" }}>
              <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                <Hero value={String(cur)} suffix={days} label={t("views.stats.streaks.current")} accent={cur > 0} />
                {rec > 0 && cur < rec ? (
                  <div style={{ marginTop: "var(--sp-4)" }}>
                    <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min((cur / rec) * 100, 100)}%`,
                          height: "100%",
                          borderRadius: 4,
                          background: "var(--accent)",
                          transition: "width var(--dur-base) var(--ease-out)",
                        }}
                      />
                    </div>
                    <div style={{ marginTop: 6, fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                      {t("views.stats.streaks.toRecord")} · {cur}/{rec}
                    </div>
                  </div>
                ) : cur > 0 && cur === rec ? (
                  <div style={{ marginTop: "var(--sp-4)", fontSize: "var(--fs-caption)", fontWeight: 600, color: "var(--accent-text)" }}>
                    {t("views.stats.streaks.atRecord")}
                  </div>
                ) : null}
              </div>
              <div style={{ flex: "1 1 280px", minWidth: 240 }}>
                <StatRow label={t("views.stats.streaks.longest")} value={`${rec} ${days}`} accent={cur > 0 && cur === rec} />
                <div style={{ borderTop: "1px solid var(--surface-2)" }}>
                  <StatRow label={t("views.stats.streaks.activeDays")} value={String(d.activeDays)} />
                </div>
              </div>
            </div>
          </Panel>
        );
      }
      case "likes": {
        // Герой «+N» слева; справа — производные от периода: средний темп
        // (по гранулярности вёдер серии) и доля прослушиваний, ушедших в
        // лайки. Пустой период — честная тихая строка вместо голого нуля.
        const n = d.favoritesAdded;
        const daily = d.series.length > 0 && d.series[0].bucket.length === 10;
        const avg = d.series.length > 0 ? n / d.series.length : 0;
        const avgStr =
          avg > 0 && avg < 0.1
            ? `< ${(0.1).toLocaleString(lang)}`
            : avg.toLocaleString(lang, { maximumFractionDigits: 1 });
        const every = n > 0 && d.totalPlays >= n ? Math.round(d.totalPlays / n) : null;
        return (
          <Panel key={key} title={statsBlockLabel("likes", lang).label}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--sp-6)", rowGap: "var(--sp-5)" }}>
              <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                <Hero
                  value={n > 0 ? `+${n.toLocaleString(lang)}` : "0"}
                  label={t("views.stats.likes.addedThisPeriod")}
                  accent={n > 0}
                />
              </div>
              <div style={{ flex: "1 1 280px", minWidth: 240 }}>
                {n === 0 ? (
                  <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
                    {t("views.stats.likes.emptyPeriod")}
                  </div>
                ) : (
                  <>
                    {d.series.length > 0 ? (
                      <StatRow
                        label={t("views.stats.likes.avgLabel")}
                        value={t(daily ? "views.stats.likes.avgPerDay" : "views.stats.likes.avgPerMonth", { value: avgStr })}
                      />
                    ) : null}
                    {every !== null ? (
                      <div style={{ borderTop: "1px solid var(--surface-2)" }}>
                        <StatRow label={t("views.stats.likes.shareLabel")} value={t("views.stats.likes.shareValue", { n: every })} />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </Panel>
        );
      }
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
            {/* тонкий индикатор обновления — контент при этом остаётся на месте.
                Слот ФИКСИРОВАННОЙ ширины: появление спиннера не сдвигает табы
                (сдвиг шапки на каждую смену периода читался как «дёргание»). */}
            <span aria-hidden style={{ width: 16, height: 16, flex: "none", display: "grid", placeItems: "center" }}>
              {state.status === "loading" && d ? <Spinner size={16} color="var(--text-3)" /> : null}
            </span>
            <Tabs items={periodTabs} value={period} onChange={(k: string) => setPeriod(k as StatsPeriod)} />
            {/* Без внешнего <Tooltip>: IconButton сам тултипит label — обёртка
                давала две подсказки разом (косяк волны 0.1.4). */}
            <IconButton icon="settings-2" label={t("views.stats.customizeBlocksLabel")} onClick={onCustomize} />
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
