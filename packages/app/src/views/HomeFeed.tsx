/** ГЛАВНАЯ — общий экран приложения и веба (волна экранов веб-паритета,
 *  2026-08-02).
 *
 *  Почему переехало. До переезда главная была написана дважды. У приложения
 *  секции ленты сортировались («В тренде» и «Новое в каталоге» витринами
 *  сверху, «Для тебя» списком под ними), у веба — рисовались в порядке
 *  сервера, и первая секция всегда шла списком: человек видел «Для тебя»
 *  сразу, а полок не видел вовсе. Отличались и размеры заголовков (26/17px
 *  против дисплейных --fs-greet/--fs-title), и стрелки-листалки у полок
 *  (в вебе их не было), и отсутствие правой кнопки на плитках. Это тот самый
 *  разъезд, ради которого экраны становятся общими.
 *
 *  ЧТО ОСТАЛОСЬ У ПРИЛОЖЕНИЯ и приезжает сюда пропами (по одному на умение,
 *  а не флагом площадки — правило розетки, см. platform/types.ts):
 *   - `withSnapshot` — оффлайн-копия ленты (localStorage приложения, Stage 4).
 *     Не передали — лента просто ходит на сервер, плашки «оффлайн-копия» нет.
 *   - `warmRow` — прогрев добычи по наведению/видимости (десктопный движок).
 *   - `sourceLabel` — имя источника в строке (настройка «Строка трека»).
 *   - `onOpenWrapped` — вход в «Итоги года» (сам оверлей десктопный).
 *  Вынос файла на рабочий стол берётся из розетки (`useAltFileDrag`): в
 *  браузере хук вернёт false, и перетаскивание отработает как обычный перенос
 *  строки в плейлист.
 *
 *  ⚠️ Тут не должно появиться ни `@tauri-apps/*`, ни `import.meta.env`, ни
 *  `next/*` — файл попадает в оба бандла. */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QK } from "../lib/queryClient";
import { Button, EmptyState, Icon, Shelf, Tile, TrackRow } from "@muza/ui";
import type { HomeSection, MuzaApi, Track } from "@muza/api-client";
import { WRAPPED_BANNER_PREVIEW, WRAPPED_ENABLED, wrappedSeason } from "../lib/wrappedSeason";
import { fmtTime } from "../lib/format";
import { orderHomeSections } from "../lib/homeSections";
import { pickByOrder } from "../lib/dragEngine";
import { shelfL10n, tileL10n, trackRowL10n } from "../lib/dsLabels";
import type { RowWarmProps, WarmRow } from "../lib/rowWarm";
import { useDrag } from "../shell/DragLayer";
import { useLayout } from "../shell/LayoutContext";
import { useLookReorder } from "../shell/lookReorder";
import { useAltFileDrag } from "../platform";
import { useT } from "../i18n";
import type { TParams, TranslationKey } from "../i18n";

/** Функция перевода — тип совпадает с useT().t; передаётся параметром в
 *  свободные (module-level) функции без доступа к React-контексту (см.
 *  тот же приём в SettingsView.tsx). */
type T = (key: TranslationKey, params?: TParams) => string;

function greeting(t: T) {
  const h = new Date().getHours();
  if (h < 5) return t("views.home.greeting.night");
  if (h < 12) return t("views.home.greeting.morning");
  if (h < 18) return t("views.home.greeting.day");
  return t("views.home.greeting.evening");
}

/** Заголовок секции — ТИХИЙ КАПС (набросок владельца 04.08 вечером:
 *  «ПРОДОЛЖИТЬ», «В ТРЕНДЕ У СООБЩЕСТВА»). Секция — это подпись к полке, а не
 *  соперник h1: пока полки стояли под 20px-заголовками, у экрана было пять
 *  голосов одной громкости. Тот же голос, что у «ПЛЕЙЛИСТЫ» в сайдбаре и
 *  «СЕЙЧАС ИГРАЕТ» в панели — подписи зон говорят одинаково во всём окне. */
