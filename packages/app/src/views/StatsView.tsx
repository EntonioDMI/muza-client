/** Статистика прослушиваний: агрегаты /me/stats/overview за период
 *  (Неделя/Месяц/Год/Всё). Блоки включаются и переставляются в настройках
 *  (prefs.statsBlocks, под-экран «Статистика»); период по умолчанию —
 *  prefs.statsPeriod. Графики — div-бары на токенах ДС, без библиотек.
 *
 *  Композиция (редизайн 04.08, жалоба «страница не заполнена, тёмная и
 *  скучная»): блоки лежат в ЛЕНТЕ flex-wrap, а не в CSS-сетке — почему
 *  именно так, разобрано у контейнера блоков в самом низу файла. Каждый блок
 *  — карточка на surface-2, как карточки разделов настроек: на surface-1
 *  (2.5 % белого) панель не читалась как карточка вовсе, отсюда и «тёмная».
 *  Блока «Итоги года» здесь больше нет — вход во Wrapped остаётся только с
 *  главной (решение владельца, 2026-07-16).
 *
 *  ОБЩИЙ ЭКРАН (волна «экраны», 2026-08-02): один и тот же файл рисует
 *  статистику и в приложении, и в вебе — раньше у веба была своя урезанная
 *  копия (apps/web/app/(app)/stats/page.tsx), и она успела разъехаться с
 *  приложением: плоские «Серии», нет блока «Лайки», нет подсказок на барах.
 *
 *  ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Экран не знает ни про Prefs приложения, ни про
 *  запас последних ответов сервера, ни про подготовку строк — всё приходит
 *  пропсами:
 *  - `blocks` — уже нормализованный список ключей (приложение зовёт
 *    normalizeStatsBlocks само: STATS_BLOCK_KEYS живут в его types.ts);
 *  - `loadOverview` — как именно тянуть агрегаты (приложение заворачивает
 *    вызов в свой запас последних удачных ответов и отдаёт признак «без сети»);
 *  - `rowProps` — пропсы на обёртку строки трека (у приложения это подготовка
 *    трека к мгновенному старту, у веба такого умения нет — и пропсов нет);
 *  - `onCustomize` — есть обработчик, есть кнопка «Настроить»; нет — нет
 *    кнопки вовсе (не серая), как и с остальными умениями площадки. Чем она
 *    открывается, решает площадка: приложение уходит в свой под-экран
 *    настроек, веб — в диалог shell/StatsBlocksDialog.tsx. */

import { useEffect, useRef, useState } from "react";
import { Button, Icon, IconButton, Spinner, Tabs, Tooltip, TrackRow } from "@muza/ui";
import type { MuzaApi, StatsOverview, StatsPeriod, Track } from "@muza/api-client";
import { BAR_MAX_WIDTH, barSpecs } from "../lib/statsBars";
import { hourLabel } from "../lib/hourLabel";
import { pickByOrder } from "../lib/dragEngine";
import type { WarmRow } from "../lib/rowWarm";
import { useLookReorder } from "../shell/lookReorder";
import { useT } from "../i18n";
import type { Lang } from "../i18n";

/** Ключи блоков страницы в каноническом порядке. Тот же union, что
 *  `StatsBlockKey` в types.ts приложения (там он выводится из
 *  STATS_BLOCK_KEYS) — списки блоков ходят между ними без приведения. */
export type StatsBlockKey =
  | "summary"
  | "activity"
  | "rhythm"
  | "top_tracks"
  | "top_artists"
  | "streaks"
  | "likes";

/** Порядок блоков по умолчанию — канонический: так страница выглядит, пока
 *  состав ни разу не меняли (и так же её видит площадка, которая настройку
 *  блоков не подаёт вовсе). Нормализация сохранённого списка обоих клиентов
 *  опирается на этот же порядок — см. shell/StatsBlocksDialog.tsx. */
