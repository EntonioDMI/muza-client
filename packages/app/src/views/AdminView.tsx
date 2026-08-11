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
  AdminPublicPlaylists,
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
 *  Section и Row умерли: их работу делают Panel и Table.
 *
 *  ВТОРОЙ ЗАХОД 06.08 — три вещи, до которых первый не дошёл:
 *
 *  1. ОБРЕЗАНИЕ БЕЗ ОБЩЕГО ЧИСЛА. «Показаны первые 20» говорит, что список
 *     неполный, но не говорит, чего человек не видит. Где общее число есть
 *     (новое в каталоге — это верхушка всего каталога, его размер лежит в
 *     coverage.tracks) — теперь «показаны 20 из 3412». Где сервер общего числа
 *     не считает ВООБЩЕ (топы за 14 дней) — так и написано словами, а не
 *     придумано.
 *  2. КОЛОНКИ НЕ ВЛЕЗАЛИ. Пиксельные ширины набирались на глаз и в двух
 *     таблицах перевешивали доступное поле — таблица уезжала в собственную
 *     горизонтальную прокрутку прямо на минимальном окне. Ширины сведены в
 *     общий словарь (COL_*), суммы проверяет сторож AdminView.layout.test.tsx.
 *  3. ТРИ СОСТОЯНИЯ. У половины таблиц не было текста «данных нет» — пустая
 *     выдача рисовалась пустой строкой под шапкой и читалась как поломка. У
 *     отказа сервера не было выхода: красная строка и всё. Теперь у каждой
 *     вкладки есть загрузка, объяснимый отказ с кнопкой «запросить заново» и
 *     свой текст пустоты у каждой таблицы. */

/** Минимальная ширина плитки числа. Уже — и подпись вроде «Прослушиваний
 *  (30д)» ломается на три строки, а число перестаёт читаться первым. */
const STAT_MIN_W = 150;

/** СЛОВАРЬ ШИРИН КОЛОНОК. Приложение не открывается уже 1024px (tauri.conf,
 *  minWidth), и на этом окне таблице внутри карточки остаётся примерно 660px —
 *  замер записан в шапке Table (@muza/ui). Table держит нижнюю границу ширины
 *  (сумма пиксельных ширин + 160px на каждую колонку без ширины) и, не влезая,
 *  уезжает в свою горизонтальную прокрутку. Прокрутка — уже неудобство, поэтому
 *  суммы держим НИЖЕ поля; сторож AdminView.layout.test.tsx читает minWidth
 *  живых таблиц и не даёт им перевалить за 660.
 *
 *  Значения подобраны под подпись шапки: в неё входит текст + стрелка сортировки
 *  (14px) + поля ячейки (2×12px). Подпись длиннее переносится на вторую строку —
 *  это нормально, шапка не обрезается. */
const COL_NUM = 92;
/** Число с длинной подписью: «Прослушиваний (30д)», «Скачиваний». */
const COL_NUM_WIDE = 116;
/** Дата вида «10.07, 03:00».
 *
 *  ⚠️ ЗАМЕР, А НЕ ГЛАЗОМЕР (11.08.2026, жалоба владельца «данные обрезаются,
 *  вижу только часть»). Было 104px — при полях ячейки 2×--sp-3 это 80px под
 *  содержимое, тогда как сама строка «21.07, 12:34» в Golos Text 15px с
 *  tabular-nums занимает 93.3px (замерено canvas.measureText по реальному
 *  файлу шрифта). Колонка была уже своего содержимого НА ЛЮБОМ окне, и дата
 *  обрезалась многоточием всегда, а не только на минимальном.
 *
 *  128px = 93.3 + 24 поля + 10 запаса. Запас нужен: длина строки фиксирована
 *  (tabular-nums), но локаль может дать другой разделитель.
 *
 *  ⚠️ Растянуть колонку на широком окне НЕЛЬЗЯ: раскладка фиксированная, весь
 *  излишек уходит единственной колонке БЕЗ ширины (ник, имя плейлиста). Поэтому
 *  ширина обязана быть верной сама по себе, а не «дотянуться потом». */
const COL_DATE = 128;
/** Ник, автор, имя релиза — обрезается многоточием, длина некритична.
 *  96, а не 104: 8px отданы дате в таблице публикаций, где сумма ближе всего
 *  к потолку поля (сторож — AdminView.layout.test.tsx). */
const COL_NAME = 96;
/** Колонка действия строки: круглая кнопка (36px) плюс поля ячейки; ширина
 *  задана подписью шапки «Действие», а не кнопкой. */
const COL_ACTION = 84;

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