const sectionH2: React.CSSProperties = {
  margin: "0 0 var(--sp-3)",
  fontSize: "var(--fs-caption)",
  fontWeight: 600,
  letterSpacing: "var(--ls-caps)",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

/** «2 ч 14 мин» / «14 мин» — время прослушивания для меты шапки.
 *  Сначала округляем ДО минут, потом делим на часы: раздельное округление
 *  остатка давало «60 мин» и «1 ч 60 мин» у значений под самый час. */
function fmtListenTime(ms: number, t: (key: TranslationKey, params?: TParams) => string): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? t("views.home.meta.hoursMinutes", { h, m }) : t("views.home.meta.minutes", { m });
}

/** Форма пропсов подготовки строки — общая для всех экранов (lib/rowWarm.ts).
 *  Своё объявление тут было одним из пяти разъезжавшихся дублей. */
const NO_WARM: RowWarmProps = { ref: () => undefined, onMouseEnter: () => {}, onPointerDown: () => {} };
const noWarmRow = (): RowWarmProps => NO_WARM;

/** Площадка без оффлайн-копии: ходим на сервер и честно говорим, что данные
 *  живые (offline: false). */
const noSnapshot = async <T2,>(_key: string, request: () => Promise<T2>): Promise<{ data: T2; offline: boolean }> => ({
  data: await request(),
  offline: false,
});

/** Главная (Stage 5, T25): при серверной сессии — живая лента рекомендаций
 *  (/home: «Для тебя», «Потому что вы любите X», «В тренде», «Новое»),
 *  «Для тебя» — списком с действиями, остальные — карусели. Пустая лента и
 *  ошибка загрузки — честный текст, без подмены выдуманным контентом.
 *  Анониму лента недоступна (сервер его не знает) — раньше вместо неё
 *  показывались четыре полки выдуманных треков и плейлистов из макета
 *  Stage 1, теперь честное объяснение, что ему доступно. */
