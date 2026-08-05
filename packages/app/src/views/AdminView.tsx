import { useEffect, useState } from "react";
import { Button, Icon, IconButton, Panel, SearchInput, Spinner, Switch, Table, Tabs } from "@muza/ui";
import type { TableColumn } from "@muza/ui";
import type {
  AdminContent,
  AdminDayPoint,
  AdminErrors,
  AdminGrowth,
  AdminHealth,
  AdminOverview,
  AdminPublicPlaylist,
  AdminUsers,
  MarketTheme,
  MuzaApi,
} from "@muza/api-client";
import { useT } from "../i18n";
import type { Lang } from "../i18n";
import { SeriesChart } from "./adminCharts";

/** Админ-панель (Stage 5) — экраны из заметки «аналитика-и-админка»:
 *  Обзор / Рост / Контент / Здоровье добычи / Ошибки / Пользователи. Виден
 *  только админам (пункт сайдбара появляется после удачного adminPing). Все
 *  данные — агрегаты; в «Пользователях» PII-минимум (email не приходит вовсе).
 *
 *  РЕВИЗИЯ 05.08 («пользоваться неудобно и выглядит плохо»). Две болезни:
 *
 *  1. ЭКРАН БЫЛ НАПИСАН МИМО ДИЗАЙН-СИСТЕМЫ. Из двадцати шести примитивов
 *     использовались шесть, а «панель» и «таблица» рисовались инлайном —
 *     потому что таких примитивов в ДС не существовало вовсе. Теперь они есть
 *     (@muza/ui: Panel, Table), и админка больше не изобретает свои: секции —
 *     Panel, таблицы — настоящая <table> с ролями и сортировкой по клику на
 *     заголовок, кнопки — Button, переключатель — Switch.
 *
 *  2. СПИСКИ МОЛЧА ОБРЕЗАЛИСЬ. Темы в витрине показывались первые 50 (и о
 *     существовании остальных нигде не говорилось), ассеты релиза — 10,
 *     фильтр версий — 5, топы — 20, а публичные плейлисты приходили ВСЕ одним
 *     ответом и все рисовались подряд. Ни одно урезание теперь не молчит:
 *     каждый обрезанный список говорит, сколько показано и сколько всего, и
 *     где это возможно — листается или разворачивается.
 *
 *  Из старого инлайна выжила только StatCard (почему — у самого компонента);
 *  Section и Row умерли: их работу делают Panel и Table. */

/** Минимальная ширина плитки числа. Уже — и подпись вроде «Прослушиваний
 *  (30д)» ломается на три строки, а число перестаёт читаться первым. */
const STAT_MIN_W = 150;

/** Ширина, с которой панель ещё имеет смысл: ниже неё три плитки чисел в ряд
 *  не помещаются, и панель уезжает на свою строку ленты. */
const PANEL_MIN_W = 360;

/** Полоса выбора окна (сутки/неделя/месяц) не тянется на всю ширину: растянутая
 *  она читается как навигация по разделам, а не как выбор периода над данными. */
const RANGE_TABS_MAX_W = 360;

/** Пользователей на страницу. 50 строк — экран с запасом; листать дальше
 *  быстрее, чем прокручивать простыню из сотен. */
const USERS_PAGE = 50;

/** Публичных плейлистов на страницу. Сервер отдаёт их ВСЕ одним ответом (без
 *  take), поэтому страницы режем на клиенте — иначе при паре сотен публикаций
 *  экран превращался в бесконечную ленту. Серверную страницу см. needsOutside
 *  задачи 05.08. */
const PLAYLISTS_PAGE = 50;

/** Сколько тем отдаёт витрина за один запрос. Число серверное (дефолт limit у
 *  GET /market/themes), клиент его не задаёт — метода с параметром в
 *  @muza/api-client пока нет. Упёрлись в потолок — говорим об этом вслух. */
const THEMES_LIMIT = 50;

/** Сколько файлов релиза показываем сразу: обычно их 3-4 на релиз, остальное —
 *  хвост старых сборок, который нужен редко. Разворачивается кнопкой. */
const ASSETS_PREVIEW = 10;

/** Сколько версий приложения показывать в фильтре ошибок сразу: свежие версии
 *  идут первыми, старые нужны точечно. Разворачивается кнопкой. */
const APP_FILTER_PREVIEW = 5;

/** Размер иконки внутри строки-раскрывашки: вровень со строчным текстом. */
const ROW_ICON = 16;

/** Значок в шапке экрана — чуть мельче кегля заголовка (--fs-h1 = 28px): вровень
 *  он спорил бы с ним за первое слово, мельче — потерялся бы. */
const TITLE_ICON = 22;

/** Колонка подписей в деталях ошибки: ширины хватает самому длинному ярлыку
 *  («Версии», «Хэш группы»), и значения всех строк встают в одну линию. */
const DETAIL_LABEL_W = 92;

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
/** T31 i18n: дата/время форматируются под текущий `lang`, не захардкожены
 *  на "ru" (та же схема, что в SettingsView/StatsView). */
