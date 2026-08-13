/** ОБЗОР СОСТОЯНИЯ — верхняя половина экрана проверки загрузки треков.
 *
 *  ЧТО ЗДЕСЬ ЗА ЗАДАЧА. Владелец: «хотелось бы сделать обзорную главную
 *  страницу… важно, чтобы при одном взгляде на неё можно было сразу понять
 *  содержимое». То есть у экрана есть измеримое требование: за первые три
 *  секунды человек обязан узнать, всё ли в порядке, — не читая ни одной цифры.
 *  Всё остальное на экране существует ради ответа на вопрос, который поднимет
 *  первая строка.
 *
 *  ⚠️ ПОРЯДОК БЛОКОВ — ЭТО И ЕСТЬ ГЛАВНОЕ РЕШЕНИЕ, и он не случайный:
 *    1. вердикт     — «всё ли нормально» (три секунды, без чтения цифр);
 *    2. три числа   — «сколько это стоит» (десять секунд);
 *    3. два графика — «что изменилось и куда уходит время» (минута);
 *    4. места       — «откуда музыка и кто молчит» (минута).
 *  Журнал и поштучный список включений живут НИЖЕ и по умолчанию свёрнуты
 *  (DiagnosticsSub) — до них доходят единицы и только когда уже знают, что
 *  искать. Поставь их выше — и экран снова станет простынёй, из которой
 *  состояние надо вычитывать. Ровно с этого всё и начиналось.
 *
 *  ⚠️ ГРАФИК ЗДЕСЬ ТОЛЬКО ТАМ, ГДЕ ОН ОТВЕЧАЕТ ЛУЧШЕ ЧИСЛА. Их два.
 *  Лента включений отвечает на «стало хуже или мне кажется» — это форма во
 *  времени, числом её не передать. Полоса шагов отвечает на «куда уходит
 *  ожидание» — это соотношение, и глаз читает его быстрее, чем четыре числа.
 *  Всё остальное — числа и текст: график там был бы украшением.
 *
 *  ⚠️ ЦВЕТ ЗНАЧИТ СОСТОЯНИЕ, А НЕ НАСТРОЕНИЕ. Три цвета и ровно три:
 *  --accent (норма), --warn (стоит посмотреть), --danger (сломано). Акцент
 *  принадлежит теме и бывает красным — поэтому «сломано» никогда не рисуется
 *  акцентом, только --danger. Раскрасишь что-нибудь ещё «для красоты» — и
 *  первые три секунды перестанут работать: глаз ищет цветное пятно, и оно
 *  обязано означать беду, а не оформление.
 *
 *  Считает всё это lib/engineOverview.ts. Здесь — ни одного порога и ни одной
 *  формулы: разъедься они, экран начал бы спорить с собственной подписью.
 */

import { useT } from "../../i18n";
import type { EngineOverview, OverviewLevel, PhaseShare, RecentStart } from "../../lib/engineOverview";
import { GroupTitle } from "./primitives";

/** Цвет состояния. Единственное место, где ступень превращается в цвет. */
const LEVEL_COLOR: Record<OverviewLevel, string> = {
  ok: "var(--accent)",
  warn: "var(--warn)",
  bad: "var(--danger)",
};

/** Строка вердикта → ключ словаря. Картой, а не склейкой из префикса: ключи
 *  обязаны быть литералами, иначе словарь перестаёт проверяться на этапе
 *  сборки и опечатка доезжает до экрана пустой строкой. */
const NOTE_KEY = {
  searchPlaceDown: "settings.system.stage0.overview.note.searchPlaceDown",
  searchPlaceShaky: "settings.system.stage0.overview.note.searchPlaceShaky",
  someDidNotPlay: "settings.system.stage0.overview.note.someDidNotPlay",
  fastPathPaused: "settings.system.stage0.overview.note.fastPathPaused",
  slowTypical: "settings.system.stage0.overview.note.slowTypical",
} as const;

/** Имена мест поиска как их знает сервер → как их знает человек.
 *
 *  Живёт В КОДЕ, а не в словаре, нарочно: это названия чужих сервисов, они
 *  одинаковы на всех языках, и копия в двух словарях означала бы два места,
 *  где «SoundCloud» можно опечатать. Незнакомое имя показывается как есть —
 *  это честнее, чем прятать новое место за словом «другое». */