/** Сколько тем просим у витрины. 100 — потолок сервера (limit клампится 1..100
 *  в market.controller), и просить меньше незачем: модератору нужен весь список,
 *  а не первая полусотня. */
const THEMES_LIMIT = 100;

/** Сколько витрина отдаёт, НЕ ЗНАЯ про limit (сервер ≤0.1.5 или старый
 *  @muza/api-client). Список ровно такой длины мог упереться и в этот потолок,
 *  и в наш — предупреждение «это не все темы» показываем на нём, иначе ровно
 *  полсотни тем выдавались бы за полный список.
 *
 *  ⚠️ ИМЕННО РАВЕНСТВО, А НЕ `>=`. С `>= 50` предупреждение вылезало на любой
 *  витрине от полусотни тем — включая ту, где сервер честно уважил `limit=100`
 *  и отдал все шестьдесят. Хуже: в диапазоне 51–99 оно ошибочно ВСЕГДА — сервер,
 *  не знающий про `limit`, столько строк вернуть физически не может (у него
 *  потолок 50), а знающий на этой длине ни во что не упёрся. */
const THEMES_SERVER_DEFAULT = 50;

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
/** ⚠️ 24-ЧАСОВОЙ ФОРМАТ ПРИБИТ ЯВНО (11.08.2026, вторая жалоба владельца
 *  «половина информации обрезается»).
 *
 *  Без `hour12: false` длина строки зависит от локали, и колонка не может быть
 *  верной сразу для обеих:
 *      ru → «11.08, 13:23»       — 12 символов
 *      en → «08/11, 01:23 PM»    — 15 символов
 *  Утренняя правка ширины мерила русскую строку, и на английском интерфейсе
 *  колонка переполнилась снова — тем же дефектом, только на четверть шире.
 *
 *  Прибиваем формат, а не растим колонку под худший случай: в админской
 *  таблице времена стоят СТОЛБИКОМ и сравниваются глазом, а «01:23 PM» рядом с
 *  «11:47 AM» сравнивается хуже, чем «13:23» рядом с «11:47». Плюс любая новая
 *  локаль теперь не сможет молча сломать раскладку. */