export const DEFAULT_STATS_BLOCKS: readonly StatsBlockKey[] = [
  "summary",
  "activity",
  "rhythm",
  "top_tracks",
  "top_artists",
  "streaks",
  "likes",
];

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
 *  идут во всю ширину (у строки свой внутренний отступ и ховер).
 *
 *  МАТЕРИАЛ — surface-2 (было surface-1, редизайн 04.08). Плёнка surface-1 —
 *  2.5 % белого поверх стекла зоны: разница с фоном меньше одной ступени
 *  тона, и карточки на странице просто не было видно — жалоба владельца
 *  «выглядит тёмной» была буквальной. surface-2 (4 %) — та же плёнка, на
 *  которой стоят карточки разделов настроек, то есть страница не изобретает
 *  свой материал, а встаёт в общий ряд. Контраст текста при этом гарантирован
 *  сторожем стеклянной лестницы (themeVars.test.ts): он меряет ВСЕ текстовые
 *  ступени на КАЖДОЙ плёнке, включая surface-2, на всём ходу «Плотности
 *  стекла» — 4.5:1 берут все.
 *
 *  flex/minWidth в стиле — для ленты блоков внизу файла: карточка сама и есть
 *  растягивающийся элемент строки. Вне flex-контейнера оба свойства ничего не
 *  делают, поэтому стоят безусловно. */
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
        flex: 1,
        minWidth: 0,
        background: "var(--surface-2)",
        borderRadius: "var(--r-md)",
        padding: flush ? "var(--sp-5) var(--sp-3) var(--sp-3)" : "var(--sp-5)",
      }}
    >
      <h2 style={{ ...panelHead, marginLeft: flush ? "var(--sp-2)" : 0 }}>{title}</h2>
      {children}
    </section>
  );
}

/** Блоки, которым нужна ВСЯ ширина строки: их содержимое читается по
 *  горизонтали (столбики по дням, по часам, ранжированные списки). Остальные
 *  — компактные, встают по два-три в ряд и растягиваются на остаток.
 *
 *  «Сводка» переехала сюда 04.08: четыре крупных числа в узкой колонке
 *  ломались на 3+1 и читались как обрубок таблицы, а во всю ширину это
 *  естественный «пояс итогов» в шапке страницы. */
const WIDE_STATS_BLOCKS = new Set<StatsBlockKey>([
  "summary",
  "activity",
  "rhythm",
  "top_tracks",
  "top_artists",
]);

/** Минимальная ширина компактного блока. Ниже неё лента переносит его на свою
 *  строку — и он растягивается на всю (flex-grow), а не оставляет пустоту. */
const NARROW_BLOCK_MIN = 320;

/** Крупное число с подписью снизу — типографикой, без плиток и иконок.
 *  `meta` — производная строка под подписью (см. блок «Сводка»). */
function BigStat({ value, label, meta, accent }: { value: string; label: string; meta?: string | null; accent?: boolean }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 0 }}>
      {/* --fs-num вместо сырых 36px (редизайн 04.08): числа статистики и
          админки — своя ступень типографической шкалы, и она масштабируется
          вместе с настройкой «Размер заголовков». Раньше число было зашито и
          не отзывалось ни на одну ручку. --ls-num поджимает трекинг: цифры
          шире букв, и на этом кегле без него они рассыпаются. */}
      <div
        style={{
          fontSize: "var(--fs-num)",
          letterSpacing: "var(--ls-num)",
          fontWeight: 800,
          lineHeight: 1.1,
          color: accent ? "var(--accent-text)" : "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2 }}>{label}</div>
      {meta ? (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: "var(--sp-1)" }}>{meta}</div>
      ) : null}
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
              /* Столбик РАСТЁТ из нуля — это приход данных, а не смена
                 состояния на месте: --ease-out доводит его до цели. */
              transition: "height var(--dur-state-move) var(--ease-out)",
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
            // Геройское число — ступень --fs-num с полуторным множителем:
            // одна шкала с остальными цифрами, но заметно крупнее (04.08).
            fontSize: "calc(var(--fs-num) * 1.5)",
            letterSpacing: "var(--ls-num)",
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
      {/* Плёнки на ступень выше прежних: корпус переехал на surface-2 вслед за
          Panel, иначе скелетон рисовал бы карточки светлее настоящих, и на
          подмене одного другим страница дёргалась бы тоном. */}
      {[0, 1, 2].map((s) => (
        <div key={s} style={{ background: "var(--surface-2)", borderRadius: "var(--r-md)", padding: "var(--sp-5)" }}>
          <div style={{ height: 16, width: 140, borderRadius: 8, background: "var(--surface-3)", marginBottom: "var(--sp-4)" }} />
          <div style={{ height: s === 1 ? 120 : 64, borderRadius: "var(--r-sm)", background: "var(--surface-3)" }} />
        </div>
      ))}
    </div>
  );
}

