/** ПАНЕЛЬ ОЧЕРЕДИ — одна на обе программы (Э3 веб-паритета, 2026-08-02).
 *
 *  Секции «История / Сейчас / Далее», удаление/перестановка/очистка хвоста,
 *  «Сохранить как плейлист», «К текущему». Фокус при открытии — в панель, при
 *  закрытии вызыватель возвращает его на кнопку очереди.
 *
 *  ── ПЕРЕДЕЛКА 2026-08-13 (жалоба владельца: «в очереди всё запутано и
 *  смешано») ──────────────────────────────────────────────────────────────
 *  Четыре причины путаницы, все сняты; подробности — у мест, где они сняты:
 *   1. История пряталась под раскрывашку → список открывался с середины, и
 *      «Далее» начиналось с номера 6. Теперь ОДИН НЕПРЕРЫВНЫЙ СПИСОК.
 *   2. Номер был абсолютным индексом в массиве → у хвоста он теперь
 *      ОТНОСИТЕЛЬНЫЙ («через сколько играет»), у истории его нет.
 *   3. Ряд ПЕРЕКЛАДЫВАЛСЯ под курсором: длительность исчезала, на её место
 *      вставали кнопки другой ширины → колонка действий фиксирована (ACTIONS_W).
 *   4. «Сейчас играет» красился очередной серой плёнкой и терялся среди
 *      наведения → красится акцентом, сыгранное приглушено.
 *  Разделители стали ЛИПКИМИ: у сплошного списка это единственный способ
 *  всегда знать, в какой его части ты находишься.
 *  ⚠️ Ключи dialogs.queue.collapse / showCount осиротели вместе с раскрывашкой —
 *  в словарях оставлены, чистка словарей идёт отдельной волной.
 *
 *  ⚠️ ЗАКРЫТАЯ ПАНЕЛЬ ЖИВЁТ В ДЕРЕВЕ ЕЩЁ ~180 мс (2026-08-05) — столько идёт
 *  уход (.muza-layer--panel). До этого узел снимался кадром, и ранний возврат
 *  null держал ТРИ вещи разом: вид, слушатель pointerdown «закрыть кликом
 *  мимо» и невидимые кнопки вне обхода Tab. Уходящая панель обязана не делать
 *  ни одного из этих трёх дел: inert (из layerProps) убирает её из Tab и
 *  хит-теста, pointer-events:none пропускает клики сквозь неё к плеер-бару под
 *  ней, а слушатель закрытия по-прежнему висит ТОЛЬКО пока open.
 *
 *  Переехало из apps/desktop/src/shell/QueuePanel.tsx; на старом месте пенёк-
 *  обёртка, которая доставляет два умения приложения (см. ниже). В вебе
 *  очереди не было вовсе — теперь она та же самая.
 *
 *  ДВА ВНЕДРЕНИЯ вместо прямых импортов приложения:
 *  1) `menu` — контекстное меню. Его механика (один <Menu> на приложение,
 *     сборка пунктов по роли) живёт в apps/desktop и в общий пакет пока не
 *     переезжала. Панель просто не показывает того, чего ей не дали: нет
 *     `menu` — нет ПКМ по выделению и нет двух пунктов в панели выделения.
 *  2) `toCatalog` — как из трека очереди получить каталожную форму. Знание
 *     доменное (у приложения в очереди могут стоять файлы с диска, у веба —
 *     нет), общему компоненту его знать незачем.
 *
 *  ⚠️ СЧЁТЧИК ВЫДЕЛЕНИЯ. В меню уходит КАТАЛОЖНЫЙ список (`tracks`), и файлы
 *  с диска в него не превращаются — он короче реального выделения. Поэтому
 *  рядом обязательно едет `count` с полным числом: без него в меню стояло
 *  «Выбрано: 2», а убиралось 3 (разбор 2026-08-02). Не заменяй count на
 *  tracks.length. */