const dt = (iso: string | null, lang: Lang) =>
  iso === null
    ? "—"
    : new Date(iso).toLocaleString(lang, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
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
function useAdminData<T>(
  load: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string | null; loading: boolean; retry: () => void } {
  const { t } = useT();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Счётчик попыток: отказ сервера теперь не тупик — кнопка «Запросить заново»
  // просто крутит его, и эффект уходит на второй круг с теми же аргументами.
  const [attempt, setAttempt] = useState(0);
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
    // длина массива постоянна для каждой точки вызова — правило хуков цело
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return { data, error, loading, retry: () => setAttempt((n) => n + 1) };
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

/** Два из трёх состояний вкладки: пока грузим и когда сервер не ответил.
 *  Третье (данные пришли, но их ноль) живёт в каждой таблице отдельным текстом —
 *  «пусто» у источников и у ошибок значит разное.
 *
 *  ОТКАЗ НЕ КРАСНЫЙ И НЕ ТУПИК. Раньше здесь была одна строка цвета --danger с
 *  сырым текстом вроде «Failed to fetch»: экран выглядел сломанным, и выйти из
 *  этого состояния можно было только сменой вкладки. Теперь сверху — что
 *  случилось обычными словами, ниже мелким — сырой ответ сервера (он админу
 *  полезен), и кнопка, которая повторяет тот же запрос. */
function Loading({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  const { t } = useT();
  if (error === null) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          padding: "var(--sp-6) 0",
          color: "var(--text-3)",
          fontSize: "var(--fs-body)",
        }}
      >
        <Spinner size={ROW_ICON} color="var(--text-3)" />
        {t("common.loading")}
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "var(--sp-2)",
        padding: "var(--sp-5) 0",
      }}
    >
      <span style={{ fontSize: "var(--fs-body)", color: "var(--text-1)" }}>{t("views.admin.state.errorTitle")}</span>
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("views.admin.state.errorHint")}</span>
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", wordBreak: "break-word" }}>{error}</span>
      {onRetry ? (
        <Button variant="secondary" icon="rotate-cw" onClick={onRetry} style={{ marginTop: "var(--sp-1)" }}>
          {t("views.admin.state.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/** Полоса «на экране старое» (06.08). `Loading` показывается только пока данных
 *  НЕТ вовсе — а провалившаяся ПЕРЕЧИТКА (переключили окно 7→30, сняли
 *  публикацию, нажали «заново») оставляла прежние цифры на экране молча: ни
 *  ошибки, ни спиннера, ни признака, что показанное относится к другому запросу.
 *  Админ принимал решения по устаревшим данным и не имел повода усомниться. */
function StaleNote({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useT();
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--sp-2)",
        margin: "0 0 var(--sp-3)",
        padding: "var(--sp-2) var(--sp-3)",
        borderRadius: "var(--r-sm)",
        background: "var(--fill-2)",
        fontSize: "var(--fs-caption)",
        color: "var(--text-2)",
      }}
    >
      <span>{t("views.admin.state.staleTitle")}</span>
      <span style={{ color: "var(--text-3)", wordBreak: "break-word" }}>{error}</span>
      <Button variant="ghost" icon="rotate-cw" onClick={onRetry} style={{ marginLeft: "auto" }}>
        {t("views.admin.state.retry")}
      </Button>
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
  // Пустой список не считает сам себя: «Показано: 0» рядом с текстом «источников
  // пока нет» — шум, а на первый взгляд ещё и похоже на сбой счётчика.
  if (total === 0) return null;
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

/** Счётчик, который молчит, когда знаменателя нет: пустой список ничего не
 *  считает, а список без знаменателя объясняется отдельной подписью под
 *  таблицей — врать «показано 20» (читается как «это всё») он не станет. */
function TailCounter({ shown, total }: { shown: number; total: number | null }) {
  if (shown === 0 || total === null) return null;
  return <Counter shown={shown} total={total} />;
}

/** Знаменатель для подписи под обрезанным списком — или null, если его нет.
 *
 *  Сервер ≥06.08 присылает «сколько было бы без потолка» (AdminContent.totals,
 *  AdminErrors.topTotal). Сервер постарше их не считает — и тогда знаменателя
 *  действительно нет: список упёрся в потолок, а что за потолком, никто не знает.
 *
 *  ⚠️ РАЗЛИЧИТЕЛЬ — ЭТО `null`, А НЕ АРИФМЕТИКА. Здесь стояла эвристика «длина
 *  ровно в потолок и знаменатель ей равен → знаменателя нет». Она не отличала
 *  «сервер не прислал» от «сервер прислал, и вышло ровно 20»: у полного топа из
 *  двадцати экран печатал «сервер не считает, сколько их всего» — при том что
 *  сервер именно это и посчитал. Молчание сервера теперь доезжает сюда как
 *  `null` (см. http.ts), и гадать не надо. */
function denominator(total: number | null | undefined): number | null {
  return total ?? null;
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
  const { data, error, retry } = useAdminData<AdminOverview>(() => api.getAdminOverview(), [api]);
  if (!data) return <Loading error={error} onRetry={retry} />;
  return (
    <>
      {error ? <StaleNote error={error} onRetry={retry} /> : null}
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
    </>
  );
}

function ContentTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const { data, error, retry } = useAdminData<AdminContent>(() => api.getAdminContent(), [api]);
  if (!data) return <Loading error={error} onRetry={retry} />;

  const sourceCols: TableColumn<AdminContent["sourcesByProvider"][number]>[] = [
    {
      key: "provider",
      label: t("views.admin.rows.providerKind"),
      sortable: true,
      render: (s) => `${s.provider} · ${s.kind}`,
      sortValue: (s) => `${s.provider} ${s.kind}`,
    },
    { key: "count", label: t("views.admin.rows.total"), width: `${COL_NUM}px`, numeric: true, sortable: true },
    { key: "dead", label: t("views.admin.rows.dead"), width: `${COL_NUM}px`, numeric: true, sortable: true },
  ];
  const trackCols: TableColumn<AdminContent["topTracks"][number]>[] = [
    {
      key: "track",
      label: t("views.admin.rows.track"),
      sortable: true,
      render: (r) => `${r.track.artist} — ${r.track.title}`,
      sortValue: (r) => `${r.track.artist} ${r.track.title}`,
    },
    { key: "plays", label: t("views.admin.rows.plays"), width: `${COL_NUM_WIDE}px`, numeric: true, sortable: true },
  ];
  const artistCols: TableColumn<AdminContent["topArtists"][number]>[] = [
    { key: "artist", label: t("views.admin.rows.artist"), sortable: true },
    { key: "plays", label: t("views.admin.rows.plays"), width: `${COL_NUM_WIDE}px`, numeric: true, sortable: true },
  ];
  // Знаменателя может не быть вовсе — см. denominator: `null` приезжает от
  // сервера постарше и означает «столько, сколько всего, он не считает».
  const topTracksShown = data.topTracks.length;
  const topArtistsShown = data.topArtists.length;
  const topTracksTotal = denominator(data.totals?.topTracks);
  const topArtistsTotal = denominator(data.totals?.topArtists);
  const recentTotal = data.totals?.recentTracks;

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
      {error ? <StaleNote error={error} onRetry={retry} /> : null}
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
          empty={t("views.admin.empty.sources")}
        />
      </Panel>
      {/* ТРИ ОБРЕЗАННЫХ СПИСКА, ОДНА ПОДПИСЬ. Сервер режет каждый по `limit`
          (по умолчанию 20) и с 06.08 присылает знаменатели — сколько строк было
          бы без потолка. Есть знаменатель → «показаны 20 из 137»; сервер
          постарше его не считает → подпись прямо говорит, что общего числа нет,
          вместо того чтобы выдать «20 из 20» за полный список. */}
      <Panel title={t("views.admin.sections.topTracks")} action={<TailCounter shown={topTracksShown} total={topTracksTotal} />} flush>
        <Table
          columns={trackCols}
          rows={data.topTracks}
          rowKey={(r) => r.track.id}
          ariaLabel={t("views.admin.sections.topTracks")}
          empty={t("views.admin.empty.topTracks")}
        />
        {topTracksShown > 0 && topTracksTotal === null ? (
          <Note text={t("views.admin.limits.topOnly", { count: topTracksShown })} inset />
        ) : null}
      </Panel>
      <Panel title={t("views.admin.sections.topArtists")} action={<TailCounter shown={topArtistsShown} total={topArtistsTotal} />} flush>
        <Table
          columns={artistCols}
          rows={data.topArtists}
          rowKey={(r) => r.artist}
          ariaLabel={t("views.admin.sections.topArtists")}
          empty={t("views.admin.empty.topArtists")}
        />
        {topArtistsShown > 0 && topArtistsTotal === null ? (
          <Note text={t("views.admin.limits.topOnly", { count: topArtistsShown })} inset />
        ) : null}
      </Panel>
      {/* У «нового в каталоге» знаменатель есть всегда: это верхушка всего
          каталога, а его размер приезжает тем же ответом (coverage.tracks) даже
          от сервера постарше. */}
      <Panel
        title={t("views.admin.sections.newInCatalog")}
        action={<Counter shown={data.recentTracks.length} total={Math.max(recentTotal ?? 0, data.coverage.tracks, data.recentTracks.length)} />}
        flush
      >
        <Table
          columns={recentCols}
          rows={data.recentTracks}
          rowKey={(tr) => tr.id}
          ariaLabel={t("views.admin.sections.newInCatalog")}
          empty={t("views.admin.empty.recentTracks")}
        />
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
      .getMarketThemes({ limit: THEMES_LIMIT })
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  /** Повтор после отказа: гасим прошлую ошибку и возвращаем блок в «грузим», а
   *  то кнопка нажималась, а экран не менялся, пока сервер думает. */
  const retry = () => {
    setError(null);
    setRows(null);
    void load();
  };

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
    { key: "author", label: t("views.admin.themes.authorCol"), width: `${COL_NAME}px`, sortable: true },
    { key: "installs", label: t("views.admin.themes.installsCol"), width: `${COL_NUM}px`, numeric: true, sortable: true },
    {
      key: "action",
      label: t("views.admin.rows.action"),
      width: `${COL_ACTION}px`,
      align: "center",
      // Круглая кнопка с подсказкой, а не Button с текстом — тот же приём и та
      // же причина, что в таблице пользователей: «Вернуть в витрину» словами
      // занимало 190px из шестисот с небольшим, и на имя темы не оставалось
      // ничего. Название действия никуда не делось — оно в подсказке и в
      // aria-label, то есть доступно и мыши, и скринридеру.
      render: (theme) => (
        <IconButton
          icon={theme.hidden ? "eye" : "eye-off"}
          size="sm"
          variant="surface"
          disabled={busyId === theme.id}
          label={t(theme.hidden ? "views.admin.themes.restore" : "views.admin.themes.hide")}
          onClick={() => void setHidden(theme.id, !theme.hidden)}
          style={theme.hidden ? undefined : { color: "var(--danger)" }}
        />
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
        <Loading error={error} onRetry={retry} />
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
          {rows.length === THEMES_SERVER_DEFAULT || rows.length >= THEMES_LIMIT ? (
            <Note text={t("views.admin.limits.themesCeiling")} inset />
          ) : null}
        </>
      )}
    </Panel>
  );
}

/** Одна форма ответа на две: страница `{total, items}` от свежего сервера и
 *  голый массив от прежнего контракта. */
type PlaylistPage = { total: number; items: AdminPublicPlaylist[]; serverPaged: boolean };

/** ⚠️ ФОРМА ОТВЕТА СМЕНИЛАСЬ НА ХОДУ, И РАЗЛИЧИТЕЛЬ ЗДЕСЬ НЕ ТИП ЗНАЧЕНИЯ.
 *  Серверную страницу публикаций вводили в ту же смену: до неё
 *  `getAdminPublicPlaylists()` отдавал голый массив (сервер присылал ВСЕ
 *  публикации разом), после — `{total, limit, offset, items}`.
 *
 *  Первая версия смотрела на `Array.isArray(res)` — и промахивалась мимо самого
 *  вероятного случая: свежий клиент рядом с сервером ≤0.1.5. Объект приходит и
 *  там, просто сервер `limit`/`offset` не понял и вернул весь список. Экран
 *  рисовал листалку «стр. 1 из 2», щёлкал номер и показывал те же шестьдесят
 *  строк, а сортировку выключал с подписью, которую сам же опровергал.
 *
 *  Различитель — `limit`: сервер, который резал, обязан сказать, по сколько. Нет
 *  числа → страницы режет таблица, и сортировка честна (весь список в руках). */
const asPlaylistPage = (res: AdminPublicPlaylist[] | AdminPublicPlaylists): PlaylistPage => {
  if (Array.isArray(res)) return { total: res.length, items: res, serverPaged: false };
  const items = res.items ?? [];
  // Второй признак — по факту, а не по словам: пришло больше страницы, значит
  // сервер её не резал, что бы он про себя ни сообщил.
  const serverPaged = res.limit !== null && res.limit !== undefined && items.length <= PLAYLISTS_PAGE;
  return { total: serverPaged ? (res.total ?? items.length) : items.length, items, serverPaged };
};

/** Рубильник публичных плейлистов (2026-07-17): обзор опубликованного +
 *  «Снять с публикации» (переключатель — ещё и запретить публиковать снова).
 *  Экспорт — для точечного теста без остального ContentTab.
 *
 *  СТРАНИЦЫ ТЕПЕРЬ СЕРВЕРНЫЕ (06.08, вслед за контрактом). Раньше сервер отдавал
 *  все публикации одним ответом, и резать приходилось на клиенте. Сервер режет —
 *  значит, на клиенте лежит только текущая страница, и сортировка по ней соврала
 *  бы ровно так же, как в таблице пользователей: «пятьдесят самых свежих» под
 *  видом «самых слушаемых». Поэтому сортировка включается только когда всё
 *  поместилось на одну страницу. Если рядом окажется старый api-client (голый
 *  массив) — весь список в руках, страницы режет таблица, сортировка честна
 *  всегда. */
export function AdminPublicPlaylistsSection({ api }: { api: MuzaApi }) {
  const { t, lang } = useT();
  const [page, setPage] = useState(0);
  const [rev, setRev] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ban, setBan] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Сколько строк показывает таблица прямо сейчас — она же и сообщает. */
  const [shownNow, setShownNow] = useState(0);

  const {
    data,
    error,
    retry,
  } = useAdminData<PlaylistPage>(
    () =>
      Promise.resolve(api.getAdminPublicPlaylists({ limit: PLAYLISTS_PAGE, offset: page * PLAYLISTS_PAGE })).then(
        asPlaylistPage,
      ),
    [api, page, rev],
  );

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PLAYLISTS_PAGE));
  const sortable = data !== null && (!data.serverPaged || data.total <= PLAYLISTS_PAGE);

  const unpublish = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await api.unpublishAdminPlaylist(id, ban);
      // сняли последнюю строку страницы — шагаем назад, иначе перечитка вернёт
      // пустую страницу и экран прикинется «ничего не опубликовано»
      if (data !== null && data.serverPaged && data.items.length === 1 && page > 0) setPage(page - 1);
      else setRev((n) => n + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  // ⚠️ ШЕСТЬ КОЛОНОК В ПОЛЕ 660px — САМАЯ ТЕСНАЯ ТАБЛИЦА ЭКРАНА. До 06.08 сумма
  // ширин была 910px при поле 660: таблица гарантированно уезжала в свою
  // горизонтальную прокрутку прямо на минимальном окне, а «Снять с публикации»
  // словами съедало 200px из этой суммы. Ширины — из общего словаря COL_*,
  // действие — круглая кнопка; сумма 636px, и сторож layout-теста её стережёт.
  const columns: TableColumn<AdminPublicPlaylist>[] = [
    { key: "name", label: t("views.admin.publicPlaylists.nameCol"), sortable },
    { key: "ownerUsername", label: t("views.admin.publicPlaylists.ownerCol"), width: `${COL_NAME}px`, sortable },
    { key: "trackCount", label: t("views.admin.publicPlaylists.tracksCol"), width: `${COL_NUM}px`, numeric: true, sortable },
    {
      key: "followersCount",
      label: t("views.admin.publicPlaylists.followersCol"),
      width: `${COL_NUM}px`,
      numeric: true,
      sortable,
    },
    {
      key: "publishedAt",
      label: t("views.admin.publicPlaylists.publishedCol"),
      width: `${COL_DATE}px`,
      numeric: true,
      sortable,
      render: (p) => dt(p.publishedAt, lang),
      sortValue: (p) => at(p.publishedAt),
    },
    {
      key: "action",
      label: t("views.admin.rows.action"),
      width: `${COL_ACTION}px`,
      align: "center",
      render: (p) => (
        <IconButton
          icon="eye-off"
          size="sm"
          variant="surface"
          disabled={busyId === p.id}
          label={t("views.admin.publicPlaylists.unpublish")}
          onClick={() => void unpublish(p.id)}
          style={{ color: "var(--danger)" }}
        />
      ),
    },
  ];

  return (
    <Panel
      title={t("views.admin.publicPlaylists.title")}
      action={data ? <Counter shown={shownNow} total={total} /> : null}
      flush
    >
      {data === null ? (
        <Loading error={error} onRetry={retry} />
      ) : (
        <>
          {error ? <StaleNote error={error} onRetry={retry} /> : null}
          {/* Ошибка ДЕЙСТВИЯ при загруженном списке — та же дыра, что чинили у
              тем 04.08: отказ «снять с публикации» уходил в ветку «списка ещё
              нет» и не показывался вовсе. */}
          {actionError ? (
            <div style={{ margin: "0 var(--sp-2) var(--sp-2)", fontSize: "var(--fs-caption)", color: "var(--danger)" }}>
              {actionError}
            </div>
          ) : null}
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
            rows={data.items}
            rowKey={(p) => p.id}
            ariaLabel={t("views.admin.publicPlaylists.title")}
            empty={t("views.admin.publicPlaylists.empty")}
            // Страницы режет ТОТ, У КОГО ВЕСЬ СПИСОК. Режет сервер — таблице
            // резать нечего (pageSize 0) и листалка своя, внешняя; отдал всё
            // массивом — режет таблица, обязательно ПОСЛЕ сортировки.
            pageSize={data.serverPaged ? 0 : PLAYLISTS_PAGE}
            prevLabel={t("views.admin.pager.prev")}
            nextLabel={t("views.admin.pager.next")}
            pageLabel={(p: number, n: number) => t("views.admin.pager.pageOf", { page: p, pages: n })}
            // Счётчик в шапке панели обязан говорить про ТЕКУЩУЮ страницу — при
            // клиентской нарезке её знает только таблица.
            onView={(v) => setShownNow(v.shown)}
          />
          {sortable ? null : <Note text={t("views.admin.users.sortOffNote")} inset />}
          {data.serverPaged ? <Pager page={page} pages={pages} onPage={setPage} /> : null}
        </>
      )}
    </Panel>
  );
}