const SEARCH_PLACE_NAMES: Record<string, string> = {
  "youtube:music": "YouTube Music",
  "youtube:ytsearch": "YouTube",
  "youtube:plain": "YouTube",
  "soundcloud:scsearch": "SoundCloud",
  "bandcamp:bcsearch": "Bandcamp",
};

/** ⚠️ Зовётся В ДВУХ местах — в списке мест и в строке вердикта, — и это не
 *  случайность, а починка: сначала имя переводилось только в списке, и главная
 *  строка экрана читалась «youtube:music не отвечает». Первая же строка,
 *  ради которой экран открывают, говорила языком сервера. */
const searchPlaceName = (source: string): string => SEARCH_PLACE_NAMES[source] ?? source;

/** Места, откуда играла музыка. Ключ «other» переводится, остальные — бренды. */
const PLAY_PLACE_NAMES: Record<string, string> = {
  soundcloud: "SoundCloud",
  youtube: "YouTube",
  bandcamp: "Bandcamp",
};

/** Чем кончился поход к серверу за местами поиска. Отдельно от данных, потому
 *  что «сервер сказал „пусто“» и «сервер не ответил» — разные новости, и
 *  показывать их одинаковой пустой рамкой значит повторять ровно ту ошибку,
 *  из-за которой этот экран и понадобился. */
export type SearchProbeState = "off" | "loading" | "ready" | "error";

export function DiagnosticsOverview({
  overview,
  searchProbe,
}: {
  overview: EngineOverview;
  searchProbe: SearchProbeState;
}) {
  const { t } = useT();

  /** Секунды с одним знаком: «0,5 с». Миллисекунды человеку не говорят ничего
   *  («480 мс» надо в уме делить), а вот «полсекунды» — говорят сразу.
   *  Ниже сотни миллисекунд секунда врёт («0,0 с»), там остаются мс. */
  const dur = (ms: number | null): string => {
    if (ms === null) return t("settings.system.stage0.overview.noData");
    if (ms < 100) return t("settings.system.stage0.overview.msValue", { value: ms });
    return t("settings.system.stage0.overview.sec", { value: (ms / 1000).toFixed(1).replace(".", ",") });
  };

  /** ⚠️ ОДНА ЕДИНИЦА НА ВЕСЬ РЯД. Правило «до сотни — миллисекунды, дальше
   *  секунды» хорошо для одиночного числа, но в подписи к полосе шагов давало
   *  «источники 20 мс · ссылка 0,2 с · запуск 60 мс», и куски приходилось
   *  сравнивать в уме, переводя единицы, — то есть ровно та работа, ради
   *  избавления от которой полоса и нарисована. Единицу выбирает САМЫЙ
   *  ДЛИННЫЙ шаг, и она одна на все. */
  const durScale = (all: readonly number[]) => {
    const seconds = Math.max(0, ...all) >= 1000;
    return (ms: number): string =>
      seconds
        ? t("settings.system.stage0.overview.sec", { value: (ms / 1000).toFixed(1).replace(".", ",") })
        : t("settings.system.stage0.overview.msValue", { value: Math.round(ms) });
  };

  const empty = overview.total === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      <Verdict overview={overview} />

      {empty ? (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
          {t("settings.system.stage0.overview.emptyHint")}
        </div>
      ) : (
        <>
          {/* ТРИ ЧИСЛА. Именно три, и это потолок, а не совпадение: четвёртое
              всегда находится, и с ним ряд перестаёт читаться одним движением
              глаза. «В самые медленные разы» приписано мелким к первому числу,
              а не вынесено четвёртым: это уточнение к нему, а не свой факт. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "var(--sp-4)",
            }}
          >
            <BigNumber
              label={t("settings.system.stage0.overview.typical")}
              value={dur(overview.typicalMs)}
              sub={
                overview.slowMs === null
                  ? undefined
                  : t("settings.system.stage0.overview.typicalSlow", { value: dur(overview.slowMs) })
              }
            />
            <BigNumber
              label={t("settings.system.stage0.overview.didNotPlay")}
              value={t("settings.system.stage0.overview.didNotPlayValue", {
                failed: overview.failed,
                total: overview.total,
              })}
              // Красным — только когда есть что красить. Ноль неудач,
              // нарисованный цветом аварии, обесценивает сам цвет.
              color={overview.failed > 0 ? "var(--danger)" : undefined}
            />
            <BigNumber label={t("settings.system.stage0.overview.cold")} value={dur(overview.coldMs)} />
          </div>

          <section>
            <GroupTitle>{t("settings.system.stage0.overview.recentTitle")}</GroupTitle>
            <Hint>{t("settings.system.stage0.overview.recentHint")}</Hint>
            <RecentChart overview={overview} dur={dur} />
          </section>

          {overview.phases.length > 0 ? (
            <section>
              <GroupTitle>{t("settings.system.stage0.overview.phasesTitle")}</GroupTitle>
              <Hint>{t("settings.system.stage0.overview.phasesHint")}</Hint>
              <PhaseBar phases={overview.phases} dur={durScale(overview.phases.map((p) => p.ms))} />
            </section>
          ) : null}

          {overview.places.length > 0 ? (
            <section>
              <GroupTitle>{t("settings.system.stage0.overview.placesTitle")}</GroupTitle>
              <Hint>{t("settings.system.stage0.overview.placesHint")}</Hint>
              <PlacesBar
                overview={overview}
                nameOf={(key) => PLAY_PLACE_NAMES[key] ?? t("settings.system.stage0.overview.placeOther")}
              />
            </section>
          ) : null}
        </>
      )}

      {searchProbe === "off" ? null : (
        <section>
          <GroupTitle>{t("settings.system.stage0.overview.searchTitle")}</GroupTitle>
          <Hint>{t("settings.system.stage0.overview.searchHint")}</Hint>
          <SearchPlaces
            overview={overview}
            probe={searchProbe}
            dur={dur}
            nameOf={searchPlaceName}
          />
        </section>
      )}
    </div>
  );
}

/** Подпись под заголовком раздела: что тут вообще показано. */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "var(--sp-1) 0 var(--sp-3)",
        fontSize: "var(--fs-caption)",
        color: "var(--text-2)",
        lineHeight: 1.45,
      }}
    >
      {children}
    </p>
  );
}