import { useEffect, useRef, useState } from "react";
import type { Track } from "@muza/api-client";
import { Cover, Icon, IconButton, useLayerState } from "@muza/ui";
import { fmtTime } from "../lib/format";
import { useMultiSelect } from "../lib/useMultiSelect";
import { SelectionBar } from "./SelectionBar";
import { useT } from "../i18n";

/** Трек в терминах очереди: ровно то, что панель показывает. */
export interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  cover: string | null;
  duration: number;
}

/** Цель ПКМ по выделению. Форма — подмножество ContextTarget приложения
 *  (apps/desktop/src/shell/contextTargets.ts), чтобы обработчик приложения
 *  подходил сюда без приведения типов. */
export interface QueueSelectionTarget {
  kind: "selection";
  /** Каталожная форма выделенного — КОРОЧЕ выделения, см. шапку про count. */
  tracks: Track[];
  /** Сколько выделено на самом деле. */
  count: number;
  place: "queue";
  ctl: {
    remove?: { scope: "queue"; run: () => void };
    clear: () => void;
  };
}

/** Контекстное меню, каким его видит панель. Даёт вызыватель. */
export interface QueueMenuPort {
  openMenu: (e: React.MouseEvent, target: QueueSelectionTarget) => void;
  /** Общие действия для панели массового выделения. Читается В ОБРАБОТЧИКЕ:
   *  ссылка стабильна, содержимое обновляется каждым рендером. */
  ctx: { current: { addManyToPlaylist: (tracks: Track[]) => void; likeMany: (ids: string[]) => void } };
}

/** Ширина правой колонки ряда. ОДНО ЧИСЛО НА ДВА СОДЕРЖИМЫХ — и это несущая
 *  деталь, а не подгонка: в покое здесь стоит длительность, под курсором — до
 *  трёх кнопок, и колонка обязана быть одинаковой в обоих состояниях. До
 *  13.08 её не было вовсе: длительность ИСЧЕЗАЛА и на её место вставал блок
 *  кнопок другой ширины, поэтому ряд перекладывался под курсором — название
 *  дёргалось, цифры пропадали. Это и был главный источник «в очереди всё
 *  запутано и смешано»: список менял форму от одного движения мышью.
 *  84 = три кнопки по 26 + два зазора по 3. */
const ACTIONS_W = 84;