export function HomeFeed({
  api,
  canSearch,
  greetName,
  currentId,
  playing,
  likes,
  onPlayCatalog,
  rowShow,
  sourceLabel,
  onLike,
  onCatalogMenu,
  onNotify,
  onOpen,
  onOpenWrapped,
  onSections,
  sectionOrder,
  onReorderSections,
  withSnapshot = noSnapshot,
  warmRow = noWarmRow,
  padding = "var(--sp-6) var(--sp-6) 0",
}: {
  api: MuzaApi;
  /** false у анонима: сервер его не знает, лента недоступна. */
  canSearch: boolean;
  /** Ник для приветствия; null у анонима — просто «Доброе утро». */
  greetName: string | null;
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  likes: string[];
  /** Играть каталожный трек в контексте секции (очередь = секция). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** Строка трека (настройка «Строка трека»): что показывать. */
  rowShow?: { cover: boolean; duration: boolean; album: boolean; source: boolean };
  /** Имя источника для бейджа строки; нет — бейдж не рисуем даже при
   *  rowShow.source (словарь провайдеров живёт в приложении). */
  sourceLabel?: (sources: string[]) => string | undefined;
  onLike: (id: string) => void;
  /** «⋯» на каталожном треке (плейлист/версии/оффлайн/радио). */
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  /** Тост (T18: «Трека нет в кэше…» при Alt+drag файла). */
  onNotify: (text: string, icon?: string) => void;
  /** Уйти на другой экран: пустая лента зовёт поиск, аноним — библиотеку. */
  onOpen: (v: "search" | "library") => void;
  /** Открыть Wrapped «Итоги года» (Stage 7); undefined у анонима. */
  onOpenWrapped?: () => void;
  /** Лента приехала. Нужно тому, кто собирает меню по правой кнопке снаружи
   *  экрана (веб: список треков ему нужен заранее, чтобы «Лайк» и «В плейлист»
   *  знали, о каком треке речь). Приложение проп не передаёт — его меню берёт
   *  трек прямо из onCatalogMenu. */
  onSections?: (sections: HomeSection[]) => void;
  /** Порядок полок, собранный человеком (prefs.homeSections у приложения).
   *  Пусто/нет — канонический порядок, тот же, что был до появления настройки.
   *  Это ПОРЯДОК, а не состав: полки сервера, которых в списке нет, никуда не
   *  деваются (lib/homeSections.ts). */
  sectionOrder?: readonly string[];
  /** Полки переставили в режиме правки вида (Ctrl+E) — новый порядок ключей
   *  целиком. Нет обработчика — полки не хватаются. */
  onReorderSections?: (keys: string[]) => void;
  /** Оффлайн-копия ленты (приложение); нет — ходим прямо на сервер. */
  withSnapshot?: <T2>(key: string, request: () => Promise<T2>) => Promise<{ data: T2; offline: boolean }>;
  /** Готовит трек заранее (приложение); нет — пустые пропсы на обёртке строки. */
  warmRow?: WarmRow;
  /** Отступы экрана. У приложения зона `main` без полей, и их даёт сам экран;
   *  у веба поля несёт панель-зона `.main`, поэтому веб передаёт "0" —
   *  иначе поля сложились бы вдвое. */
  padding?: string;
}) {
  const { t, lang } = useT();
  const { phone } = useLayout();
  const { dragSource } = useDrag();
  const altFileDrag = useAltFileDrag();
  // Честные состояния (UX-доводка): loading / live / offline-копия /
  // сервер недоступен / пустая лента нового аккаунта / аноним (ленты нет).
  // Собираются из запроса ниже — своим состоянием больше не живут.

  /** ⚠️ ЛЕНТА ГРУЗИЛАСЬ ЗАНОВО НА КАЖДЫЙ ЗАХОД. Экран пересобирается целиком
   *  при любой навигации (`<main key={rendered}>` в App.tsx), эффект
   *  монтирования срабатывал снова — и человек каждый раз смотрел на спиннер,
   *  хотя лента менялась куда реже, чем он переключал вкладки (жалоба 12.08:
   *  «Главная грузится от полусекунды до целой»).
   *
   *  Теперь ответ живёт минуту (staleTime в lib/queryClient.ts): возврат на
   *  Главную рисует её мгновенно и обновляет в фоне. Состояние экрана из
   *  четырёх положений сохранено ровно — оно про то, ЧТО показать человеку, и
   *  к тому, откуда взялись данные, отношения не имеет. */
  const homeQuery = useQuery({
    queryKey: QK.home,
    queryFn: () => withSnapshot("home", () => api.getHome()),
    enabled: canSearch,
    throwOnError: false,
  });

  const feed = useMemo<{
    status: "loading" | "live" | "error" | "anon";
    sections: HomeSection[];
    offline: boolean;
  }>(() => {
    if (!canSearch) return { status: "anon", sections: [], offline: false };
    if (homeQuery.data) return { status: "live", sections: homeQuery.data.data, offline: homeQuery.data.offline };
    // сервер лёг и снапшота нет — говорим прямо, а не притворяемся лентой
    if (homeQuery.isError) return { status: "error", sections: [], offline: false };
    return { status: "loading", sections: [], offline: false };
  }, [canSearch, homeQuery.data, homeQuery.isError]);

  /** Кнопка «Обновить» на плашке «нет сети» и на экране отказа: спрашиваем
   *  сервер ЗАНОВО, минуя срок свежести — человек нажал именно за этим. */
  const load = () => void homeQuery.refetch();

  const sectionsData = homeQuery.data?.data;
  useEffect(() => {
    if (sectionsData) onSections?.(sectionsData);
    // onSections — колбэк хозяина, в зависимостях ему делать нечего
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsData]);

  // МЕТА В ШАПКЕ (набросок владельца 04.08 вечером): дата и «N ч M мин за
  // сегодня». Время берём из недельной сводки статистики — её последнее
  // ведро и есть сегодняшний день; отдельной ручки на сервере не нужно.
  // Провал тих по определению: мета — украшение шапки, не контент.
  //
  // ⚠️ ЭТО САМЫЙ ДОРОГОЙ ЗАПРОС ЭКРАНА: на сервере /me/stats/overview — это
  // девять агрегатов по всей истории прослушиваний, и Главная звала его на
  // КАЖДОМ монтировании ради одной строки в шапке. Держим кэш подольше ленты:
  // «сколько наслушал сегодня» не меняется, пока человек листает вкладки.
  const statsQuery = useQuery({
    queryKey: ["stats-overview", "week"],
    // Через Promise.resolve(): мета — украшение, и ЛЮБОЙ её провал обязан
    // быть тихим, включая точечные моки api в тестах, где метода нет вовсе
    // (синхронный TypeError без обёртки уронил бы всю Главную).
    queryFn: () => Promise.resolve().then(() => api.getStatsOverview("week")),
    enabled: canSearch,
    staleTime: 5 * 60_000,
    throwOnError: false,
  });
  const todayMs = statsQuery.data
    ? statsQuery.data.series.length > 0
      ? statsQuery.data.series[statsQuery.data.series.length - 1].ms
      : 0
    : null;

  const live = feed.status === "live" && feed.sections.length > 0;
  // Порядок человека, а поверх него канон для полок, которых он не трогал.
  // Сортировка стабильная: внутри одной ступени порядок сервера сохраняется.
  const sections = orderHomeSections(feed.sections, sectionOrder ?? []);
  // Перестановка полок — только в режиме правки вида. Вне его на полке нет ни
  // одного лишнего обработчика, и карусель листается как обычно.
  const shelfReorder = useLookReorder({
    ids: sections.map((s) => s.key),
    axis: "column",
    onReorder: onReorderSections,
    labelOf: (key) => t("lookEdit.group.homeSection", { name: sections.find((s) => s.key === key)?.title ?? key }),
  });
  const season = wrappedSeason();
  // WRAPPED_ENABLED — мастер-выключатель: фича спрятана до релиза (2026-07-17)
  const wrappedBanner =
    WRAPPED_ENABLED && canSearch && !!onOpenWrapped && (WRAPPED_BANNER_PREVIEW || season.inSeason);

  return (
    // Поле экрана на телефоне вдвое меньше: 24px с каждой стороны — это 48
    // пикселей строки, и уходят они у содержимого, которому ширины и не
    // хватало. Проп `padding` (его задаёт площадка) при этом сильнее — веб
    // его не передаёт, приложение передаёт своё.
    <div style={{ display: "flex", flexDirection: "column", gap: phone ? "var(--sp-5)" : "var(--sp-6)", padding: phone ? "var(--sp-4) var(--sp-4) 0" : padding }}>
      {/* ПРАВИЛО ОДНОГО DISPLAY-МОМЕНТА (редизайн 04.08, решение владельца
          «всё на Golos, без исключений»). Unbounded оставлен вордмарку,
          караоке и названию играющего трека — тому, что и есть музыка. Пока он
          звучал ещё и здесь, и в заголовке Статистики, и в админке, ни одно из
          этих мест не читалось как акцент, а заголовки экранов не складывались
          в одну ступень иерархии. Заголовок экрана теперь один на всё
          приложение: Golos 700, --fs-h1. Шрифт не задаём вовсе — наследуется
          --font-ui, и пользовательский выбор шрифта работает без исключений. */}
      {/* ⚠️ НА ТЕЛЕФОНЕ ШАПКА — СТОЛБИК, А НЕ РЯД (10.08). Приветствие и дата
          стояли в одном ряду: у даты `flex: none` и `nowrap`, то есть она не
          жмётся вовсе и на iPhone 393pt забирала ~250px из 340. Заголовку
          оставалось ~90px, он ломался на три строки и НАЕЗЖАЛ на дату — это
          и есть «элементы наплывают друг на друга» из жалобы владельца
          (снимок главной с iPhone, 10.08). Ряд правилен ровно там, где обе
          части помещаются целиком; ниже — столбик, дата уходит под заголовок
          подписью, и обе строки читаются полностью. */}
      <div
        style={{
          display: "flex",
          flexDirection: phone ? "column" : "row",
          alignItems: phone ? "stretch" : "baseline",
          gap: phone ? "var(--sp-1)" : "var(--sp-4)",
        }}
      >
        <h1
          style={{
            margin: 0,
            flex: phone ? "none" : 1,
            minWidth: 0,
            fontWeight: 600,
            fontSize: phone ? "var(--fs-title)" : "var(--fs-h1)",
            letterSpacing: "var(--ls-h1)",
            color: "var(--text-1)",
            lineHeight: "var(--lh-tight)",
            textWrap: "balance",
          }}
        >
          {greetName ? `${greeting(t)}, ${greetName}!` : greeting(t)}
        </h1>
        {/* Дата и время за сегодня — тихой строкой напротив приветствия
            (набросок 04.08). Времени нет (аноним, ноль, сервер молчит) —
            остаётся одна дата: пустой хвост « · » не рисуем. */}
        <span
          style={{
            flex: "none",
            fontSize: "var(--fs-caption)",
            color: "var(--text-3)",
            // В столбике перенос разрешён: строка «понедельник, 10 августа ·
            // 43 мин за сегодня» на 340px в одну не помещается, а обрезать
            // дату многоточием — потерять её смысл.
            whiteSpace: phone ? "normal" : "nowrap",
          }}
        >
          {new Date().toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" })}
          {todayMs !== null && todayMs > 0 ? ` · ${t("views.home.meta.today", { time: fmtListenTime(todayMs, t) })}` : ""}
        </span>
      </div>

      {feed.offline ? (
        <Notice icon="cloud-off" text={t("views.home.notice.offlineText")} action={t("views.home.notice.refresh")} onAction={load} />
      ) : null}

      {/* Wrapped (Stage 7): баннер-вход в «Итоги года» — сезонно (декабрь
          текущий год, январь прошлый); WRAPPED_BANNER_PREVIEW держит его
          видимым круглый год, пока владелец смотрит результат */}
      {wrappedBanner ? (
        <button
          type="button"
          onClick={onOpenWrapped}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-5)",
            padding: "var(--sp-4) var(--sp-5)",
            border: "none",
            borderRadius: "var(--r-md)",
            // ГРАДИЕНТ УБРАН (редизайн 04.08). Он был ЕДИНСТВЕННЫМ в
            // приложении и прямо нарушал собственный запрет системы («никаких
            // теней, свечений, градиентов и рамок-разделителей; зоны разделяет
            // только прозрачность фона» — PRODUCT.md, правило владельца).
            // Сам баннер жив: это вход в «итоги года», а не украшение. Акцент
            // теперь несут краска года и мягкая акцентная заливка — тем же
            // токеном, что подсветка выбранного во всём приложении.
            background: "var(--accent-soft)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              // Год — цифра, а не заголовок: своя ступень шкалы (--fs-num),
              // а не сырые 34px и не display-шрифт (правило одного
              // display-момента, редизайн 04.08).
              fontSize: "var(--fs-num)",
              fontWeight: 600,
              letterSpacing: "var(--ls-num)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              color: "var(--accent-text)",
              flex: "none",
            }}
          >
            {season.year}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "var(--fs-body)", fontWeight: 400, color: "var(--text-1)" }}>
              {t("views.home.wrappedBanner.title", { year: season.year })}
            </span>
            <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
              {t("views.home.wrappedBanner.hint")}
            </span>
          </span>
          <Icon name="chevron-right" size={18} color="var(--text-3)" />
        </button>
      ) : null}

      {feed.status === "loading" ? (
        <FeedSkeleton />
      ) : feed.status === "error" ? (
        // T25: честная ошибка без демо-заглушек — залогиненному не подсовываем
        // вымышленный каталог вместо реальной ленты, даже с пометкой.
        <Notice
          icon="server-off"
          text={t("views.home.notice.errorText")}
          action={t("views.home.notice.retry")}
          onAction={load}
        />
      ) : feed.status === "live" && sections.length === 0 ? (
        // T25: реально пустая лента (новый аккаунт без сигнала) — честный
        // текст, а не демо-полки: это не «примеры», это заглушка под чужим видом.
        <Notice
          icon="sparkles"
          text={t("views.home.notice.emptyText")}
          action={t("views.home.notice.openSearch")}
          onAction={() => onOpen("search")}
        />
      ) : null}

      {live ? (
        <>
          {/* ОБЁРТКА У КАЖДОЙ ПОЛКИ — БЕЗУСЛОВНАЯ. Она нужна режиму правки
              (это то, что едет за пальцем при перестановке), но появляться
              только в нём не может: полка меняла бы родителя на входе в режим,
              а с ним теряла бы прокрутку карусели и позицию. Вне режима на
              обёртке нет ни обработчиков, ни стилей — раскладка та же, что
              была (лента и так рисовала по одному узлу на полку). */}
          {pickByOrder(sections, (s) => s.key, shelfReorder.order).map((s) => {
            const look = shelfReorder.itemProps(s.key);
            return (
            <div key={s.key} {...look} style={look.style}>
            {s.key === "for_you" ? (
              // «Для тебя» — главный контент: список с лайками и меню
              <div>
                <h2 style={sectionH2}>{s.title}</h2>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {s.tracks.map((tr, i) => (
                    // T18 draggable: drag строки — в плейлист, Alt+drag — файл на рабочий стол
                    <div
                      key={tr.id}
                      draggable
                      onDragStart={(e) => {
                        // Только Alt и только там, где площадка умеет выносить
                        // файл, — см. комментарий в dragSource.
                        if (altFileDrag(e, (d) => d.exportTrackFile(tr), (m) => onNotify(m, "x"))) return;
                        e.preventDefault();
                      }}
                      {...dragSource({ id: tr.id, title: tr.title, artist: tr.artist, cover: tr.coverUrl, kind: "track" })}
                      {...warmRow(tr.id)}
                    >
                      <TrackRow
                        {...trackRowL10n(t)}
                        compact={phone}
                        index={i + 1}
                        cover={tr.coverUrl}
                        showCover={rowShow?.cover !== false}
                        title={tr.title}
                        artist={tr.artist}
                        album={rowShow?.album ? (tr.album ?? undefined) : undefined}
                        duration={fmtTime(tr.durationSec)}
                        showDuration={rowShow?.duration !== false}
                        source={rowShow?.source ? sourceLabel?.(tr.sources) : undefined}
                        active={currentId === tr.id}
                        playing={currentId === tr.id && playing}
                        liked={likes.includes(tr.id)}
                        onPlay={() => onPlayCatalog(s.tracks, tr.id)}
                        onLike={() => onLike(tr.id)}
                        onMore={(e: React.MouseEvent) => onCatalogMenu(tr, e)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // остальные секции — карусели (T17: ПКМ по плитке = меню «⋯»;
              // T18: плитка тоже draggable — у свежей ленты бывают только карусели)
              <Shelf title={s.title} {...shelfL10n(t)}>
                {s.tracks.map((tr) => (
                  <div
                    key={tr.id}
                    draggable
                    onDragStart={(e) => {
                      // Только Alt — см. комментарий в dragSource.
                      if (altFileDrag(e, (d) => d.exportTrackFile(tr), (m) => onNotify(m, "x"))) return;
                      e.preventDefault();
                    }}
                    {...dragSource({ id: tr.id, title: tr.title, artist: tr.artist, cover: tr.coverUrl, kind: "track" })}
                    style={{ flex: "none" }}
                  >
                    <Tile
                      {...tileL10n(t)}
                      // Нет обложки → плейсхолдер рисует Cover внутри Tile.
                      // Здесь лежал свой data:svg-градиент: плитка без арта
                      // выглядела иначе, чем строка без арта, хотя состояние
                      // одно и то же.
                      cover={tr.coverUrl}
                      title={tr.title}
                      subtitle={tr.artist}
                      playing={currentId === tr.id && playing}
                      onPlay={() => onPlayCatalog(s.tracks, tr.id)}
                      onClick={() => onPlayCatalog(s.tracks, tr.id)}
                      onMenu={(e: React.MouseEvent) => onCatalogMenu(tr, e)}
                    />
                    {tr.reason ? (
                      // ⚠️ ПРИЧИНА ВИДНА, А НЕ СПРЯТАНА В ПОДСКАЗКУ (H5, 13.08).
                      // Замер Berkeley (600 оценённых рекомендаций): при
                      // понятной причине средняя оценка трека 3.51 против 2.79
                      // и уверенность 8.12 против 6.89 — но это работает,
                      // только если человек её ВИДИТ. Спрятать в title= значило
                      // бы получить ноль пользы и считать задачу закрытой.
                      //
                      // Одна строка и многоточие: Kouki et al. 2019 —
                      // подробные объяснения дают перегрузку и нравятся хуже
                      // коротких. Полный текст остаётся в подсказке ровно на
                      // случай обрезки.
                      <div
                        title={tr.reason.text}
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          lineHeight: 1.3,
                          color: "var(--text-muted, #888)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "var(--w-tile, 176px)",
                        }}
                      >
                        {tr.reason.text}
                      </div>
                    ) : null}
                  </div>
                ))}
              </Shelf>
            )}
            </div>
            );
          })}
          <div style={{ paddingBottom: "var(--sp-6)" }} />
        </>
      ) : feed.status === "anon" ? (
        // Аноним: ленты нет и быть не может — сервер его не знает. Раньше сюда
        // подставлялись четыре полки выдуманных треков/плейлистов из макета
        // Stage 1 (пусть и с подписью «демо»). Честнее сказать, что доступно.
        <EmptyState
          icon="user"
          title={t("views.home.anon.title")}
          hint={t("views.home.anon.hint")}
          action={
            <Button variant="secondary" icon="folder-open" onClick={() => onOpen("library")}>
              {t("views.home.anon.action")}
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

/** Плашка состояния: оффлайн-копия / сервер недоступен / пустая лента. */
function Notice({
  icon,
  text,
  action,
  onAction,
}: {
  icon: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
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

/** Скелетон ленты: заголовок + ряд плиток, три секции. Без анимации-мерцания
 *  (ДС запрещает свечения) — просто тихие поверхности. */
function FeedSkeleton() {
  const { t } = useT();
  const tile = (
    <div style={{ width: 176, flex: "none" }}>
      <div style={{ width: "100%", aspectRatio: "1", borderRadius: "var(--r-md)", background: "var(--surface-2)" }} />
      <div style={{ height: 12, width: "70%", marginTop: 10, borderRadius: 6, background: "var(--surface-2)" }} />
      <div style={{ height: 10, width: "45%", marginTop: 6, borderRadius: 5, background: "var(--surface-1)" }} />
    </div>
  );
  return (
    <div aria-label={t("views.home.skeletonAria")} role="status" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {[0, 1, 2].map((s) => (
        <div key={s}>
          <div style={{ height: 16, width: 160, borderRadius: 8, background: "var(--surface-2)", marginBottom: "var(--sp-4)" }} />
          <div style={{ display: "flex", gap: "var(--sp-4)", overflow: "hidden" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i}>{tile}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