/** ВЕРДИКТ — то, ради чего экран открывают.
 *
 *  Точка состояния слева намеренно КРУПНАЯ и цветная: это единственный
 *  элемент, который читается боковым зрением, ещё до того как глаз навёлся на
 *  текст. Дальше — заголовок словами (одного цвета мало: он не различим при
 *  цветовой слепоте и не озвучивается) и список причин по одной строке. */
function Verdict({ overview }: { overview: EngineOverview }) {
  const { t, lang } = useT();
  // ⚠️ «Нечего показать» — это НЕ «всё хорошо». Пока не измерено ни одного
  // включения и ни одно место поиска не отчиталось, «Всё работает» было бы
  // обещанием, которого никто не проверял: ноль неудач из нуля попыток
  // выглядит идеально ровно потому, что попыток не было.
  const nothingYet = overview.total === 0 && overview.notes.length === 0;
  const title = nothingYet
    ? t("settings.system.stage0.overview.emptyTitle")
    : overview.level === "bad"
      ? t("settings.system.stage0.overview.badTitle")
      : overview.level === "warn"
        ? t("settings.system.stage0.overview.warnTitle")
        : t("settings.system.stage0.overview.okTitle");
  const color = nothingYet ? "var(--text-3)" : LEVEL_COLOR[overview.level];

  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-start" }}>
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          borderRadius: "var(--r-pill)",
          background: color,
          flexShrink: 0,
          marginTop: 7,
          // Мягкий ореол ровно у точки состояния и больше нигде: она обязана
          // поймать взгляд первой, а на плоском фоне 12 пикселей это не всегда
          // удаётся. Тень цветная и без смещения — это свечение источника, а не
          // подъём над плоскостью.
          boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent)`,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-title)", fontWeight: 600, color: "var(--text-1)", lineHeight: 1.2 }}>
          {title}
        </div>
        {overview.notes.length === 0 ? (
          // При «нечего показать» подпись не нужна вовсе: её работу делает
          // пустое состояние ниже, а две объяснительные строки подряд читаются
          // как извинение.
          nothingYet ? null : (
            <p
              style={{ margin: "var(--sp-2) 0 0", fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.45 }}
            >
              {t("settings.system.stage0.overview.okHint")}
            </p>
          )
        ) : (
          <ul
            style={{
              margin: "var(--sp-2) 0 0",
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-1)",
            }}
          >
            {overview.notes.map((n) => {
              const key = NOTE_KEY[n.key as keyof typeof NOTE_KEY];
              if (!key) return null; // причина без строки в словаре молчит, а не печатает свой ключ
              return (
                <li
                  key={`${n.key}-${String(n.params?.place ?? "")}`}
                  style={{ fontSize: "var(--fs-body)", color: LEVEL_COLOR[n.level], lineHeight: 1.45 }}
                >
                  {t(key, {
                    ...(n.params ?? {}),
                    // Имя места приходит машинным («youtube:music») — в строке
                    // вердикта оно обязано быть человеческим.
                    ...(typeof n.params?.place === "string" ? { place: searchPlaceName(n.params.place) } : {}),
                    // Момент снятия паузы приходит числом, а показывать его надо
                    // часами: «до 1786…» человеку не сообщает ничего.
                    ...(typeof n.params?.until === "number" ? { until: clock(n.params.until) } : {}),
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Одно крупное число с подписью. Без рамки и подложки: разделяет их воздух,
 *  как и везде в этой системе (границы и тени для группировки здесь не
 *  используются вовсе). */
function BigNumber({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.3 }}>{label}</div>
      <div
        style={{
          fontSize: "var(--fs-h1)",
          fontWeight: 600,
          color: color ?? "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.15,
          marginTop: 2,
          // Цифры на своём кегле легко расползаются; чуть подтянутый трекинг
          // держит их одной группой, а не строкой отдельных знаков.
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

/** ЛЕНТА ПОСЛЕДНИХ ВКЛЮЧЕНИЙ — единственный ответ на «стало хуже или кажется».
 *
 *  ⚠️ Шкала считается по САМОМУ ДОЛГОМУ включению окна, а не по круглому
 *  потолку. Круглый потолок пришлось бы либо задирать (и тогда обычные
 *  включения превратились бы в невидимую полоску у пола), либо подрезать
 *  выбросы — а выброс здесь и есть новость.
 *
 *  Не заигравшее включение рисуется во всю высоту: «никогда» — это худший
 *  исход, и на графике «выше = дольше» он обязан быть самым высоким.
 *  Перебитое человеком — чёрточка у пола: это не сбой, но и не звук, и
 *  выкидывать его совсем нельзя, иначе лента врёт о плотности прослушивания. */
function RecentChart({ overview, dur }: { overview: EngineOverview; dur: (ms: number | null) => string }) {
  const { t } = useT();
  const slow = overview.slowMs ?? Infinity;
  const scale = Math.max(1, ...overview.recent.map((r) => r.ms ?? 0));

  const colorOf = (r: RecentStart) =>
    r.failed ? "var(--danger)" : (r.ms ?? 0) > slow ? "var(--warn)" : "var(--accent)";
  // Перебитый рисуется чёрточкой у пола — заметной, но не соревнующейся с
  // остальными. На шести процентах она сливалась с фоном, и в ленте
  // получалась ДЫРА: человек читал её как «здесь ничего не играло», хотя там
  // как раз играло — просто он сам переключил дальше.
  const heightOf = (r: RecentStart) => (r.failed ? 100 : r.interrupted ? 11 : Math.max(4, ((r.ms ?? 0) / scale) * 100));

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 76 }}>
        {overview.recent.map((r, i) => (
          <div
            key={`${r.at}-${i}`}
            // Подпись столбика — родной tooltip: он не тянет за собой слой
            // поверх панели настроек, у которой свой скроллер и свои границы.
            title={
              r.failed
                ? t("settings.system.stage0.overview.recentTipFailed", { title: r.title })
                : t("settings.system.stage0.overview.recentTip", { title: r.title, value: dur(r.ms) })
            }
            style={{
              flex: "1 1 0",
              minWidth: 2,
              height: `${heightOf(r)}%`,
              background: r.interrupted ? "var(--text-3)" : colorOf(r),
              opacity: r.interrupted ? 0.5 : 1,
              borderRadius: "var(--r-xs)",
            }}
          />
        ))}
      </div>
      <Legend
        items={[
          { color: "var(--accent)", label: t("settings.system.stage0.overview.recentLegendFast") },
          { color: "var(--warn)", label: t("settings.system.stage0.overview.recentLegendSlow") },
          { color: "var(--danger)", label: t("settings.system.stage0.overview.recentLegendFailed") },
        ]}
      />
    </>
  );
}

/** ПОЛОСА ШАГОВ: во что складывается ожидание.
 *
 *  ⚠️ Ширины считаются от СУММЫ ПОКАЗАННЫХ ШАГОВ, а не от общего времени
 *  включения. Обычное время целого и сумма обычных времён его шагов — разные
 *  числа (так устроена середина ряда), и полоса «до общего» дорисовывала бы
 *  хвост, которого нет ни у одного включения. Здесь полоса отвечает только на
 *  «что относительно чего», и каждый кусок подписан своим собственным
 *  временем — сравнивать их между собой можно, складывать в целое нельзя. */
function PhaseBar({ phases, dur }: { phases: PhaseShare[]; dur: (ms: number) => string }) {
  const { t } = useT();
  const sum = phases.reduce((s, p) => s + p.ms, 0) || 1;
  // Один цвет, четыре плотности: шаги — это части ОДНОГО ожидания, и красить
  // их разными цветами значило бы намекать, что они разной природы.
  //
  // ⚠️ ПЛОТНОСТЬ ИДЁТ ПО ВЕЛИЧИНЕ ШАГА, А НЕ ПО ПОРЯДКУ. Сначала было по
  // порядку — и вышло наоборот смыслу: самый долгий шаг (он же самый широкий)
  // оказывался самым бледным, а двадцатимиллисекундный волосок в начале —
  // самым ярким. Глаз читает яркость как важность, и полоса «куда уходит
  // ожидание» отвечала ровно противоположное тому, ради чего нарисована.
  const inks = [0.95, 0.68, 0.46, 0.3];
  const rank = new Map(
    [...phases].sort((a, b) => b.ms - a.ms).map((p, i) => [p.key, inks[i] ?? 0.3] as const),
  );
  const ink = (p: PhaseShare) => `color-mix(in srgb, var(--accent) ${Math.round((rank.get(p.key) ?? 0.3) * 100)}%, transparent)`;
  const label: Record<PhaseShare["key"], string> = {
    sources: t("settings.system.stage0.starts.sources"),
    url: t("settings.system.stage0.starts.url"),
    engine: t("settings.system.stage0.starts.phaseStart"),
    bytes: t("settings.system.stage0.starts.phaseFirstSound"),
  };
  return (
    <>
      <div style={{ display: "flex", gap: 2, height: 14 }}>
        {phases.map((p) => (
          <div
            key={p.key}
            title={`${label[p.key]} · ${dur(p.ms)}`}
            style={{
              flexGrow: p.ms / sum,
              flexBasis: 0,
              minWidth: 3,
              background: ink(p),
              borderRadius: "var(--r-xs)",
            }}
          />
        ))}
      </div>
      <Legend items={phases.map((p) => ({ color: ink(p), label: `${label[p.key]} ${dur(p.ms)}` }))} />
    </>
  );
}

/** ОТКУДА ИГРАЛА МУЗЫКА. Полоса, а не список: вопрос здесь про соотношение
 *  («почему всё из одного места»), а соотношение читается длиной, не цифрами.
 *  Цифры всё равно стоят в подписи — по ним видно, велика ли вообще выборка. */
function PlacesBar({ overview, nameOf }: { overview: EngineOverview; nameOf: (key: string) => string }) {
  const total = overview.places.reduce((s, p) => s + p.count, 0) || 1;
  const inks = [0.9, 0.6, 0.38, 0.22];
  const ink = (i: number) => `color-mix(in srgb, var(--accent) ${Math.round((inks[i] ?? 0.22) * 100)}%, transparent)`;
  return (
    <>
      <div style={{ display: "flex", gap: 2, height: 10 }}>
        {overview.places.map((p, i) => (
          <div
            key={p.key}
            title={`${nameOf(p.key)} · ${p.count}`}
            style={{
              flexGrow: p.count / total,
              flexBasis: 0,
              minWidth: 3,
              background: ink(i),
              borderRadius: "var(--r-xs)",
            }}
          />
        ))}
      </div>
      <Legend items={overview.places.map((p, i) => ({ color: ink(i), label: `${nameOf(p.key)} ${p.count}` }))} />
    </>
  );
}

/** ГДЕ ИЩЕТСЯ МУЗЫКА — половина картины, которой на этом экране не было вовсе.
 *
 *  ⚠️ Ради чего блок существует. Место поиска, переставшее отвечать, НИКАК не
 *  проявляется в интерфейсе: выдача просто становится однобокой, и человек
 *  читает это как решение программы. Так и вышло 13.08 — «слишком много
 *  SoundCloud и мало YouTube» оказалось не ранжированием, а месяцами
 *  незамеченной аварией. Строка «не отвечает» здесь — единственное место во
 *  всей программе, где это вообще можно увидеть. */
function SearchPlaces({
  overview,
  probe,
  dur,
  nameOf,
}: {
  overview: EngineOverview;
  probe: SearchProbeState;
  dur: (ms: number | null) => string;
  nameOf: (source: string) => string;
}) {
  const { t } = useT();

  if (probe === "error") return <Muted>{t("settings.system.stage0.overview.searchUnavailable")}</Muted>;
  if (overview.searchPlaces.length === 0) return <Muted>{t("settings.system.stage0.overview.searchEmpty")}</Muted>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      {overview.searchPlaces.map((p) => {
        const state = p.downNow
          ? t("settings.system.stage0.overview.searchDown")
          : p.level === "warn"
            ? t("settings.system.stage0.overview.searchShaky")
            : t("settings.system.stage0.overview.searchOk");
        // Правая колонка отвечает на «насколько это плохо»: у здорового места
        // это его обычное время, у молчащего — что именно ответила сеть.
        // Показывать у молчащего его былую скорость было бы издевательством.
        const detail = p.downNow
          ? (p.lastFailure ?? t("settings.system.stage0.overview.searchNoAnswer"))
          : p.medianMs !== null
            ? t("settings.system.stage0.overview.searchTiming", { value: dur(p.medianMs) })
            : t("settings.system.stage0.overview.searchNoAnswer");
        return (
          // ⚠️ Строка ОБЯЗАНА складываться. В узкой панели (а настройки на
          // телефоне именно такие) имя, состояние и причина в одну строку не
          // помещаются, и причина уезжала за край многоточием — то есть
          // пропадало ровно то единственное, ради чего блок и заведён.
          // Перенос: причина падает на свою строку, оставаясь прижатой вправо.
          <div key={p.source} style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1) var(--sp-3)", alignItems: "center" }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "var(--r-pill)",
                background: LEVEL_COLOR[p.level],
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: "var(--fs-body)", color: "var(--text-1)", flexShrink: 0 }}>{nameOf(p.source)}</span>
            <span style={{ fontSize: "var(--fs-caption)", color: LEVEL_COLOR[p.level], flexShrink: 0 }}>{state}</span>
            <span
              style={{
                fontSize: "var(--fs-caption)",
                color: "var(--text-3)",
                marginLeft: "auto",
                textAlign: "right",
                minWidth: 0,
                // Причина отказа приходит от сети и бывает длинной: даём ей
                // переноситься по словам, а не резаться. Обрезанная причина
                // ничего не объясняет, а места под неё на своей строке хватает.
                overflowWrap: "anywhere",
              }}
            >
              {detail}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{children}</div>;
}

/** Подпись под полосой. Отдельным компонентом, потому что легенда обязана
 *  брать цвет ИЗ ТОГО ЖЕ выражения, что и сама полоса: разойдись они, легенда
 *  начала бы объяснять не тот график, который нарисован. */
function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1) var(--sp-4)", marginTop: "var(--sp-2)" }}>
      {items.map((it) => (
        <span
          key={it.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            fontSize: "var(--fs-caption)",
            color: "var(--text-2)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: it.color, flexShrink: 0 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