function QueueRow<T extends QueueTrack>({
  track,
  position,
  current,
  played,
  playing,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  onMenu,
  selected = false,
  onClickCapture,
}: {
  track: T;
  /** Номер В ХВОСТЕ («через сколько играет»); null — номера у ряда нет. */
  position: number | null;
  current: boolean;
  /** Ряд уже отзвучал: приглушается целиком (см. комментарий о dim ниже). */
  played: boolean;
  playing: boolean;
  onPlay: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** ПКМ по строке (2026-07-20) — контекстное меню очереди. */
  onMenu?: (e: React.MouseEvent) => void;
  /** Строка в множественном выделении (2026-07-20). */
  selected?: boolean;
  /** Capture-перехват клика для выделения (Ctrl/Shift/режим). */
  onClickCapture?: (e: React.MouseEvent) => void;
}) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  // кнопки видимы при наведении И при клавиатурном фокусе внутри ряда
  const showActions = (hover || focused) && (onMoveUp || onMoveDown || onRemove);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
      onContextMenu={onMenu}
      onClickCapture={onClickCapture}
      aria-selected={selected || undefined}
      data-queue-row
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "var(--sp-2)",
        borderRadius: "var(--r-sm)",
        // ТЕКУЩИЙ — АКЦЕНТОМ, а не очередной серой плёнкой. Плёнки элевации
        // (surface-2/3/4) отличаются друг от друга на 3 % альфы: «сейчас
        // играет» тонул среди наведения и выделения, и найти себя в списке
        // глазом было нельзя — приходилось искать синий текст. Выделение
        // по-прежнему сильнее (surface-4): это временное состояние поверх.
        background: selected
          ? "var(--surface-4)"
          : current
            ? "var(--accent-soft)"
            : hover
              ? "var(--surface-2)"
              : "transparent",
        // СЫГРАННОЕ ПРИГЛУШЕНО ЦЕЛИКОМ (обложка тоже). Разделители подписаны
        // словами, но глаз читает список раньше, чем подписи: разница в
        // плотности сразу говорит, где «было», а где «будет», и одна прокрутка
        // мимо ярлыка больше не сбивает.
        opacity: played && !selected ? 0.45 : 1,
        transition: "background var(--dur-state) var(--ease-standard), opacity var(--dur-state) var(--ease-standard)",
      }}
      data-queue-current={current || undefined}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={t("dialogs.queue.playAria", { artist: track.artist, title: track.title })}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          flex: 1,
          minWidth: 0,
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* НОМЕР ТОЛЬКО У ХВОСТА И ТОЛЬКО ОТНОСИТЕЛЬНЫЙ (1, 2, 3 = «через
            сколько»). Раньше здесь стоял АБСОЛЮТНЫЙ номер в очереди, и при
            свёрнутой истории список «Далее» начинался с шестёрки — человек
            видел пять несуществующих треков перед первым. Номер в очереди
            отвечает на «когда заиграет», а не «какой он по счёту в массиве».
            У истории номера нет вовсе: «минус третий» — не число, а шум. */}
        <span
          style={{
            width: 20,
            flex: "none",
            textAlign: "right",
            fontSize: "var(--fs-caption)",
            color: "var(--text-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {current ? <Icon name={playing ? "volume-2" : "pause"} size={14} color="var(--accent-text)" /> : position}
        </span>
        <Cover src={track.cover} size={34} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--fs-body)",
              fontWeight: current ? "var(--fw-medium)" : 400,
              color: current ? "var(--accent-text)" : "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </span>
          <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {track.artist}
          </span>
        </span>
      </button>
      {/* Правая колонка ФИКСИРОВАННОЙ ширины (см. ACTIONS_W): длительность и
          кнопки сменяют друг друга, ряд при этом не шевелится. */}
      <span
        style={{
          flex: "none",
          width: ACTIONS_W,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 3,
        }}
      >
        {showActions ? (
          <>
            {onMoveUp ? <IconButton icon="chevron-up" size="sm" label={t("dialogs.queue.moveUp")} onClick={onMoveUp} style={{ width: 26, height: 26 }} iconSize={15} /> : null}
            {onMoveDown ? <IconButton icon="chevron-down" size="sm" label={t("dialogs.queue.moveDown")} onClick={onMoveDown} style={{ width: 26, height: 26 }} iconSize={15} /> : null}
            {onRemove ? <IconButton icon="x" size="sm" label={t("dialogs.queue.remove")} onClick={onRemove} style={{ width: 26, height: 26 }} iconSize={15} /> : null}
          </>
        ) : (
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
            {fmtTime(track.duration)}
          </span>
        )}
      </span>
    </div>
  );
}

/** Разделитель непрерывного списка. ЛИПКИЙ (position: sticky) — и это его
 *  главное свойство, а не украшение: список теперь один сплошной, от сыгранного
 *  до хвоста, и без липкой подписи, прокрутив её мимо, человек не знает, в
 *  какой части очереди находится. Липкая подпись отвечает на это всегда. */