/** Плашка состояния (та же, что на главной): без сети / ошибка / пусто. */
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

/** Пусто за период — экран, который УЧИТ, а не сообщает о пустоте (редизайн
 *  04.08). Прежде здесь стояла одна тихая плашка Notice в две строки: она
 *  честно говорила «прослушиваний не было» и на этом заканчивалась — человек
 *  оставался один на один с пустым экраном и без единой подсказки, что делать.
 *
 *  Теперь плашка отвечает на три вопроса сразу: что случилось, что здесь
 *  появится (перечень ВКЛЮЧЁННЫХ блоков с их же подсказками из словаря — тот
 *  самый список, что человек видит в настройках статистики) и что можно
 *  нажать прямо сейчас. Кнопка «за всё время» есть только когда период уже не
 *  «Всё»: на пустом «Всё» она вела бы в ту же пустоту.
 *
 *  Перечень берёт строки из media.statsBlocks.* — не копия, а тот же словарь,
 *  что у переключателей блоков: переименуют блок — переименуется и здесь. */
function StatsEmpty({
  blocks,
  period,
  onShowAllTime,
}: {
  blocks: readonly StatsBlockKey[];
  period: StatsPeriod;
  onShowAllTime: () => void;
}) {
  const { t } = useT();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-5)",
        padding: "var(--sp-6)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-3)" }}>
        {/* Единственный акцент на этом экране — иконка: чисел, за которые
            акценту можно было бы зацепиться, здесь ещё нет. */}
        <Icon name="sparkles" size={20} color="var(--accent-text)" />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <h2 style={{ margin: 0, fontSize: "var(--fs-title)", fontWeight: 700, color: "var(--text-1)" }}>
            {t("views.stats.empty.title")}
          </h2>
          <p style={{ margin: 0, fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
            {t("views.stats.notice.emptyText")}
          </p>
        </div>
      </div>

      {blocks.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("views.stats.empty.listTitle")}</div>
          {/* Та же лента, что у блоков страницы: карточки-подсказки делят
              ширину поровну и не оставляют дыры справа при любом их числе. */}
          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--sp-4)",
              listStyle: "none",
              margin: 0,
              padding: 0,
            }}
          >
            {blocks.map((key) => (
              <li key={key} style={{ flex: `1 1 ${NARROW_BLOCK_MIN - 60}px`, minWidth: 0 }}>
                <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-1)" }}>
                  {t(`media.statsBlocks.${key}.label`)}
                </div>
                <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.4, marginTop: 2 }}>
                  {t(`media.statsBlocks.${key}.hint`)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {period !== "all" ? (
        <div>
          <Button variant="secondary" onClick={onShowAllTime}>
            {t("views.stats.empty.allTimeAction")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function StatsView({
  api,
  canSearch,
  blocks = DEFAULT_STATS_BLOCKS,
  initialPeriod = "month",
  currentId,
  playing,
  likes,
  onPlayCatalog,
  onLike,
  onCatalogMenu,
  onCustomize,
  onReorderBlocks,
  loadOverview,
  rowProps,
}: {
  api: MuzaApi;
  /** false у анонима: истории на сервере нет — честная заглушка. */
  canSearch: boolean;
  /** Включённые блоки в порядке показа (нормализует вызывающий). */
  blocks?: readonly StatsBlockKey[];
  /** Период при первом открытии (у приложения — prefs.statsPeriod). */
  initialPeriod?: StatsPeriod;
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  likes: string[];
  onPlayCatalog: (tracks: Track[], id: string) => void;
  onLike: (id: string) => void;
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  /** Открыть под-экран настроек «Статистика». Нет обработчика — нет кнопки. */
  onCustomize?: () => void;
  /** Блоки переставили в режиме правки вида (Ctrl+E) — новый порядок ключей
   *  ВИДИМЫХ блоков. Кто хранит порядок (у приложения — prefs.statsBlocks
   *  вместе с выключенными), решает вызывающий; нет обработчика — блоки не
   *  хватаются вовсе. */
  onReorderBlocks?: (keys: StatsBlockKey[]) => void;
  /** Чем тянуть агрегаты. По умолчанию — прямой запрос к серверу; приложение
   *  подставляет сюда чтение через свой запас последних удачных ответов. */
  loadOverview?: (period: StatsPeriod) => Promise<{ data: StatsOverview; offline: boolean }>;
  /** Пропсы на обёртку строки трека (подготовка к мгновенному старту). Форма
   *  общая для всех экранов (lib/rowWarm.ts): здесь стояло «любые пропсы div»,
   *  и опечатка в имени поля прошла бы молча — пятая копия одной и той же
   *  формы, чистка дублей волны 3. */
  rowProps?: WarmRow;
}) {
  const { t, lang } = useT();
  const [period, setPeriod] = useState<StatsPeriod>(initialPeriod);
  const [state, setState] = useState<{
    status: "loading" | "live" | "error";
    data: StatsOverview | null;
    offline: boolean;
  }>({ status: "loading", data: null, offline: false });

  // Способ загрузки читается через ref: стрелка, созданная вызывающим заново на
  // каждом рендере, попала бы в зависимости эффекта и закрутила бесконечную
  // перезагрузку. Зависимости остаются прежними: api / canSearch / период.
  const loadOverviewRef = useRef(loadOverview);
  loadOverviewRef.current = loadOverview;

  const load = () => {
    if (!canSearch) return () => undefined;
    let alive = true;
    // Держим прежние данные видимыми во время загрузки — иначе на смене периода
    // контент мигает скелетоном (ответ часто приходит мгновенно).
    setState((prev) => ({ status: "loading", data: prev.data, offline: prev.offline }));
    const fetchIt =
      loadOverviewRef.current ??
      ((p: StatsPeriod) => api.getStatsOverview(p).then((data) => ({ data, offline: false })));
    fetchIt(period)
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
      case "summary": {
        // ПРОИЗВОДНЫЕ ПОД ЧИСЛАМИ (04.08). Голые четыре числа не отвечали на
        // «много это или мало» — а сравнить с прошлым периодом нечем: ответ
        // /me/stats/overview отдаёт ТОЛЬКО текущий период (StatsOverview в
        // api-client/schemas.ts), поля вроде previousTotalMs там нет, и
        // выдумывать его нельзя. Что честно считается из самого ответа —
        // соотношения: минуты и прослушивания на день с музыкой, повторы на
        // трек и на артиста. Каждое делится на своё, поэтому строки не
        // повторяют друг друга.
        const perDay = (v: number) => v / d.activeDays;
        const num = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 1 });
        const minutesMeta = d.activeDays > 0 ? t("views.stats.summary.perDayMinutes", { value: num(perDay(d.totalMs) / 60_000) }) : null;
        const playsMeta = d.activeDays > 0 ? t("views.stats.summary.perDayPlays", { value: num(perDay(d.totalPlays)) }) : null;
        const trackMeta = d.uniqueTracks > 0 ? t("views.stats.summary.perTrack", { value: num(d.totalPlays / d.uniqueTracks) }) : null;
        const artistMeta = d.uniqueArtists > 0 ? t("views.stats.summary.perArtist", { value: num(d.totalPlays / d.uniqueArtists) }) : null;
        // ПАРАМИ, А НЕ ПРОСТЫМ ПЕРЕНОСОМ. Четыре одинаковых ячейки во flex-wrap
        // на средней ширине ломались 3+1: три числа в ряд и одно сиротой под
        // ними. Пара — неделимая единица переноса, поэтому раскладка бывает
        // только 4 в ряд или 2×2, промежуточного уродства нет.
        const pair: React.CSSProperties = { display: "flex", gap: "var(--sp-6)", flex: "1 1 300px", minWidth: 0 };
        return (
          <Panel key={key} title={t("media.statsBlocks.summary.label")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-6)", rowGap: "var(--sp-5)" }}>
              <div style={pair}>
                <BigStat value={fmtMinutes(d.totalMs, lang)} label={t("views.stats.summary.minutesLabel")} meta={minutesMeta} accent />
                <BigStat value={d.totalPlays.toLocaleString(lang)} label={t("views.stats.summary.playsLabel")} meta={playsMeta} />
              </div>
              <div style={pair}>
                <BigStat value={d.uniqueTracks.toLocaleString(lang)} label={t("views.stats.summary.tracksLabel")} meta={trackMeta} />
                <BigStat value={d.uniqueArtists.toLocaleString(lang)} label={t("views.stats.summary.artistsLabel")} meta={artistMeta} />
              </div>
            </div>
          </Panel>
        );
      }
      case "activity": {
        const daily = d.series.length > 0 && d.series[0].bucket.length === 10;
        return (
          <Panel key={key} title={t("media.statsBlocks.activity.label")}>
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
          <Panel key={key} title={t("media.statsBlocks.rhythm.label")}>
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
          <Panel key={key} title={t("media.statsBlocks.top_tracks.label")} flush>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {d.topTracks.map((entry, i) => (
                // обёртка — точка подготовки трека (наведение/видимость), как
                // обёртки переноса в остальных вьюхах; у топа переноса нет,
                // поэтому без пропсов площадки div остаётся голым
                <div key={entry.track.id} {...(rowProps ? rowProps(entry.track.id) : undefined)}>
                <TrackRow
                  playLabel={t("player.play")}
                  pauseLabel={t("player.pause")}
                  likeLabel={t("common.like")}
                  moreLabel={t("common.more")}
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
          <Panel key={key} title={t("media.statsBlocks.top_artists.label")}>
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
                  {/* Дорожка на ступень выше корпуса: панель сама переехала на
                      surface-2, и прежняя дорожка того же тона исчезла бы — на
                      равных плёнках разницы нет вовсе. */}
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${(a.playedMs / maxMs) * 100}%`,
                        height: "100%",
                        borderRadius: 4,
                        background: "var(--accent)",
                        transition: "width var(--dur-state-move) var(--ease-out)",
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
          <Panel key={key} title={t("media.statsBlocks.streaks.label")}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--sp-6)", rowGap: "var(--sp-5)" }}>
              <div style={{ flex: "1 1 240px", minWidth: 220 }}>
                <Hero value={String(cur)} suffix={days} label={t("views.stats.streaks.current")} accent={cur > 0} />
                {rec > 0 && cur < rec ? (
                  <div style={{ marginTop: "var(--sp-4)" }}>
                    {/* см. дорожку топ-артистов: на surface-2-корпусе дорожка
                        обязана быть surface-3, иначе её не видно */}
                    <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.min((cur / rec) * 100, 100)}%`,
                          height: "100%",
                          borderRadius: 4,
                          background: "var(--accent)",
                          transition: "width var(--dur-state-move) var(--ease-out)",
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
                <div style={{ borderTop: "1px solid var(--hairline)" }}>
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
          <Panel key={key} title={t("media.statsBlocks.likes.label")}>
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
                      <div style={{ borderTop: "1px solid var(--hairline)" }}>
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

  // Блок без данных (пустой топ треков у молодой истории) не рисуется вовсе и
  // места в ленте не занимает — поэтому и в перестановке его быть не должно:
  // иначе соседи разъезжались бы под пустоту, а курсор искал бы прямоугольник
  // элемента, которого в DOM нет. Считаем содержимое ОДИН раз и им же рисуем.
  const rendered = blocks
    .map((key) => ({ key, body: renderBlock(key) }))
    .filter((b): b is { key: StatsBlockKey; body: React.JSX.Element } => b.body !== null);
  const blocksReorder = useLookReorder({
    ids: rendered.map((b) => b.key),
    // ⚠️ БЫЛО "column" — И ЭТО БЫЛА ОШИБКА. Лента статистики это flex-wrap:
    // узкие блоки стоят по два-три в ряд и переносятся на следующую строку.
    // Индекс вставки по одной оси Y означал, что два соседа в ОДНОЙ строке
    // неразличимы, — отсюда жалоба владельца «Strike с Top Artists соединить
    // нельзя». Сетка считает по обеим осям (ближайший центр) и переносу строк
    // не удивляется; стрелки клавиатуры при этом становятся ←/→, что для ленты
    // тоже вернее вертикальных.
    axis: "grid",
    onReorder: onReorderBlocks ? (keys) => onReorderBlocks(keys as StatsBlockKey[]) : undefined,
    labelOf: (key) => t("lookEdit.group.statsBlock", { name: t(`media.statsBlocks.${key as StatsBlockKey}.label`) }),
  });

  return (
    // ПОТОЛОК 900px СНЯТ (редизайн 04.08). Он был единственным на всё
    // приложение и работал против экрана: на окне 1440 центральная зона отдаёт
    // больше тысячи пикселей, а статистика упиралась в 900 и оставляла по ~90px
    // мёртвого поля с каждой стороны. При этом жалоба владельца была ровно
    // обратная — «статистика выглядит скудно»: панели стояли в одну колонку и
    // не пользовались шириной, которая у них уже была.
    // Теперь ширину впитывает сетка (как в Медиатеке), а не поле по бокам.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-5)",
        padding: "var(--sp-6) var(--sp-5) 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
          paddingBottom: "var(--sp-4)",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        {/* Заголовок экрана — Golos 700 --fs-h1, как на всех остальных экранах
            (правило одного display-момента, редизайн 04.08 — см. HomeFeed). */}
        <h1
          style={{
            margin: 0,
            flex: 1,
            fontWeight: 700,
            fontSize: "var(--fs-h1)",
            letterSpacing: "var(--ls-h1)",
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
            {onCustomize ? (
              <IconButton icon="settings-2" label={t("views.stats.customizeBlocksLabel")} onClick={onCustomize} />
            ) : null}
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
          <StatsEmpty blocks={blocks} period={period} onShowAllTime={() => setPeriod("all")} />
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
          {/* ЛЕНТА FLEX-WRAP ВМЕСТО CSS-СЕТКИ (редизайн 04.08, вторая попытка).
              Жалоба владельца: «страница не заполнена, справа пустует около
              двух блоков». Считаем, откуда бралась дыра. На окне 1440 у
              центральной зоны 1440 − 2×8 (поля окна) − 240 (сайдбар) − 8
              (зазор зон) = 1176px, минус свои поля экрана 2×20 = 1136px под
              содержимое. Прежняя сетка repeat(auto-fit, minmax(340px, 1fr))
              при зазоре 20 нарезала floor((1136+20)/(340+20)) = 3 дорожки по
              365px. Дальше решала РАССТАНОВКА: «Сводка» — компактный блок, она
              занимала ОДНУ дорожку и оставляла две пустыми, а «Серии» и
              «Лайки» в хвосте занимали две из трёх и оставляли одну. Ровно те
              «примерно два блока» пустоты, о которых речь.

              auto-fit против auto-fill тут ни при чём: схлопывать auto-fit
              умеет только дорожки, в которых НЕТ ни одного элемента, а
              широкие блоки со span 1/-1 занимают все три — схлопывать нечего.
              Дыру даёт сама модель сетки: дорожки фиксированы заранее и не
              знают, сколько элементов встанет в конкретный ряд.

              Лента этого недостатка лишена: во flex-wrap элементы последней
              (да и любой) строки РАСТЯГИВАЮТСЯ на весь остаток (flex-grow).
              Широкий блок — базис 100 %: он всегда один в строке. Компактный —
              базис NARROW_BLOCK_MIN: сколько влезло, столько и встало, и они
              поделили ширину поровну; влез один — он занял всю строку. Ширина
              расходуется вся при ЛЮБОМ наборе включённых блоков, включая
              набор из одного компактного.

              align-items по умолчанию (stretch) — соседи по строке равной
              высоты, поэтому карточки «Серии» и «Лайки» не ступенькой. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--sp-5)",
              paddingBottom: "var(--sp-6)",
            }}
          >
            {pickByOrder(rendered, (b) => b.key, blocksReorder.order).map(({ key, body }) => {
              const look = blocksReorder.itemProps(key);
              return (
                <div
                  key={key}
                  {...look}
                  style={{
                    display: "flex",
                    flex: WIDE_STATS_BLOCKS.has(key) ? "1 1 100%" : `1 1 ${NARROW_BLOCK_MIN}px`,
                    minWidth: 0,
                    // Сдвиг перестановки — последним, поверх раскладки ленты.
                    ...look.style,
                  }}
                >
                  {body}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
