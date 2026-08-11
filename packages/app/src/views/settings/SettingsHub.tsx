/** ВХОД В НАСТРОЙКИ — сетка карточек разделов вместо второго рельса.
 *
 *  ЗАЧЕМ. Жалоба владельца 04.08: «мне не нравится, что два одинаковых сайдбара
 *  стоят рядом — это совсем не выглядит». Рельс настроек повторял главный
 *  сайдбар формой, материалом и метрикой пункта (48px), стоял к нему вплотную —
 *  и окно читалось как две навигации подряд, без понятной разницы между ними.
 *
 *  ЧТО ВМЕСТО. Настройки открываются сеткой карточек: иконка, название и одна
 *  строка о том, что внутри. Клик уводит в раздел, возврат — кнопкой в его
 *  шапке. Второй колонки не остаётся вовсе, и раздел получает всю ширину окна.
 *
 *  ЧЕМ ПЛАТИМ, ЧЕСТНО: переход между двумя разделами теперь стоит двух кликов
 *  вместо одного (назад, потом в другой). Владелец выбрал этот размен сам,
 *  зная о нём. Смягчено поиском — он по-прежнему уводит прямо в нужный ряд,
 *  минуя и сетку, и раздел.
 *
 *  РАСКЛАДКУ МОЖНО СОБРАТЬ САМОМУ (режим правки вида, Ctrl+E — 04.08). Заявка
 *  владельца: «аккаунт мы могли бы перенести в центр, Lyrics — в первый ряд…
 *  плашки можно менять местами и варьировать их размеры, и чтобы при этом они
 *  адаптировались и выглядели хорошо… блокировать увеличение, если места не
 *  хватает». Порядок и ширина живут в prefs.settingsCards (settingsCards.ts),
 *  число колонок спрашивается у самой сетки — см. useGridColumns ниже. */

import { useEffect, useRef, useState } from "react";
import { cssZoom, Icon } from "@muza/ui";
import { useT, type TranslationKey } from "../../i18n";
import { applyVisibleOrder, pickByOrder } from "../../lib/dragEngine";
import type { SettingsCapability } from "../../lib/settingsIndex";
import { useLookEdit, useLookReorder } from "../../shell/lookReorder";
import { SETTINGS_TAB_ICONS, type SettingsTabKey } from "./SettingsNav";
import {
  cardSpan,
  normalizeSettingsCards,
  SETTINGS_CARD_MAX_ROWS,
  SETTINGS_CARD_MAX_SPAN,
} from "./settingsCards";
import { useSettingsScreen } from "./settingsContext";

/** Зазор сетки — тот же токен, что в разметке ниже; ручке ширины он нужен
 *  числом, чтобы считать, на сколько дорожек уехал курсор. */
const GRID_GAP_VAR = "--sp-3";

/** ПОДПИСЬ КАРТОЧКИ СОБИРАЕТСЯ ИЗ ЧАСТЕЙ, А НЕ ПИШЕТСЯ ЦЕЛЬНОЙ СТРОКОЙ (2026-08-11).
 *
 *  Подпись — единственное обещание, которое карточка даёт до клика: «внутри
 *  вот это». Пока она была одной строкой на все площадки, обещание врало —
 *  состав рядов зависит от умений. Замер в браузере: «Воспроизведение»
 *  подписано «…таймер сна, вывод», «Медиатека» — «Локальные файлы, скачанное и
 *  оффлайн», «Система» — «Автозапуск, трей, обновления и мини-плеер», а внутри
 *  этих рядов нет НИ ОДНОГО (у «Системы» остаётся только «О программе»).
 *
 *  Второй строки «а для браузера вот такая подпись» здесь быть не может — это
 *  ровно тот разъезд, ради устранения которого 11.08 удалили последние копии
 *  разделов. Поэтому части перечислены ОДИН раз, и каждая помечена тем же
 *  умением, что и её ряд: нет умения — часть не попадает в подпись.
 *
 *  Раздела нет в этой карте — подпись берётся строкой `settings.hub.<раздел>`:
 *  так подписаны разделы, состав которых от площадки не зависит вовсе
 *  («Аккаунт», «Внешний вид», «Тексты», «Клавиши», «Расширения»).
 *
 *  ⚠️ Первая часть КАЖДОГО списка обязана быть без умения, иначе на площадке
 *  без него подпись схлопнется в пустоту. */