function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-2)",
        padding: "var(--sp-2) var(--sp-2) var(--sp-1)",
        // ⚠️ ТРИ СЛОЯ ОДНОГО И ТОГО ЖЕ МАТЕРИАЛА, А НЕ ОДИН. Материал панели
        // полупрозрачен (0.64 по умолчанию) — с одним слоем сквозь липкую
        // подпись ПРОЕЗЖАЛИ строки, и она читалась как наложенный поверх текста
        // мусор (поймано скриншотом сразу после правки). Три слоя складываются
        // композитором: 1−0.36³ ≈ 0.95, то есть почти глухо. Глухой --bg-1
        // взять нельзя: плотность стекла крутит пользователь, и подпись обязана
        // ехать вместе с панелью, а не жить своей жизнью.
        //
        // ⚠️ ВЕРХНИЕ СЛОИ — linear-gradient, А НЕ ЦВЕТ, И ЭТО НЕ УКРАШАТЕЛЬСТВО.
        // В сокращении `background` цвет допустим ТОЛЬКО в последнем слое:
        // запись «цвет, цвет, цвет» невалидна, и браузер выбрасывает объявление
        // целиком — подпись осталась вообще без фона, хуже, чем была (поймано
        // вторым скриншотом). Градиент из одного цвета в себя же — законный
        // <image> и красит ровно тем же тоном.
        background: [
          "linear-gradient(var(--glass-player, var(--glass-panel)), var(--glass-player, var(--glass-panel)))",
          "linear-gradient(var(--glass-player, var(--glass-panel)), var(--glass-player, var(--glass-panel)))",
          "var(--glass-player, var(--glass-panel))",
        ].join(", "),
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-caption)",
          fontWeight: 600,
          letterSpacing: "var(--ls-caps)",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        {children}
      </span>
      {action}
    </div>
  );
}