const dt = (iso: string | null, lang: Lang) =>
  iso === null ? "—" : new Date(iso).toLocaleString(lang, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
/** Момент для сортировки по дате: пустая дата — самая старая, а не «ошибка». */
const at = (iso: string | null) => (iso === null ? 0 : new Date(iso).getTime());

/** Плитка числа. НЕ Panel и не Table намеренно: у Panel заголовок — h2, то
 *  есть раздел страницы с местом под действие, а здесь подпись, число и
 *  приписка — это сами данные. Свести их в один компонент значило бы завести
 *  у Panel четвёртый режим ради экономии двадцати строк. */
function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div
      style={{
        flex: `1 1 ${STAT_MIN_W}px`,
        minWidth: STAT_MIN_W,
        padding: "var(--sp-4)",
        borderRadius: "var(--r-md)",
        /* на ступень выше подложки панели (surface-2) — иначе плитка сливается
           с карточкой, в которой стоит */
        background: "var(--surface-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-1)",
      }}
    >
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{label}</span>
      {/* Числа — тем же голосом, что в Статистике: --fs-num + табличные цифры
          (редизайн 04.08). Сырые 26px были единственным местом, где сводное
          число говорило не в общий типографический ряд. */}
      <span
        style={{
          fontSize: "var(--fs-num)",
          fontWeight: "var(--fw-bold)",
          letterSpacing: "var(--ls-num)",
          color: "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: "var(--lh-tight)",
        }}
      >
        {value}
      </span>
      {hint ? <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{hint}</span> : null}
    </div>
  );
}

/** Лента панелей: на широком окне панели встают по две-три в ряд, на узком
 *  переносятся. Без неё «Обзор» был километровым столбцом карточек, хотя в
 *  каждой лежало по три числа. */
function PanelLane({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)", alignItems: "flex-start" }}>{children}</div>
  );
}

/** Плитки чисел внутри панели. */
function Stats({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>{children}</div>;
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
    <span aria-hidden={!busy} style={{ width: ROW_ICON, height: ROW_ICON, flex: "none", display: "grid", placeItems: "center" }}>
      {busy ? <Spinner size={ROW_ICON} color="var(--text-3)" /> : null}
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

/** Приписка под содержимым панели. `inset` — когда панель flush и подпись
 *  должна встать под текстом первой колонки, а не под краем карточки. */
function Note({ text, inset = false }: { text: string; inset?: boolean }) {
  return (
    <div
      style={{
        margin: inset ? "var(--sp-2) var(--sp-3) 0" : "var(--sp-2) 0 0",
        fontSize: "var(--fs-caption)",
        color: "var(--text-3)",
      }}
    >
      {text}
    </div>
  );
}

/** Счётчик в шапке панели: сколько строк сейчас на глазах и сколько всего.
 *  Именно он закрывает жалобу «неудобно» — до него список молчал о том, что
 *  он неполный. */
function Counter({ shown, total }: { shown: number; total: number }) {
  const { t } = useT();
  return (
    <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
      {shown === total ? t("views.admin.limits.shown", { count: total }) : t("views.admin.limits.shownOf", { shown, total })}
    </span>
  );
}

/** Листалка страниц — одна на всех: у пользователей страницы даёт сервер, у
 *  публичных плейлистов режем на клиенте, а выглядит и работает одинаково. */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useT();
  if (pages <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: "var(--sp-3)" }}>
      <IconButton
        icon="chevron-left"
        size="sm"
        label={t("views.admin.pager.prev")}
        disabled={page === 0}
        onClick={() => onPage(Math.max(0, page - 1))}
      />
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
        {t("views.admin.pager.pageOf", { page: page + 1, pages })}
      </span>
      <IconButton
        icon="chevron-right"
        size="sm"
        label={t("views.admin.pager.next")}
        disabled={page >= pages - 1}
        onClick={() => onPage(Math.min(pages - 1, page + 1))}
      />
    </div>
  );
}

/** «Показать все (N)» / «Свернуть» для списков с превью. Появляется только
 *  когда есть что разворачивать. */
function ExpandButton({ open, total, onToggle }: { open: boolean; total: number; onToggle: () => void }) {
  const { t } = useT();
  return (
    <Button variant="ghost" onClick={onToggle}>
      {open ? t("views.admin.limits.collapse") : t("views.admin.limits.showAll", { count: total })}
    </Button>
  );
}

function OverviewTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const { data, error } = useAdminData<AdminOverview>(() => api.getAdminOverview(), [api]);
  if (!data) return <Loading error={error} />;
  return (
    <PanelLane>
      <Panel title={t("views.admin.sections.listeners")} style={{ flexBasis: PANEL_MIN_W }}>
        <Stats>
          <StatCard label="DAU" value={data.listeners.dau} hint={t("views.admin.stats.dauHint")} />
          <StatCard label="WAU" value={data.listeners.wau} hint={t("views.admin.stats.wauHint")} />
          <StatCard label="MAU" value={data.listeners.mau} hint={t("views.admin.stats.mauHint")} />
        </Stats>
      </Panel>
      <Panel title={t("views.admin.sections.plays")} style={{ flexBasis: PANEL_MIN_W }}>
        <Stats>
          <StatCard label={t("views.admin.stats.today")} value={data.plays.today} />
          <StatCard
            label={t("views.admin.stats.thisWeek")}
            value={data.plays.week}
            hint={t("views.admin.stats.completedSuffix", { count: data.plays.completedWeek })}
          />
          <StatCard label={t("views.admin.stats.total")} value={data.plays.total} />
        </Stats>
      </Panel>
      <Panel title={t("views.admin.sections.users")} style={{ flexBasis: PANEL_MIN_W }}>
        <Stats>
          <StatCard
            label={t("views.admin.stats.total")}
            value={data.users.total}
            hint={t("views.admin.stats.withEmailSuffix", { count: data.users.withEmail })}
          />
          <StatCard label={t("views.admin.stats.newThisWeek")} value={data.users.new7d} />
          <StatCard label={t("views.admin.stats.admins")} value={data.users.admins} />
        </Stats>
      </Panel>
      <Panel title={t("views.admin.sections.catalog")} style={{ flexBasis: PANEL_MIN_W }}>
        <Stats>
          <StatCard label={t("views.admin.stats.tracks")} value={data.catalog.tracks} />
          <StatCard
            label={t("views.admin.stats.sourcesLabel")}
            value={data.catalog.sources}
            hint={t("views.admin.stats.deadSuffix", { count: data.catalog.deadSources })}
          />
          <StatCard label={t("views.admin.stats.inServerCache")} value={data.catalog.cached} />
        </Stats>
      </Panel>
    </PanelLane>
  );
}

function ContentTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const { data, error } = useAdminData<AdminContent>(() => api.getAdminContent(), [api]);
  if (!data) return <Loading error={error} />;

  const sourceCols: TableColumn<AdminContent["sourcesByProvider"][number]>[] = [
    {
      key: "provider",
      label: t("views.admin.rows.providerKind"),
      sortable: true,
      render: (s) => `${s.provider} · ${s.kind}`,
      sortValue: (s) => `${s.provider} ${s.kind}`,
    },
    { key: "count", label: t("views.admin.rows.total"), width: "120px", numeric: true, sortable: true },
    { key: "dead", label: t("views.admin.rows.dead"), width: "120px", numeric: true, sortable: true },
  ];
  const trackCols: TableColumn<AdminContent["topTracks"][number]>[] = [
    {
      key: "track",
      label: t("views.admin.rows.track"),
      sortable: true,
      render: (r) => `${r.track.artist} — ${r.track.title}`,
      sortValue: (r) => `${r.track.artist} ${r.track.title}`,
    },
    { key: "plays", label: t("views.admin.rows.plays"), width: "140px", numeric: true, sortable: true },
  ];
  const artistCols: TableColumn<AdminContent["topArtists"][number]>[] = [
    { key: "artist", label: t("views.admin.rows.artist"), sortable: true },
    { key: "plays", label: t("views.admin.rows.plays"), width: "140px", numeric: true, sortable: true },
  ];
  const recentCols: TableColumn<AdminContent["recentTracks"][number]>[] = [
    {
      key: "title",
      label: t("views.admin.rows.track"),
      sortable: true,
      render: (tr) => `${tr.artist} — ${tr.title}`,
      sortValue: (tr) => `${tr.artist} ${tr.title}`,
    },
    {
      key: "sources",
      label: t("views.admin.rows.sources"),
      width: "40%",
      render: (tr) => tr.sources.join(", ") || t("views.admin.rows.noSources"),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <Panel title={t("views.admin.sections.catalogCoverage")}>
        <Stats>
          <StatCard label={t("views.admin.stats.tracks")} value={data.coverage.tracks} />
          <StatCard
            label={t("views.admin.stats.withLyrics")}
            value={data.coverage.withLyrics}
            hint={t("views.admin.stats.syncedSuffix", { count: data.coverage.withSynced })}
          />
          <StatCard label={t("views.admin.stats.withAnnotations")} value={data.coverage.withAnnotations} />
        </Stats>
      </Panel>
      <Panel
        title={t("views.admin.sections.sources")}
        action={<Counter shown={data.sourcesByProvider.length} total={data.sourcesByProvider.length} />}
        flush
      >
        <Table
          columns={sourceCols}
          rows={data.sourcesByProvider}
          rowKey={(s) => `${s.provider}:${s.kind}`}
          ariaLabel={t("views.admin.sections.sources")}
        />
      </Panel>
      {/* Топы жёстко обрезаны сервером (20 строк, окно 14 дней зашито там же) —
          подписью говорим об этом прямо, чтобы «топ» не читался как «весь». */}
      <Panel title={t("views.admin.sections.topTracks")} flush>
        <Table columns={trackCols} rows={data.topTracks} rowKey={(r) => r.track.id} ariaLabel={t("views.admin.sections.topTracks")} />
        <Note text={t("views.admin.limits.first", { count: data.topTracks.length })} inset />
      </Panel>
      <Panel title={t("views.admin.sections.topArtists")} flush>
        <Table columns={artistCols} rows={data.topArtists} rowKey={(r) => r.artist} ariaLabel={t("views.admin.sections.topArtists")} />
        <Note text={t("views.admin.limits.first", { count: data.topArtists.length })} inset />
      </Panel>
      <Panel title={t("views.admin.sections.newInCatalog")} flush>
        <Table columns={recentCols} rows={data.recentTracks} rowKey={(tr) => tr.id} ariaLabel={t("views.admin.sections.newInCatalog")} />
        <Note text={t("views.admin.limits.last", { count: data.recentTracks.length })} inset />
      </Panel>
      <AdminPublicPlaylistsSection api={api} />
      <AdminMarketThemesSection api={api} />
    </div>
  );
}