function HealthTab({ api }: { api: MuzaApi }) {
  const { t } = useT();
  const [hours, setHours] = useState(24);
  const { data, error, loading, retry } = useAdminData<AdminHealth>(() => api.getAdminHealth(hours), [api, hours]);

  const recipeCols: TableColumn<AdminHealth["byRecipe"][number]>[] = [
    {
      key: "recipeVersion",
      label: t("views.admin.health.recipeCol"),
      sortable: true,
      render: (r) => `v${r.recipeVersion}${r.recipeVersion === data?.recipeVersion ? t("views.admin.health.currentSuffix") : ""}`,
      sortValue: (r) => r.recipeVersion,
      numeric: false,
    },
    { key: "reports", label: t("views.admin.health.reports"), width: `${COL_NUM}px`, numeric: true, sortable: true },
    { key: "ok", label: "OK", width: `${COL_NUM}px`, numeric: true, sortable: true },
    { key: "fail", label: "Fail", width: `${COL_NUM}px`, numeric: true, sortable: true },
    {
      key: "successRate",
      label: "Success",
      width: `${COL_NUM}px`,
      numeric: true,
      sortable: true,
      render: (r) => pct(r.successRate),
      sortValue: (r) => r.successRate ?? -1,
    },
  ];
  const appCols: TableColumn<AdminHealth["byApp"][number]>[] = [
    { key: "appVersion", label: t("views.admin.health.versionCol"), sortable: true },
    { key: "reports", label: t("views.admin.health.reports"), width: `${COL_NUM}px`, numeric: true, sortable: true },
    { key: "ok", label: "OK", width: `${COL_NUM}px`, numeric: true, sortable: true },
    { key: "fail", label: "Fail", width: `${COL_NUM}px`, numeric: true, sortable: true },
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
      {data && error ? <StaleNote error={error} onRetry={retry} /> : null}
      {!data ? (
        <Loading error={error} onRetry={retry} />
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
          {/* Обе разбивки сервер отдаёт ЦЕЛИКОМ (GROUP BY без LIMIT), поэтому
              счётчик здесь честно говорит «показано N» — это и есть всё. */}
          <Panel
            title={t("views.admin.sections.byRecipeVersion")}
            action={<Counter shown={data.byRecipe.length} total={data.byRecipe.length} />}
            flush
          >
            <Table
              columns={recipeCols}
              rows={data.byRecipe}
              rowKey={(r) => String(r.recipeVersion)}
              ariaLabel={t("views.admin.sections.byRecipeVersion")}
              empty={t("views.admin.empty.reports")}
            />
            <Note text={t("views.admin.health.recipeNote", { version: data.recipeVersion })} inset />
          </Panel>
          <Panel
            title={t("views.admin.sections.byAppVersion")}
            action={<Counter shown={data.byApp.length} total={data.byApp.length} />}
            flush
          >
            <Table
              columns={appCols}
              rows={data.byApp}
              rowKey={(r) => r.appVersion}
              ariaLabel={t("views.admin.sections.byAppVersion")}
              empty={t("views.admin.empty.reports")}
            />
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
  const { data, error, loading, retry } = useAdminData<AdminUsers>(
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
      width: `${COL_DATE}px`,
      numeric: true,
      sortable,
      render: (u) => dt(u.createdAt, lang),
      sortValue: (u) => at(u.createdAt),
    },
    { key: "plays30d", label: t("views.admin.users.plays30dCol"), width: `${COL_NUM_WIDE}px`, numeric: true, sortable },
    {
      key: "lastPlayAt",
      label: t("views.admin.users.lastCol"),
      width: `${COL_DATE}px`,
      numeric: true,
      sortable,
      render: (u) => dt(u.lastPlayAt, lang),
      sortValue: (u) => at(u.lastPlayAt),
    },
    {
      key: "isAdmin",
      label: t("views.admin.users.adminCol"),
      width: `${COL_ACTION}px`,
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
        {/* `total` сервер считает ПОД фильтром поиска, поэтому во время поиска
            «Всего 137» было бы неправдой — это число найденных. Две подписи на
            один счётчик: без запроса «всего», с запросом «нашлось». */}
        <span style={{ marginLeft: "auto", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
          {data ? t(q ? "views.admin.users.foundNote" : "views.admin.users.piiNote", { count: data.total }) : null}
        </span>
      </div>
      {actionError ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{actionError}</div> : null}
      {data && error ? <StaleNote error={error} onRetry={retry} /> : null}
      {!data ? (
        <Loading error={error} onRetry={retry} />
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
            // «Никого с таким ником нет» без запроса врало бы: ника не вводили.
            empty={t(q ? "views.admin.users.searchEmpty" : "views.admin.empty.users")}
          />
          {sortable ? null : <Note text={t("views.admin.users.sortOffNote")} inset />}
          <Pager page={page} pages={pages} onPage={setPage} />
        </Panel>
      )}
    </div>
  );
}

/** Сборка разработки: клиент метит её суффиксом версии (useErrorTelemetry.ts).
 *
 *  Отдельного переключателя «показать разработку» НЕТ намеренно. Версии и так
 *  стоят строкой фильтров («0.2.2 · 12», «0.2.2-dev · 41»), и выбор dev-версии
 *  сам по себе значит «покажи разработку» — второй контрол про то же самое был
 *  бы лишним вопросом. Пока выбрано «Все», вкладка говорит только про релизы:
 *  ровно этого от неё и ждут (разбор — docs/notes/2026-08-11-разбор-ошибок-на-проде.md). */
const isDevVersion = (v: string) => v.endsWith("-dev");

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
  /** Сколько строк таблица файлов показывает прямо сейчас — она же и говорит.
   *  Считать это снаружи нельзя: у таблицы своя листалка, и на второй странице
   *  «показаны 10 из 12» было бы враньём (там их две). */
  const [assetsShown, setAssetsShown] = useState(0);
  const { data, error, loading, retry } = useAdminData<AdminGrowth>(() => api.getAdminGrowth(days), [api, days]);

  const assetCols: TableColumn<AdminGrowth["downloads"]["byAsset"][number]>[] = [
    { key: "asset", label: t("views.admin.growth.assetCol"), sortable: true },
    { key: "tag", label: t("views.admin.growth.tagCol"), width: `${COL_NAME}px`, sortable: true },
    { key: "count", label: t("views.admin.growth.countCol"), width: `${COL_NUM_WIDE}px`, numeric: true, sortable: true },
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
      {data && error ? <StaleNote error={error} onRetry={retry} /> : null}
      {!data ? (
        <Loading error={error} onRetry={retry} />
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
            {/* Таблица файлов рисуется ВСЕГДА, даже пустой: раньше при нуле
                скачиваний она просто исчезала, и понять, «ничего не качали» или
                «блок сломался», было нечем. */}
            <div style={{ marginTop: "var(--sp-4)" }}>
              {/* счётчик и «показать все» относятся к таблице файлов, а не ко
                  всей панели «Скачивания», поэтому стоят над ней, а не в шапке */}
              {assetsAll.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "var(--sp-3)",
                    marginBottom: "var(--sp-2)",
                  }}
                >
                  <Counter shown={assetsShown} total={assetsAll.length} />
                  {assetsAll.length > ASSETS_PREVIEW ? (
                    <ExpandButton open={allAssets} total={assetsAll.length} onToggle={() => setAllAssets((v) => !v)} />
                  ) : null}
                </div>
              ) : null}
              <Table
                columns={assetCols}
                rows={assetsAll}
                rowKey={(a) => `${a.tag}:${a.asset}`}
                ariaLabel={t("views.admin.growth.downloads")}
                empty={t("views.admin.empty.downloads")}
                defaultSort={{ key: "count", dir: "desc" }}
                pageSize={allAssets ? 0 : ASSETS_PREVIEW}
                prevLabel={t("views.admin.pager.prev")}
                nextLabel={t("views.admin.pager.next")}
                pageLabel={(p: number, n: number) => t("views.admin.pager.pageOf", { page: p, pages: n })}
                onView={(v) => setAssetsShown(v.shown)}
              />
            </div>
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
  /** Отказ УДАЛЕНИЯ. До 06.08 у обеих кнопок стоял try/finally без catch:
   *  сервер отвечал отказом — кнопка отжималась, строка оставалась на месте, и
   *  человек видел «нажал, ничего не произошло». Теперь причина на экране. */
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, loading, retry } = useAdminData<AdminErrors>(
    () =>
      api.getAdminErrors({
        days,
        kind: kind === "all" ? undefined : kind,
        appVersion: appVersion === "all" ? undefined : appVersion,
        includeDev: isDevVersion(appVersion),
      }),
    [api, days, kind, appVersion, reload],
  );
  const filterArg = {
    kind: kind === "all" ? undefined : kind,
    appVersion: appVersion === "all" ? undefined : appVersion,
    // «Очистить» чистит ровно то, что вкладка показывает: без этого кнопка на
    // релизном виде снесла бы заодно невидимые dev-записи.
    includeDev: isDevVersion(appVersion),
  };
  const refresh = () => {
    setOpenHash(null);
    setConfirmClear(false);
    setActionError(null);
    setReload((n) => n + 1);
  };
  const doClear = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.clearAdminErrors(filterArg);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("views.admin.errors.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };
  const doDeleteGroup = async (hash: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.deleteAdminErrorGroup(hash);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("views.admin.errors.deleteFailed"));
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
      {data && error ? <StaleNote error={error} onRetry={retry} /> : null}
      {!data ? (
        <Loading error={error} onRetry={retry} />
      ) : (
        <>
          {actionError ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{actionError}</div> : null}
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
              {/* Одна версия — выбирать нечего, строка фильтра прячется. Но
                  dev-сборка обязана быть видна ВСЕГДА, даже когда она в списке
                  одна: иначе релизных ошибок нет, вкладка пуста, и открыть
                  разработку нечем — тупик без объяснения. */}
              {data.byApp.length > 1 || data.byApp.some((a) => isDevVersion(a.appVersion)) ? (
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
                  {/* Знаменатель — topTotal, а НЕ totals.distinct: distinct
                      считается по всему окну без фильтров, и при выбранном
                      классе ошибок «показаны 20 из 137» относилось бы к другому
                      множеству, чем сами строки. */}
                  <TailCounter shown={top.length} total={denominator(data.topTotal)} />
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
            {/* Знаменателя нет (сервер постарше его не считает) — говорим об
                этом вслух, как у топов «Контента», а не молчим. */}
            {top.length > 0 && denominator(data.topTotal) === null ? (
              <Note text={t("views.admin.limits.topOnly", { count: top.length })} />
            ) : null}
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