const HUB_PARTS: Partial<Record<SettingsTabKey, readonly { key: string; needs?: SettingsCapability }[]>> = {
  playback: [
    { key: "settings.hub.parts.crossfade" },
    { key: "settings.hub.parts.equalizer" },
    { key: "settings.hub.parts.speed" },
    { key: "settings.hub.parts.sleepTimer", needs: "sleepTimer" },
    { key: "settings.hub.parts.outputs", needs: "audioOutputs" },
  ],
  sources: [
    // Порядок обратный привычному нарочно: «как ведёт себя поиск» есть везде, а
    // «откуда берутся треки» — только там, где программа сама добывает звук.
    { key: "settings.hub.parts.searchBehavior" },
    { key: "settings.hub.parts.sourceOrigin", needs: "sourcePicker" },
  ],
  library: [
    { key: "settings.hub.parts.playlistImport" },
    { key: "settings.hub.parts.stats" },
    { key: "settings.hub.parts.localFiles", needs: "localFiles" },
    { key: "settings.hub.parts.offline", needs: "offlineCache" },
  ],
  integrations: [
    { key: "settings.hub.parts.lastfm" },
    { key: "settings.hub.parts.listenbrainz" },
    { key: "settings.hub.parts.mediaKeys" },
    { key: "settings.hub.parts.discord", needs: "discord" },
  ],
  system: [
    { key: "settings.hub.parts.about" },
    { key: "settings.hub.parts.autostart", needs: "autostart" },
    { key: "settings.hub.parts.tray", needs: "tray" },
    { key: "settings.hub.parts.updates", needs: "updates" },
    { key: "settings.hub.parts.miniPlayer", needs: "miniPlayer" },
  ],
};

/** Сколько дорожек нарезала сетка ПРЯМО СЕЙЧАС и какой они ширины.
 *
 *  Спрашиваем сам DOM (gridTemplateColumns у посчитанного стиля), а не считаем
 *  из minmax(260px, 1fr) — ровно по тем же основаниям, что режим правки меряет
 *  края зон вместо пересчёта из токенов: формула раскладки не должна жить в
 *  двух местах и разъезжаться на первом же изменении. */