/** Модерация витрины тем (04.08, upgrade-list): скрытую жалобами тему раньше
 *  можно было только УДАЛИТЬ НАВСЕГДА — пять жалоб были смертным приговором,
 *  хотя жалобы бывают и злонамеренными. Серверная ручка POST themes/:id/hidden
 *  существовала с самого начала, клиентского метода не было. Админ видит все
 *  темы (сервер не фильтрует ему hidden), скрытые помечены и возвращаются
 *  одной кнопкой; видимые можно скрыть, не удаляя.
 *
 *  Потолок списка (05.08): витрина отдаёт максимум THEMES_LIMIT тем за раз и
 *  раньше молчала об этом — тем сверх полусотни админ не видел ВООБЩЕ и никак
 *  не мог об этом узнать. Теперь упёршийся в потолок список говорит словами. */
export function AdminMarketThemesSection({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [rows, setRows] = useState<MarketTheme[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () =>
    api
      .getMarketThemes()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const setHidden = async (id: string, hidden: boolean) => {
    setBusyId(id);
    try {
      await api.setMarketThemeHidden(id, hidden);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const columns: TableColumn<MarketTheme>[] = [
    {
      key: "name",
      label: t("views.admin.themes.nameCol"),
      sortable: true,
      render: (theme) => (
        <span style={{ color: theme.hidden ? "var(--text-3)" : undefined }}>
          {theme.name}
          {theme.hidden ? (
            <span
              style={{
                marginLeft: "var(--sp-2)",
                padding: "0 var(--sp-2)",
                borderRadius: "var(--r-pill)",
                background: "color-mix(in srgb, var(--danger) 12%, transparent)",
                color: "var(--danger)",
                fontSize: "var(--fs-caption)",
                fontWeight: "var(--fw-medium)",
              }}
            >
              {t("views.admin.themes.hiddenBadge")}
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "author", label: t("views.admin.themes.authorCol"), width: "160px", sortable: true },
    { key: "installs", label: t("views.admin.themes.installsCol"), width: "120px", numeric: true, sortable: true },
    {
      key: "action",
      label: t("views.admin.rows.action"),
      width: "190px",
      render: (theme) => (
        <Button variant="secondary" disabled={busyId === theme.id} onClick={() => void setHidden(theme.id, !theme.hidden)}>
          {t(theme.hidden ? "views.admin.themes.restore" : "views.admin.themes.hide")}
        </Button>
      ),
    },
  ];

  return (
    <Panel
      title={t("views.admin.themes.title")}
      action={rows ? <Counter shown={rows.length} total={rows.length} /> : null}
      flush
    >
      {/* Ошибка ДЕЙСТВИЯ видима и при загруженном списке: раньше setError из
          setHidden уходил в ветку, которая рендерится только при rows === null,
          и отказ сервера был молчаливым (ревизия 04.08). */}
      {error && rows !== null ? (
        <div style={{ margin: "0 var(--sp-2) var(--sp-2)", fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{error}</div>
      ) : null}
      {rows === null ? (
        <Loading error={error} />
      ) : (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(theme) => theme.id}
            ariaLabel={t("views.admin.themes.title")}
            empty={t("views.admin.themes.empty")}
            defaultSort={{ key: "installs", dir: "desc" }}
          />
          {rows.length >= THEMES_LIMIT ? <Note text={t("views.admin.limits.themesCeiling")} inset /> : null}
        </>
      )}
    </Panel>
  );
}

/** Рубильник публичных плейлистов (2026-07-17): обзор опубликованного +
 *  «Снять с публикации» (переключатель — ещё и запретить публиковать снова).
 *  Экспорт — для точечного теста без остального ContentTab.
 *
 *  Страницы КЛИЕНТСКИЕ (05.08): сервер отдаёт все публикации одним ответом, и
 *  раньше все они рисовались подряд — на паре сотен экран становился лентой без
 *  дна. Резать нужно на сервере (см. needsOutside), но пока хотя бы честно
 *  листается и говорится, сколько всего. */
export function AdminPublicPlaylistsSection({ api }: { api: MuzaApi }) {
  const { t, lang } = useT();
  const [rows, setRows] = useState<AdminPublicPlaylist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ban, setBan] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Сколько строк показывает таблица прямо сейчас — она же и сообщает. */
  const [shownNow, setShownNow] = useState(0);

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

  const total = rows?.length ?? 0;
  // ⚠️ СТРАНИЦЫ РЕЖЕТ ТАБЛИЦА, А НЕ МЫ. Здесь стояло `rows.slice(...)` до
  // сортировки, и клик по «Слушателей» сортировал ПЯТЬДЕСЯТ САМЫХ СВЕЖИХ
  // публикаций, выдавая их за самые слушаемые вообще. Это ровно та ложь, из-за
  // которой сортировку выключили в таблице пользователей (там данных на клиенте
  // нет физически) — но здесь весь массив уже в руках, и врать не обязано ничто.

  const columns: TableColumn<AdminPublicPlaylist>[] = [
    { key: "name", label: t("views.admin.publicPlaylists.nameCol"), sortable: true },
    { key: "ownerUsername", label: t("views.admin.publicPlaylists.ownerCol"), width: "160px", sortable: true },
    { key: "trackCount", label: t("views.admin.publicPlaylists.tracksCol"), width: "110px", numeric: true, sortable: true },
    { key: "followersCount", label: t("views.admin.publicPlaylists.followersCol"), width: "130px", numeric: true, sortable: true },
    {
      key: "publishedAt",
      label: t("views.admin.publicPlaylists.publishedCol"),
      width: "150px",
      numeric: true,
      sortable: true,
      render: (p) => dt(p.publishedAt, lang),
      sortValue: (p) => at(p.publishedAt),
    },
    {
      key: "action",
      label: t("views.admin.rows.action"),
      width: "200px",
      render: (p) => (
        <Button variant="secondary" disabled={busyId === p.id} onClick={() => void unpublish(p.id)}>
          {t("views.admin.publicPlaylists.unpublish")}
        </Button>
      ),
    },
  ];

  return (
    <Panel
      title={t("views.admin.publicPlaylists.title")}
      action={rows ? <Counter shown={shownNow} total={total} /> : null}
      flush
    >
      {rows === null ? (
        <Loading error={error} />
      ) : (
        <>
          {/* Тумблер стоит НАД таблицей и относится к любой строке: он меняет
              смысл кнопки «Снять с публикации» — с «убрать сейчас» на «убрать
              и больше не пускать».
              ⚠️ Подпись — НЕ <label>: Switch внутри него это <button>, а метка
              сама пересылает клик своему контролу — тумблер срабатывал бы
              дважды за один клик и оставался на месте. Поэтому по подписи
              щёлкаем руками. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              margin: "0 var(--sp-2) var(--sp-3)",
              fontSize: "var(--fs-caption)",
              color: "var(--text-2)",
            }}
          >
            <Switch checked={ban} onChange={setBan} label={t("views.admin.publicPlaylists.banToggle")} />
            <span onClick={() => setBan(!ban)} style={{ cursor: "pointer" }}>
              {t("views.admin.publicPlaylists.banToggle")}
            </span>
          </div>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            ariaLabel={t("views.admin.publicPlaylists.title")}
            empty={t("views.admin.publicPlaylists.empty")}
            pageSize={PLAYLISTS_PAGE}
            prevLabel={t("views.admin.pager.prev")}
            nextLabel={t("views.admin.pager.next")}
            pageLabel={(p: number, n: number) => t("views.admin.pager.pageOf", { page: p, pages: n })}
            // Счётчик в шапке панели обязан говорить про ТЕКУЩУЮ страницу, а её
            // теперь знает только таблица (страницы уехали туда вместе с
            // сортировкой — иначе сортировка врёт).
            onView={(v) => setShownNow(v.shown)}
          />
        </>
      )}
    </Panel>
  );
}

function HealthTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [hours, setHours] = useState(24);
  const { data, error, loading } = useAdminData<AdminHealth>(() => api.getAdminHealth(hours), [api, hours]);

  const recipeCols: TableColumn<AdminHealth["byRecipe"][number]>[] = [
    {
      key: "recipeVersion",
      label: t("views.admin.health.recipeCol"),
      sortable: true,
      render: (r) => `v${r.recipeVersion}${r.recipeVersion === data?.recipeVersion ? t("views.admin.health.currentSuffix") : ""}`,
      sortValue: (r) => r.recipeVersion,
      numeric: false,
    },
    { key: "reports", label: t("views.admin.health.reports"), width: "120px", numeric: true, sortable: true },
    { key: "ok", label: "OK", width: "100px", numeric: true, sortable: true },
    { key: "fail", label: "Fail", width: "100px", numeric: true, sortable: true },
    {
      key: "successRate",
      label: "Success",
      width: "120px",
      numeric: true,
      sortable: true,
      render: (r) => pct(r.successRate),
      sortValue: (r) => r.successRate ?? -1,
    },
  ];
  const appCols: TableColumn<AdminHealth["byApp"][number]>[] = [
    { key: "appVersion", label: t("views.admin.health.versionCol"), sortable: true },
    { key: "reports", label: t("views.admin.health.reports"), width: "120px", numeric: true, sortable: true },
    { key: "ok", label: "OK", width: "100px", numeric: true, sortable: true },
    { key: "fail", label: "Fail", width: "100px", numeric: true, sortable: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <div style={{ maxWidth: RANGE_TABS_MAX_W, flex: "1 1 auto" }}>
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
          <PanelLane>
            <Panel title={t("views.admin.sections.extraction")} style={{ flexBasis: PANEL_MIN_W }}>
              <Stats>
                <StatCard
                  label="Success-rate"
                  value={pct(data.totals.successRate)}
                  hint={`${data.totals.resolveOk} ok / ${data.totals.resolveFail} fail`}
                />
                <StatCard
                  label={t("views.admin.health.cacheHits")}
                  value={pct(data.totals.cacheHitRate)}
                  hint={t("views.admin.health.hitsSuffix", { count: data.totals.cacheHits })}
                />
                <StatCard
                  label={t("views.admin.health.reports")}
                  value={data.totals.reports}
                  hint={t("views.admin.health.attemptsSuffix", { count: data.totals.attempts })}
                />
              </Stats>
            </Panel>
            <Panel title={t("views.admin.sections.errorsByClass")} style={{ flexBasis: PANEL_MIN_W }}>
              <Stats>
                <StatCard label="403" value={data.totals.fail403} />
                <StatCard label="Bot-check" value={data.totals.failBot} />
                <StatCard label={t("views.admin.health.formatsLabel")} value={data.totals.failFormat} />
                <StatCard label={t("views.admin.health.other")} value={data.totals.failOther} />
              </Stats>
            </Panel>
          </PanelLane>
          <Panel title={t("views.admin.sections.byRecipeVersion")} flush>
            <Table
              columns={recipeCols}
              rows={data.byRecipe}
              rowKey={(r) => String(r.recipeVersion)}
              ariaLabel={t("views.admin.sections.byRecipeVersion")}
            />
            <Note text={t("views.admin.health.recipeNote", { version: data.recipeVersion })} inset />
          </Panel>
          <Panel
            title={t("views.admin.sections.byAppVersion")}
            action={<Counter shown={data.byApp.length} total={data.byApp.length} />}
            flush
          >
            <Table columns={appCols} rows={data.byApp} rowKey={(r) => r.appVersion} ariaLabel={t("views.admin.sections.byAppVersion")} />
          </Panel>
        </>
      )}
    </div>
  );
}

/** Экспорт — для точечного теста вкладки без остального экрана (тот же приём,
 *  что у AdminPublicPlaylistsSection). */
export function UsersTab({ api }: { api: MuzaApi }) {
  const { t, lang } = useT();
  // Выдача/снятие админки (2026-07-21, разворот решения 11.07): реальный рубеж —
  // сервер (guard'ы + запись роли только из БД); UI лишь дёргает эндпоинт.
  const [rev, setRev] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Поиск и страницы (04.08 — upgrade-list: «100 строк без того и другого»).
  // Поиск СЕРВЕРНЫЙ (ILIKE по нику): клиентский фильтр текущей страницы врал
  // бы — человек не нашёл бы того, кто на другой странице. Ввод дебаунсится,
  // смена запроса возвращает на первую страницу.
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(query.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const { data, error, loading } = useAdminData<AdminUsers>(
    () => api.getAdminUsers({ limit: USERS_PAGE, offset: page * USERS_PAGE, q: q || undefined }),
    [api, rev, q, page],
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / USERS_PAGE)) : 1;
  const toggleAdmin = async (u: AdminUsers["users"][number]) => {
    setBusyId(u.id);
    setActionError(null);
    try {
      await api.setAdminUser(u.id, !u.isAdmin);
      setRev((r) => r + 1);
    } catch (e) {
      // сервер не даёт снять права с самого себя — показываем его причину
      setActionError(e instanceof Error ? e.message : t("views.admin.users.adminToggleFailed"));
    } finally {
      setBusyId(null);
    }
  };

  // СОРТИРОВКА ТОЛЬКО НА ОДНОЙ СТРАНИЦЕ. Строки приезжают постранично, и
  // «по убыванию прослушиваний» отсортировало бы полсотни случайных человек,
  // выдав их за верхних, — та же ложь, из-за которой поиск сделали серверным.
  // Все поместились на страницу — сортировать честно, и она включается.
  const sortable = data !== null && data.total <= USERS_PAGE;
  const columns: TableColumn<AdminUsers["users"][number]>[] = [
    {
      key: "username",
      label: t("views.admin.users.userCol"),
      sortable,
      render: (u) => `${u.username}${u.isAdmin ? t("views.admin.users.adminSuffix") : ""}${u.hasEmail ? " · ✉" : ""}`,
      sortValue: (u) => u.username,
    },
    {
      key: "createdAt",
      label: t("views.admin.users.createdCol"),
      width: "140px",
      numeric: true,
      sortable,
      render: (u) => dt(u.createdAt, lang),
      sortValue: (u) => at(u.createdAt),
    },
    { key: "plays30d", label: t("views.admin.users.plays30dCol"), width: "150px", numeric: true, sortable },
    {
      key: "lastPlayAt",
      label: t("views.admin.users.lastCol"),
      width: "140px",
      numeric: true,
      sortable,
      render: (u) => dt(u.lastPlayAt, lang),
      sortValue: (u) => at(u.lastPlayAt),
    },
    {
      key: "isAdmin",
      label: t("views.admin.users.adminCol"),
      width: "110px",
      align: "center",
      // Кнопка прав — круглая иконка с подсказкой, а не полноразмерная Button:
      // строка с кнопкой в 40px вдвое выше строки с текстом, и полсотни таких
      // строк превращают страницу в простыню.
      render: (u) => (
        <IconButton
          icon={u.isAdmin ? "shield-off" : "shield"}
          size="sm"
          variant="surface"
          disabled={busyId === u.id}
          label={t(u.isAdmin ? "views.admin.users.revokeAdmin" : "views.admin.users.grantAdmin")}
          onClick={() => void toggleAdmin(u)}
          style={u.isAdmin ? { color: "var(--danger)" } : undefined}
        />
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", maxWidth: RANGE_TABS_MAX_W }}>
          <SearchInput value={query} onChange={setQuery} placeholder={t("views.admin.users.searchPlaceholder")} />
        </div>
        <BusyDot busy={loading && data !== null} />
        <span style={{ marginLeft: "auto", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
          {data ? t("views.admin.users.piiNote", { count: data.total }) : null}
        </span>
      </div>
      {actionError ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{actionError}</div> : null}
      {!data ? (
        <Loading error={error} />
      ) : (
        <Panel
          title={t("views.admin.tabs.users")}
          action={<Counter shown={data.users.length} total={data.total} />}
          flush
        >
          <Table
            columns={columns}
            rows={data.users}
            rowKey={(u) => u.id}
            ariaLabel={t("views.admin.tabs.users")}
            empty={t("views.admin.users.searchEmpty")}
          />
          {sortable ? null : <Note text={t("views.admin.users.sortOffNote")} inset />}
          <Pager page={page} pages={pages} onPage={setPage} />
        </Panel>
      )}
    </div>
  );
}

/** Окно диапазона (кусок C): один контрол на вкладки «Рост» и «Ошибки». */
function DaysTabs({ value, onChange, busy = false }: { value: number; onChange: (d: number) => void; busy?: boolean }) {
  const { t } = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
      <div style={{ maxWidth: RANGE_TABS_MAX_W, flex: "1 1 auto" }}>
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

/** Кусок C: метрики роста — посещения/регистрации/скачивания, графики свои
 *  (adminCharts, токены ДС, без чарт-библиотек — конвенция проекта). */
function GrowthTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [days, setDays] = useState(30);
  const [allAssets, setAllAssets] = useState(false);
  const { data, error, loading } = useAdminData<AdminGrowth>(() => api.getAdminGrowth(days), [api, days]);

  const assetCols: TableColumn<AdminGrowth["downloads"]["byAsset"][number]>[] = [
    { key: "asset", label: t("views.admin.growth.assetCol"), sortable: true },
    { key: "tag", label: t("views.admin.growth.tagCol"), width: "160px", sortable: true },
    { key: "count", label: t("views.admin.growth.countCol"), width: "140px", numeric: true, sortable: true },
  ];
  const assetsAll = data?.downloads.byAsset ?? [];
  // ⚠️ Здесь стоял `assetsAll.slice(0, ASSETS_PREVIEW)` ПЕРЕД таблицей, а у
  // таблицы — сортировка по скачиваниям убыванием. Получалось «десять файлов в
  // порядке сервера, отсортированные по скачиваниям» под шапкой со стрелкой
  // убывания: та же ложь, что и в публичных плейлистах. Режет теперь таблица,
  // после сортировки; «показать все» отменяет ограничение целиком.

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <DaysTabs value={days} onChange={setDays} busy={loading && data !== null} />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <Panel title={t("views.admin.growth.visits")}>
            <Stats>
              <StatCard
                label={t("views.admin.growth.visitsWindow")}
                value={sumOf(data.visits)}
                hint={t("views.admin.growth.visitsHint")}
              />
            </Stats>
            <div style={{ marginTop: "var(--sp-4)" }}>
              <SeriesChart points={data.visits} mode="line" ariaLabel={t("views.admin.growth.visits")} />
            </div>
            <Note text={t("views.admin.growth.visitsNote")} />
          </Panel>
          <Panel title={t("views.admin.growth.registrations")}>
            <Stats>
              <StatCard label={t("views.admin.growth.registrationsWindow")} value={sumOf(data.registrations)} />
            </Stats>
            <div style={{ marginTop: "var(--sp-4)" }}>
              <SeriesChart points={data.registrations} mode="bars" ariaLabel={t("views.admin.growth.registrations")} />
            </div>
          </Panel>
          <Panel title={t("views.admin.growth.downloads")}>
            <Stats>
              <StatCard label={t("views.admin.growth.downloadsTotal")} value={data.downloads.total} />
              <StatCard label={t("views.admin.growth.downloadsWindow")} value={sumOf(data.downloads.series)} />
            </Stats>
            <div style={{ marginTop: "var(--sp-4)" }}>
              <SeriesChart points={data.downloads.series} mode="bars" ariaLabel={t("views.admin.growth.downloads")} />
            </div>
            {assetsAll.length > 0 ? (
              <div style={{ marginTop: "var(--sp-4)" }}>
                {/* счётчик и «показать все» относятся к таблице файлов, а не ко
                    всей панели «Скачивания», поэтому стоят над ней, а не в шапке */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "var(--sp-3)",
                    marginBottom: "var(--sp-2)",
                  }}
                >
                  <Counter shown={allAssets ? assetsAll.length : Math.min(ASSETS_PREVIEW, assetsAll.length)} total={assetsAll.length} />
                  {assetsAll.length > ASSETS_PREVIEW ? (
                    <ExpandButton open={allAssets} total={assetsAll.length} onToggle={() => setAllAssets((v) => !v)} />
                  ) : null}
                </div>
                <Table
                  columns={assetCols}
                  rows={assetsAll}
                  rowKey={(a) => `${a.tag}:${a.asset}`}
                  ariaLabel={t("views.admin.growth.downloads")}
                  defaultSort={{ key: "count", dir: "desc" }}
                  pageSize={allAssets ? 0 : ASSETS_PREVIEW}
                  prevLabel={t("views.admin.pager.prev")}
                  nextLabel={t("views.admin.pager.next")}
                  pageLabel={(p: number, n: number) => t("views.admin.pager.pageOf", { page: p, pages: n })}
                />
              </div>
            ) : null}
            <Note text={t("views.admin.growth.downloadsNote")} />
          </Panel>
        </>
      )}
    </div>
  );
}

/** Раскрываемая строка одной группы ошибок: шапка (класс · текст, счётчик,
 *  дата) кликается и разворачивает детали + кнопку удаления группы.
 *
 *  Строка — Button variant="ghost", растянутая на всю ширину: это ровно её
 *  поведение (прозрачная, подсвечивается под курсором, жмётся), и своей
 *  кнопки для этого заводить не нужно. Таблицей группы не сделать: у ошибки
 *  длинный текст и детали, которым нужна вторая строка. */
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
      <span style={{ flex: `0 0 ${DETAIL_LABEL_W}px`, color: "var(--text-3)" }}>{label}</span>
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
    <div style={{ background: "var(--surface-3)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
      <Button
        variant="ghost"
        onClick={onToggle}
        style={{
          width: "100%",
          padding: "0 var(--sp-3)",
          borderRadius: "var(--r-sm)",
          color: "var(--text-1)",
          fontWeight: "var(--fw-regular)",
        }}
      >
        <Icon
          name="chevron-right"
          size={ROW_ICON}
          color="var(--text-3)"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform var(--dur-state-move) var(--ease-in-out)" }}
        />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
          {kindName(group.kind)} · {group.message || "—"}
        </span>
        <span style={{ flex: "none", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{group.count}</span>
        <span style={{ flex: "none", color: "var(--text-3)", fontSize: "var(--fs-caption)", whiteSpace: "nowrap" }}>
          {dt(group.lastSeen, lang)}
        </span>
      </Button>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", padding: "0 var(--sp-3) var(--sp-3)" }}>
          {detailRow(t("views.admin.errors.detailMessage"), group.message || "—")}
          {detailRow(t("views.admin.errors.detailVersions"), group.appVersions.join(", ") || "—")}
          {detailRow(t("views.admin.errors.detailLast"), dt(group.lastSeen, lang))}
          {detailRow(t("views.admin.errors.detailHash"), group.stackHash, true)}
          <Button
            variant="secondary"
            icon="trash-2"
            disabled={busy}
            onClick={onDelete}
            style={{ alignSelf: "flex-start", color: "var(--danger)" }}
          >
            {t("views.admin.errors.deleteOne")}
          </Button>
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
  const [allApps, setAllApps] = useState(false);
  const [order, setOrder] = useState<"count" | "last">("count");
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
  // Версий приложения бывает много; сразу показываем свежие, остальные — по
  // кнопке. Раньше хвост просто отрезался, и по старой версии было не отфильтровать.
  const appList = data ? (allApps ? data.byApp : data.byApp.slice(0, APP_FILTER_PREVIEW)) : [];
  const appItems = data
    ? [
        { key: "all", label: t("views.admin.errors.all") },
        ...appList.map((a) => ({ key: a.appVersion, label: `${a.appVersion} · ${a.count}` })),
        ...(appVersion !== "all" && !appList.some((a) => a.appVersion === appVersion)
          ? [{ key: appVersion, label: `${appVersion} · 0` }]
          : []),
      ]
    : [];
  // Список групп — не таблица (у ошибки длинный текст и раскрывающиеся
  // детали), поэтому сортировка вынесена отдельным переключателем: «чего
  // больше всего» и «что прилетело только что» — два разных вопроса.
  const top = data ? [...data.top].sort((a, b) => (order === "count" ? b.count - a.count : at(b.lastSeen) - at(a.lastSeen))) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <DaysTabs value={days} onChange={setDays} busy={loading && data !== null} />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <Panel>
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
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={doClear}
                        style={{ background: "var(--danger)", color: "var(--text-on-accent)" }}
                      >
                        {t("views.admin.errors.clearYes")}
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setConfirmClear(false)}>
                        {t("common.cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" icon="trash-2" onClick={() => setConfirmClear(true)} style={{ color: "var(--danger)" }}>
                      {t("views.admin.errors.clear")}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </Panel>
          {data.byKind.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <Tabs items={kindItems} value={kind} onChange={setKind} wrap />
              {data.byApp.length > 1 ? (
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Tabs items={appItems} value={appVersion} onChange={setAppVersion} wrap />
                  </div>
                  {data.byApp.length > APP_FILTER_PREVIEW ? (
                    <Button variant="ghost" onClick={() => setAllApps((v) => !v)}>
                      {allApps ? t("views.admin.limits.collapse") : t("views.admin.errors.appFilterAll", { count: data.byApp.length })}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <Panel title={t("views.admin.errors.series")}>
            <SeriesChart points={data.series} mode="bars" color="var(--danger)" ariaLabel={t("views.admin.errors.series")} />
          </Panel>
          <Panel
            title={t("views.admin.errors.topTitle")}
            action={
              top.length > 0 ? (
                <>
                  {/* сервер отдаёт только верхушку (жёстко 20 групп), а сколько
                      их всего в окне — знает totals.distinct: говорим обе цифры */}
                  <Counter shown={top.length} total={data.totals.distinct} />
                  <Tabs
                    items={[
                      { key: "count", label: t("views.admin.errors.sortByCount") },
                      { key: "last", label: t("views.admin.errors.sortByLast") },
                    ]}
                    value={order}
                    onChange={(k: string) => setOrder(k as "count" | "last")}
                  />
                </>
              ) : null
            }
          >
            {top.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: "var(--fs-body)" }}>{t("views.admin.errors.emptyTop")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                {top.map((g) => (
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
          </Panel>
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
    // на всю доступную ширину (жалоба 2026-07-20 «бар не растянут»):
    // прежний maxWidth 860 оставлял пустые поля на широких мониторах
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6)", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <Icon name="shield" size={TITLE_ICON} color="var(--accent-text)" />
        {/* Заголовок экрана — Golos 700, как везде (правило одного
            display-момента, редизайн 04.08 — см. HomeFeed). */}
        <h1
          style={{
            margin: 0,
            fontWeight: "var(--fw-bold)",
            fontSize: "var(--fs-h1)",
            letterSpacing: "var(--ls-h1)",
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