export function QueuePanel<T extends QueueTrack>({
  open,
  tracks,
  currentIndex,
  playing,
  canSave,
  onPlayTrack,
  onClose,
  onRemove,
  onMove,
  onClearUpNext,
  onSaveAsPlaylist,
  onRowMenu,
  onRemoveMany,
  menu,
  toCatalog,
}: {
  open: boolean;
  tracks: T[];
  /** Индекс текущего трека в очереди (секции режутся по нему). */
  currentIndex: number;
  playing: boolean;
  /** Серверная сессия: «Сохранить как плейлист» доступно. */
  canSave: boolean;
  onPlayTrack: (id: string) => void;
  onClose: () => void;
  /** Нет — крестика в строке нет (площадка не умеет править очередь). */
  onRemove?: (id: string) => void;
  /** Нет — стрелок перестановки нет. */
  onMove?: (id: string, dir: 1 | -1) => void;
  /** Нет — ссылки «Очистить» у секции «Далее» нет. */
  onClearUpNext?: () => void;
  /** Нет — кнопки сохранения нет (даже при canSave). */
  onSaveAsPlaylist?: () => void;
  /** ПКМ по строке (2026-07-20); index — АБСОЛЮТНЫЙ в tracks, не в секции. */
  onRowMenu?: (track: T, index: number, e: React.MouseEvent) => void;
  /** Убрать пачку выделенных (2026-07-20): один суммарный тост, не N undo. */
  onRemoveMany?: (ids: string[]) => void;
  /** Контекстное меню площадки; нет — ПКМ по выделению не открывается. */
  menu?: QueueMenuPort;
  /** Каталожная форма трека; null — у трека её нет (файл с диска). */
  toCatalog?: (track: T) => Track | null;
}) {
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Свой ref отдаём хуку: он нужен и для фокуса, и для contains() в закрытии
  // кликом мимо, и для querySelector по списку — двух ref'ов на узле не будет.
  const { mounted, layerProps } = useLayerState(open, { ref: panelRef });
  /** Панель ещё в дереве, но уже уезжает: ни фокуса, ни кликов, ни Tab. */
  const closing = mounted && !open;

  // ── множественное выделение (2026-07-20) ──
  // ⚠️ ключ выделения — id трека; повторный трек в очереди (редкость) выделится
  // обеими строками — осознанный компромисс против позиционных ключей.
  // Диапазоны Shift — по ПЛОСКОМУ tracks, секции История/Сейчас/Далее не рвут их.
  const multi = useMultiSelect(tracks.map((tr) => tr.id));
  const selectedCatalog = () =>
    toCatalog
      ? tracks.filter((tr) => multi.has(tr.id)).flatMap((tr) => {
          const ct = toCatalog(tr);
          return ct ? [ct] : [];
        })
      : [];
  // закрылась панель — выделение не должно пережить её (открыл заново — чисто)
  useEffect(() => {
    if (!open) multi.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rowSelection = (tr: T) => ({
    selected: multi.has(tr.id),
    onClickCapture: (e: React.MouseEvent) => {
      if (multi.onItemClick(tr.id, e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  });

  /** ПКМ: по выделенному — меню выделения, по невыделенному — сброс + меню строки. */
  const rowMenu = (tr: T, index: number) => (e: React.MouseEvent) => {
    if (menu && multi.count > 0 && multi.has(tr.id)) {
      menu.openMenu(e, {
        kind: "selection",
        tracks: selectedCatalog(),
        count: multi.count,
        place: "queue",
        ctl: {
          remove: onRemoveMany ? { scope: "queue", run: () => onRemoveMany(multi.ids) } : undefined,
          clear: multi.clear,
        },
      });
      return;
    }
    if (multi.count > 0) multi.clear();
    onRowMenu?.(tr, index, e);
  };

  // ⚠️ НЕ scrollIntoView и НЕ focus() без preventScroll: оба прокручивают ВСЕХ
  // скроллируемых предков, а не только этот список. Корень приложения —
  // overflow:hidden, но программно он всё равно скроллится, а вернуть его нечем
  // (полосы нет) — поэтому при открытии длинной очереди весь интерфейс залипал
  // сдвинутым вверх (жалоба владельца 2026-07-19). Скроллим строго свой контейнер.
  const scrollToCurrent = (smooth: boolean) => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>("[data-queue-current]");
    if (!list || !el) return;
    const top =
      list.scrollTop +
      (el.getBoundingClientRect().top - list.getBoundingClientRect().top) -
      (list.clientHeight - el.offsetHeight) / 2;
    if (smooth && typeof list.scrollTo === "function") list.scrollTo({ top, behavior: "smooth" });
    else list.scrollTop = top;
  };

  // Открытие: фокус в панель (Esc из вызывателя работает) + текущий трек в видимости.
  // ⚠️ mounted в зависимостях обязателен: узел появляется НЕ на том коммите, где
  // сменился open, — хук сначала монтирует его, чтобы браузеру было от чего вести
  // переход. Без mounted эффект отработал бы по пустому panelRef, и открытие
  // осталось бы без фокуса и без прокрутки к текущему треку.
  useEffect(() => {
    if (!open || !mounted) return;
    panelRef.current?.focus({ preventScroll: true });
    scrollToCurrent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  // Закрытие по клику на пустое место (2026-07-20). Полноэкранный backdrop НЕ
  // годится: плеер-бар на zIndex 40 — НИЖЕ панели (50), слой съел бы клики по
  // всему бару. Вместо него точечный слушатель с тремя исключениями: свои
  // клики; кнопка-переключатель (иначе toggle схлопывался бы в «закрыл здесь —
  // открыл кликом» мигание); меню, открытое ИЗ очереди (клик по его ПУНКТУ не
  // должен ронять панель — а клик по его фону закрывает и меню, и очередь
  // одним движением, это сознательно).
  // ⚠️ Условие «пока open», а не «пока mounted»: узел переживает закрытие, и
  // слушатель, доживший до ухода, звал бы onClose второй раз по первому же
  // клику вне — вызыватель получил бы закрытие уже закрытой панели.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-queue-toggle]")) return;
      if (target.closest('[role="menu"]')) return;
      onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, onClose]);

  if (!mounted) return null; // ушла до конца (или не открывалась) — узла нет вовсе

  const history = tracks.slice(0, Math.max(currentIndex, 0));
  const current = tracks[currentIndex];
  const upNext = tracks.slice(currentIndex + 1);

  return (
    <div
      {...layerProps}
      role="dialog"
      aria-label={t("player.queue")}
      tabIndex={-1}
      className="muza-layer muza-layer--panel"
      style={{
        position: "absolute",
        right: "var(--gap-zone)",
        bottom: "var(--pad-under-bar, calc(var(--h-playerbar) + 2 * var(--gap-zone)))",
        // 420, а не 380 (13.08): у ряда появилась постоянная колонка действий
        // (ACTIONS_W), и на прежней ширине названия резались там, где резаться
        // было незачем. Ряд теперь не перекладывается — за это платим 40 px.
        width: 420,
        // 560, а не 460: список стал сплошным (история больше не свёрнута), и
        // низкое окно превращало его в щель на три строки.
        maxHeight: 560,
        borderRadius: "var(--r-lg)",
        // очередь визуально принадлежит плееру — то же зональное стекло
        background: "var(--glass-player, var(--glass-panel))",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        padding: "var(--sp-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        zIndex: 50,
        outline: "none",
        // Поза — ИНЛАЙНОМ, как требует .muza-layer--panel: из какого края
        // выезжает панель, знает только разметка. Очередь прижата к правому
        // краю (right выше) — туда же и уходит, на собственную ширину.
        // Пружины здесь нет намеренно: у слоя одна кривая на позу и на
        // прозрачность, а перелёт за единицу на прозрачности — просто ступенька.
        "--layer-pose": "translateX(100%)",
        // Уходящая панель накрывает собой плеер-бар (zIndex 40 — ПОД ней) ещё
        // ~180 мс. inert из layerProps выключает хит-тест в браузере, но это
        // поведение, а не свойство: явный pointer-events делает «клик проходит
        // насквозь» проверяемым — в том числе в jsdom, где inert не реализован.
        pointerEvents: closing ? "none" : undefined,
      } as React.CSSProperties}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "0 var(--sp-2)" }}>
        <span
          style={{
            flex: 1,
            fontSize: "var(--fs-caption)",
            fontWeight: 600,
            letterSpacing: "var(--ls-caps)",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          {t("player.queue")}{tracks.length > 0 ? t("dialogs.queue.countSuffix", { count: tracks.length }) : ""}
        </span>
        {tracks.length > 0 ? (
          <IconButton icon="locate" size="sm" label={t("dialogs.queue.toCurrent")} onClick={() => scrollToCurrent(true)} style={{ width: 28, height: 28 }} iconSize={15} />
        ) : null}
        {canSave && onSaveAsPlaylist && tracks.length > 0 ? (
          <IconButton icon="save" size="sm" label={t("dialogs.queue.saveAsPlaylist")} onClick={onSaveAsPlaylist} style={{ width: 28, height: 28 }} iconSize={15} />
        ) : null}
        <IconButton icon="x" size="sm" label={t("dialogs.queue.closeQueue")} onClick={onClose} style={{ width: 28, height: 28 }} iconSize={16} />
      </div>

      {tracks.length === 0 ? (
        <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.5 }}>
          {t("dialogs.queue.empty")}
        </div>
      ) : (
        // overflowX:hidden обязателен: overflow-y:auto переводит overflow-x из
        // visible в auto — снизу вылезала лишняя горизонтальная полоса (жалоба
        // владельца 2026-07-19; проявилось, когда полоса ДС стала 11px и контент
        // перестал влезать по ширине). Прятать нечего: заголовки строк и так
        // режутся ellipsis. Тот же паттерн — ReplaceVersionDialog,
        // PlaylistIconPicker, VersionsDialog.
        <div
          ref={listRef}
          style={{ overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 2 }}
        >
          {/* ОДИН НЕПРЕРЫВНЫЙ СПИСОК: сыгранное → сейчас → дальше. Раскрывашки
              «Показать (4)» больше нет.
              Почему её убрали. История была спрятана ПО УМОЛЧАНИЮ, и очередь
              открывалась с середины: сверху ярлык «ИСТОРИЯ · Показать (4)»,
              под ним «СЕЙЧАС», под ним «ДАЛЕЕ», начинающееся с номера 6. Три
              ярлыка на шесть видимых строк, обрыв контекста сверху и нумерация
              от несуществующего начала — вот это и была «путаница». Прошлое
              никуда не девается: за ним не надо ходить, к нему надо
              прокрутить. Открытие по-прежнему центрирует текущий трек
              (scrollToCurrent), так что первым кадром человек видит своё место,
              а история лежит ровно там, где ей положено, — выше. */}
          {history.length > 0 ? (
            <>
              <SectionLabel>{t("dialogs.queue.history")}</SectionLabel>
              {history.map((tr, i) => (
                <QueueRow
                  key={`${tr.id}:${i}`}
                  track={tr}
                  position={null}
                  current={false}
                  played
                  playing={false}
                  onPlay={() => onPlayTrack(tr.id)}
                  onRemove={onRemove ? () => onRemove(tr.id) : undefined}
                  onMenu={rowMenu(tr, i)}
                  {...rowSelection(tr)}
                />
              ))}
            </>
          ) : null}

          {current ? (
            <>
              <SectionLabel>{t("dialogs.queue.nowSection")}</SectionLabel>
              <QueueRow
                track={current}
                position={null}
                current
                played={false}
                playing={playing}
                onPlay={() => onPlayTrack(current.id)}
                onRemove={onRemove ? () => onRemove(current.id) : undefined}
                onMenu={rowMenu(current, currentIndex)}
                {...rowSelection(current)}
              />
            </>
          ) : null}

          {upNext.length > 0 ? (
            <>
              <SectionLabel
                action={
                  onClearUpNext ? (
                    <button
                      type="button"
                      onClick={onClearUpNext}
                      style={{ border: "none", background: "none", color: "var(--text-3)", fontSize: "var(--fs-caption)", cursor: "pointer", padding: 0 }}
                    >
                      {t("dialogs.queue.clear")}
                    </button>
                  ) : undefined
                }
              >
                {t("dialogs.queue.upNext", { count: upNext.length })}
              </SectionLabel>
              {upNext.map((tr, i) => (
                <QueueRow
                  key={`${tr.id}:${currentIndex + 1 + i}`}
                  track={tr}
                  position={i + 1}
                  current={false}
                  played={false}
                  playing={false}
                  onPlay={() => onPlayTrack(tr.id)}
                  onRemove={onRemove ? () => onRemove(tr.id) : undefined}
                  onMoveUp={onMove && i > 0 ? () => onMove(tr.id, -1) : undefined}
                  onMoveDown={onMove && i < upNext.length - 1 ? () => onMove(tr.id, 1) : undefined}
                  onMenu={rowMenu(tr, currentIndex + 1 + i)}
                  {...rowSelection(tr)}
                />
              ))}
            </>
          ) : (
            <div style={{ padding: "var(--sp-3) var(--sp-2)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
              {t("dialogs.queue.upNextEmpty")}{canSave ? t("dialogs.queue.upNextEmptyHint") : ""}.
            </div>
          )}
        </div>
      )}

      {/* Панель массовых действий выделения: без «Играть следующим»/«В очередь»
          — они добавляли бы КОПИИ уже стоящих в очереди треков.
          Рендерится ВСЕГДА, видимостью правит open: снятая условием панель
          исчезала бы кадром, а так у неё есть свой уход (см. SelectionBar). */}
      <SelectionBar
        open={multi.count > 0}
        label={t("menu.selection.count", { count: multi.count })}
        clearLabel={t("menu.selection.clear")}
        onClear={multi.clear}
        actions={[
          ...(menu
            ? [
                {
                  icon: "plus",
                  label: t("menu.addToPlaylist"),
                  onClick: () => menu.ctx.current.addManyToPlaylist(selectedCatalog()),
                },
                {
                  icon: "heart",
                  label: t("menu.catalog.like"),
                  onClick: () => menu.ctx.current.likeMany(selectedCatalog().map((x) => x.id)),
                },
              ]
            : []),
          ...(onRemoveMany
            ? [
                {
                  icon: "list-x",
                  label: t("menu.queue.remove"),
                  danger: true,
                  onClick: () => onRemoveMany(multi.ids),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