function useGridColumns(ref: React.RefObject<HTMLDivElement | null>): {
  count: number;
  width: number;
  gap: number;
  rowGap: number;
} {
  const [grid, setGrid] = useState({ count: 1, width: 0, gap: 0, rowGap: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const tracks = cs.gridTemplateColumns.split(" ").filter(Boolean);
      // ⚠️ НА ЗУМ ЗДЕСЬ ДЕЛИТЬ НЕЛЬЗЯ, и раньше делили. getComputedStyle
      // отдаёт CSS-пиксели САМОГО элемента, то есть уже в единицах зумленного
      // поддерева; на зум делят только getBoundingClientRect, который говорит
      // экранными. Лишнее деление на 85 % / 125 % давало шаг дорожки в полтора
      // раза не тот, и ручка ширины считала колонки мимо. Курсор ниже
      // приводится к тем же единицам (clientX / zoom) — обе стороны сходятся.
      const width = tracks.length > 0 ? parseFloat(tracks[0]) || 0 : 0;
      setGrid({
        count: Math.max(1, tracks.length),
        width,
        gap: parseFloat(cs.columnGap) || 0,
        rowGap: parseFloat(cs.rowGap) || 0,
      });
    };
    measure();
    // ResizeObserver есть не везде, где этот экран рисуется: в jsdom тестов
    // его нет вовсе, и без запасного пути падал бы весь вход в настройки, а не
    // одна ручка ширины. Окно там не меняется — одного замера достаточно.
    if (typeof ResizeObserver !== "function") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return grid;
}

export function SettingsHub({
  tabs,
  onOpen,
}: {
  /** Разделы, доступные на этой площадке (умения розетки уже применены). */
  tabs: readonly SettingsTabKey[];
  onOpen: (tab: SettingsTabKey) => void;
}) {
  const { t } = useT();
  const { prefs, set, caps } = useSettingsScreen();
  const { active: lookEdit, pushUndo } = useLookEdit();

  /** Подпись карточки: список частей, доступных ЭТОЙ площадке, либо цельная
   *  строка раздела (см. HUB_PARTS). Последняя часть присоединяется связкой
   *  («и» / «and»), первая буква поднимается здесь — части написаны строчными,
   *  чтобы их можно было ставить в любом месте перечисления. */
  const hubHint = (key: SettingsTabKey): string => {
    const parts = HUB_PARTS[key];
    if (!parts) return t(`settings.hub.${key}` as TranslationKey);
    const shown = parts.filter((p) => !p.needs || caps.has(p.needs)).map((p) => t(p.key as TranslationKey));
    if (shown.length === 0) return "";
    const text =
      shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")}${t("settings.hub.and")}${shown[shown.length - 1]}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const gridRef = useRef<HTMLDivElement | null>(null);
  const columns = useGridColumns(gridRef);

  // Раскладка нормализуется против ПОЛНОГО списка разделов, а на экран идут
  // только доступные площадке: карточка «Расширения», которой в браузере нет,
  // не теряет своё место в профиле (см. шапку settingsCards.ts).
  const layout = normalizeSettingsCards(prefs.settingsCards);
  const cards = layout.filter((c) => tabs.includes(c.key as SettingsTabKey));

  const commit = (next: typeof layout) => {
    pushUndo({ settingsCards: prefs.settingsCards });
    set({ settingsCards: next });
  };

  const reorder = useLookReorder({
    ids: cards.map((c) => c.key),
    axis: "grid",
    onReorder: (keys) => commit(applyVisibleOrder(layout, (c) => c.key, keys)),
    labelOf: (key) => t("lookEdit.group.settingsCard", { name: t(`settings.tabs.${key}` as TranslationKey) }),
  });

  /** Сколько колонок окно вообще даёт выбрать. Меньше двух — выбора нет, и
   *  ручки ширины у карточки не будет вовсе (правило розетки: нечем
   *  воспользоваться — нет и элемента). */
  const maxSpan = Math.min(SETTINGS_CARD_MAX_SPAN, Math.max(1, columns.count));

  const setSpan = (key: string, span: number) => {
    const now = cards.find((c) => c.key === key)?.span ?? 1;
    const want = Math.max(1, Math.min(span, SETTINGS_CARD_MAX_SPAN));
    // ⚠️ ПРОСЯТ ШИРЕ, ЧЕМ ОКНО МОЖЕТ ПОКАЗАТЬ — БЛОКИРУЕМ, НО НИЧЕГО НЕ ПИШЕМ.
    // Владелец просил именно блокировать («блокировать увеличение, если места
    // не хватает»). Раньше «хочу шире» на узком окне зажималось потолком до
    // ЕДИНИЦЫ и молча записывалось — то есть Shift+→ у карточки на две колонки
    // необратимо делал её узкой: расширить обратно на том же окне уже нельзя.
    // Отказ должен быть отказом, а не тихим сужением.
    if (want > maxSpan) return;
    if (want === now) return;
    commit(layout.map((c) => (c.key === key ? { ...c, span: want } : c)));
  };

  const setRows = (key: string, rows: number) => {
    const now = cards.find((c) => c.key === key)?.rows ?? 1;
    // У высоты потолка от окна нет: рядов сетка нарезает столько, сколько
    // нужно, а экран настроек прокручивается.
    const want = Math.max(1, Math.min(rows, SETTINGS_CARD_MAX_ROWS));
    if (want === now) return;
    commit(layout.map((c) => (c.key === key ? { ...c, rows: want } : c)));
  };

  /** Тяга за край карточки. Отдельный жест от перестановки и потому свой
   *  обработчик: перестановка ловится на всей карточке, а размер — только на
   *  узкой полосе у края, и первым делом гасит всплытие, иначе оба жеста
   *  стартовали бы с одного нажатия.
   *
   *  Один обработчик на обе оси: разница только в том, какую координату курсора
   *  читать, каким шагом делить и куда потом писать. Двух копий этой механики в
   *  файле быть не должно — разъедутся на первой же правке. */
  const sizeGrip = (
    axis: "x" | "y",
    from: number,
    /** Шаг в единицах настройки. Получает саму ручку — от неё дотягиваются до
     *  карточки (parentElement), когда шаг зависит от её живого размера. */
    step: (grip: HTMLElement) => number,
    apply: (value: number) => void,
  ) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const zoom = cssZoom(el) || 1;
      const start = (axis === "x" ? e.clientX : e.clientY) / zoom;
      let want = from;
      const move = (ev: PointerEvent) => {
        const s = step(el);
        if (s <= 0) return;
        want = Math.max(1, Math.round(from + ((axis === "x" ? ev.clientX : ev.clientY) / zoom - start) / s));
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        apply(want);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
  });

  /** Высота ОДНОГО ряда сетки. Спрашиваем у самой карточки, а не считаем из
   *  токенов: ряды выровнены по самому высокому содержимому (gridAutoRows: 1fr),
   *  и никакая формула это число не воспроизведёт. */
  const rowStep = (el: HTMLElement | null, rows: number): number => {
    if (!el) return 0;
    const zoom = cssZoom(el) || 1;
    const h = el.getBoundingClientRect().height / zoom;
    return (h - columns.rowGap * (rows - 1)) / rows + columns.rowGap;
  };

  return (
    <div
      ref={gridRef}
      style={{
        display: "grid",
        // Та же текучая сетка, что в Медиатеке и Статистике: на узком окне одна
        // колонка, на широком три. Карточка не должна быть уже 260px — в неё
        // обязана влезть строка описания без переносов на каждом слове.
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        // ВСЕ РЯДЫ ОДНОЙ ВЫСОТЫ. По умолчанию строка сетки меряется по своему
        // самому высокому содержимому, поэтому ряд с двухстрочными описаниями
        // выходил выше ряда с однострочными, а «Система» — единственная в
        // последнем ряду — оказывалась заметно ниже всех (жалоба владельца
        // 04.08). 1fr раздаёт всем рядам высоту самого высокого.
        gridAutoRows: "1fr",
        gap: `var(${GRID_GAP_VAR})`,
        // Воздух под шапкой экрана: карточки касались поля поиска — у сетки, в
        // отличие от разделов, нет своего paneStyle с полем сверху.
        paddingTop: "var(--sp-5)",
        paddingBottom: "var(--sp-6)",
      }}
    >
      {/* Живой порядок жеста: перестановка видна СРАЗУ, а не после отпускания. */}
      {pickByOrder(cards, (c) => c.key, reorder.order).map(({ key, span, rows }) => {
        const look = reorder.itemProps(key);
        // Ширина ПРИМЕНЯЕТСЯ по месту, а не переписывает настройку: окно сузили
        // — карточка встала в одну колонку, расширили обратно — вернула свою.
        const shown = cardSpan(span, columns.count);
        const canWiden = maxSpan >= 2;
        // Высокая карточка перестраивается в «кубик»: значок сверху, подпись
        // под ним, содержимое занимает всю высоту. В строку икона и текст
        // читались бы как обычная карточка, которой зачем-то отсыпали пустоты.
        const tall = rows > 1;
        return (
          <button
            key={key}
            type="button"
            className="muza-press"
            onClick={() => onOpen(key as SettingsTabKey)}
            ref={look.ref}
            tabIndex={look.tabIndex}
            aria-label={look["aria-label"]}
            onPointerDown={look.onPointerDown}
            onKeyDown={(e) => {
              // Размер с клавиатуры — Shift+стрелки: голые стрелки уже заняты
              // перестановкой, и отбирать их у неё нельзя. Горизонталь —
              // ширина, вертикаль — высота, ровно как у ручек по краям.
              if (lookEdit && e.shiftKey) {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  e.stopPropagation();
                  // Окно не даёт выбора по ширине — клавиша молчит, а не сужает
                  // карточку в ответ на «расширь» (см. setSpan).
                  if (canWiden) setSpan(key, span + (e.key === "ArrowRight" ? 1 : -1));
                  return;
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  e.stopPropagation();
                  setRows(key, rows + (e.key === "ArrowDown" ? 1 : -1));
                  return;
                }
              }
              look.onKeyDown?.(e);
            }}
            onClickCapture={look.onClickCapture}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: tall ? "column" : "row",
              alignItems: "flex-start",
              justifyContent: tall ? "flex-end" : undefined,
              gap: "var(--sp-3)",
              padding: "var(--pad-tile)",
              border: "none",
              borderRadius: "var(--r-md)",
              background: "var(--surface-2)",
              color: "var(--text-1)",
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
              gridColumn: shown > 1 ? `span ${shown}` : undefined,
              gridRow: rows > 1 ? `span ${rows}` : undefined,
              transition: "background var(--dur-state) var(--ease-standard), transform var(--dur-press-out) var(--ease-out)",
              ...look.style,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
          >
            <Icon
              name={SETTINGS_TAB_ICONS[key as SettingsTabKey]}
              size={tall ? 28 : 20}
              color="var(--accent-text)"
              style={tall ? { marginTop: "auto" } : undefined}
            />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "var(--fs-strong)", fontWeight: 600 }}>
                {t(`settings.tabs.${key}` as TranslationKey)}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  fontSize: "var(--fs-caption)",
                  color: "var(--text-2)",
                  lineHeight: "var(--lh-ui)",
                }}
              >
                {hubHint(key as SettingsTabKey)}
              </span>
            </span>
            {/* РУЧКИ РАЗМЕРА — только в режиме правки. Ширина появляется лишь
                когда колонок хватает: не серая и не «нажми, ничего не будет» —
                нечем воспользоваться, нет и ручки (правило розетки, то же, что
                у кнопок площадки). Высота есть всегда: рядов сетка нарежет
                сколько нужно. Сами полосы невидимы, как и ручки краёв зон:
                режим правки не должен превращать окно в чертёж. */}
            {lookEdit && canWiden ? (
              <span
                {...sizeGrip("x", span, () => columns.width + columns.gap, (v) => setSpan(key, v))}
                data-testid={`settings-card-width-${key}`}
                aria-hidden="true"
                style={{ position: "absolute", top: 0, right: 0, bottom: 10, width: 10, cursor: "col-resize", touchAction: "none" }}
              />
            ) : null}
            {lookEdit ? (
              <span
                {...sizeGrip("y", rows, (g) => rowStep(g.parentElement, rows), (v) => setRows(key, v))}
                data-testid={`settings-card-height-${key}`}
                aria-hidden="true"
                style={{ position: "absolute", left: 0, right: 10, bottom: 0, height: 10, cursor: "row-resize", touchAction: "none" }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
