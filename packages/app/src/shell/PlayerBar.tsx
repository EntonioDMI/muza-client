/** ПОЛОСА ПЛЕЕРА — одна на обе программы (Э3 веб-паритета, 2026-08-02).
 *
 *  Переехало из apps/desktop/src/shell/PlayerBar.tsx; на старом месте пенёк-
 *  обёртка. Веб до переезда рисовал свою полосу (244 строки «по памяти»): без
 *  перемешивания, без повтора, без очереди, с другим временем и другой
 *  геометрией. Теперь обе программы рисуют ЭТОТ файл.
 *
 *  ПРАВИЛО ЭТОГО ФАЙЛА: приложение не должно измениться ни на пиксель.
 *  Поэтому переезд сделан «умение = наличие пропа»:
 *  - приложение передаёт ВСЕ пропы, как передавало → рендер прежний;
 *  - веб передаёт только то, что умеет, и лишние кнопки не рисуются вовсе
 *    (не серые заглушки — отсутствие кнопки; тот же принцип, что у розетки
 *    платформы, packages/app/src/platform/types.ts).
 *  Отсюда же запрет на развилку «если веб»: в файле нет ни одной проверки
 *  площадки, только проверки «дали ли обработчик».
 *
 *  ⚠️ Три места, где легко нечаянно сдвинуть приложение:
 *  1) `className` — когда его НЕТ, рамка задаётся теми же инлайновыми
 *     стилями, что были (position/размер/стекло). Веб передаёт свой класс
 *     (.playerbar в globals.css) и получает безопасные зоны телефона и свои
 *     брейкпоинты — приложение продолжает жить на инлайне.
 *  2) `progressStyle` — довесок к стилю НОЖНИЦ-силуэта полосы прогресса
 *     (контейнер inset: 0 с обрезкой по радиусу бара); по умолчанию пуст.
 *  3) `extraButtons` — вставка в правую группу; приложение её не передаёт,
 *     и ни одного лишнего узла в DOM не появляется.
 *
 *  ⚠️ Выноса файла на рабочий стол в вебе НЕТ и быть не может: жест берётся
 *  из розетки (useDragOut), у браузера порта нет — обработчики просто не
 *  навешиваются. Прямых импортов из lib/dragOut здесь больше нет. */

import { useLayoutEffect, useRef, useState } from "react";
import { Cover, IconButton, Menu, Slider, Tooltip } from "@muza/ui";
import { normalizeBarButtons, type BarButtonKey, type BarButtonPref } from "../lib/barButtons";
import { isPluginKey } from "../lib/pluginSlots";
import { fmtTime } from "../lib/format";
import { useDragOut } from "../platform";
import { useT } from "../i18n";

/** Режим повтора. Зеркало apps/desktop/src/types.ts::RepeatMode — тот файл
 *  общий для всех зон приложения и сюда не переезжает; союз односложный,
 *  структурно совпадает, приложение передаёт свой тип без приведения. */
export type RepeatMode = "off" | "all" | "one";

/** Трек в терминах ПОЛОСЫ: ровно то, что она показывает. Намеренно уже, чем
 *  PlayerTrack приложения и Track сервера — общий компонент не должен знать
 *  ни про громкость трека, ни про источники, ни про локальный отпечаток. */
export interface PlayerBarTrack {
  id: string;
  title: string;
  artist: string;
  /** null — обложки нет; плейсхолдер рисует Cover дизайн-системы. */
  cover: string | null;
  /** Секунды. */
  duration: number;
}

/** Устройство вывода в меню у громкости. Перечисляет их ПЛОЩАДКА
 *  (listOutputDevices), потому что список зависит от разрешений окна. */
export interface OutputDeviceInfo {
  deviceId: string;
  label: string;
}

/** Плагинная кнопка бара (T44): иконка/подпись из contributes + рантайм-
 *  состояние (UI.setBarButtonState/setBadge). Клик уведомляет плагин. */
export interface PluginBarButtonView {
  key: string;
  pluginId: string;
  slotId: string;
  title: string;
  icon: string;
  active?: boolean;
  badge?: string;
}

/** Кнопка скорости: текст «1×», клик циклит пресеты (как в голосовых Telegram).
 *  Частая настройка — живёт прямо в баре, а не в недрах настроек. */
function SpeedButton({ speed, onClick }: { speed: number; onClick: () => void }) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  const label = `${speed}×`.replace(".", ",");
  return (
    <Tooltip label={t("player.speedTooltip")}>
      <button
        type="button"
        aria-label={t("player.speedAria", { speed: label })}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          height: 28,
          minWidth: 44,
          padding: "0 var(--sp-2)",
          border: "none",
          borderRadius: "var(--r-pill)",
          background: hover ? "var(--surface-3)" : speed !== 1 ? "var(--surface-2)" : "transparent",
          color: speed !== 1 ? "var(--accent-text)" : "var(--text-2)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-caption)",
          fontWeight: 400,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          transition: "background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)",
          flex: "none",
        }}
      >
        {label}
      </button>
    </Tooltip>
  );
}

/** Кнопка высоты тона — соседка SpeedButton и намеренно её близнец по виду.
 *
 *  Вместе они и есть то, что в FL Studio называется стретчем: время и высота
 *  развязаны. Прежний путь (пересчёт частоты) двигал их сцепленно — медленнее
 *  значило ниже, и выбора не было. Теперь «замедлить, оставив голос на месте» и
 *  «опустить голос, не замедляя» — два разных жеста двумя разными кнопками.
 *
 *  Показывается ТОЛЬКО когда путь умеет высоту (нативный движок): на вебе
 *  <audio> двигает высоту лишь вместе с темпом, и кнопка врала бы. */
function PitchButton({ pitch, onClick }: { pitch: number; onClick: () => void }) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  // Знак ставим явно: «2» и «+2» на кнопке читаются одинаково, а значат разное.
  // Минус — типографский (U+2212): дефис на цифрах выглядит переносом.
  const label = pitch === 0 ? "0" : pitch > 0 ? `+${pitch}` : `−${Math.abs(pitch)}`;
  return (
    <Tooltip label={t("player.pitchTooltip")}>
      <button
        type="button"
        aria-label={t("player.pitchAria", { semitones: label })}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          height: 28,
          minWidth: 44,
          padding: "0 var(--sp-2)",
          border: "none",
          borderRadius: "var(--r-pill)",
          background: hover ? "var(--surface-3)" : pitch !== 0 ? "var(--surface-2)" : "transparent",
          color: pitch !== 0 ? "var(--accent-text)" : "var(--text-2)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-caption)",
          fontWeight: 400,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          transition: "background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)",
          flex: "none",
        }}
      >
        {label}
      </button>
    </Tooltip>
  );
}

export function PlayerBar({
  track,
  playing,
  buffering = false,
  onTogglePlay,
  onPrev,
  onNext,
  pos,
  onSeek,
  vol,
  onVol,
  liked,
  onLike,
  shuffle,
  onShuffle,
  repeat,
  onRepeat,
  speed = 1,
  pitch = 0,
  onSpeed,
  onPitch,
  onSetSpeed,
  onSetPitch,
  lyricsOn = false,
  onLyrics,
  queueOn = false,
  onQueue,
  onEqualizer,
  onMute,
  onExpand,
  sleepActive = false,
  sleepLabel = "",
  onSleep,
  jamActive = false,
  onJam,
  onTrackMenu,
  onCoverDragOut,
  buttons,
  pluginButtons = [],
  pluginKeys = [],
  onPluginButton,
  outputRoutes = [],
  outputProfiles = [],
  activeOutputProfile,
  listOutputDevices,
  onOutputSystem,
  onOutputDevice,
  onOutputProfile,
  onOutputSettings,
  className,
  progressStyle,
  subtitle,
  extraButtons,
  windowVisible = true,
}: {
  /** null — ничего не играет: бар остаётся на месте, но с плейсхолдером
   *  вместо трека и выключенным транспортом. */
  track: PlayerBarTrack | null;
  playing: boolean;
  /** Идёт подготовка трека к воспроизведению. */
  buffering?: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  pos: number;
  onSeek: (v: number) => void;
  vol: number;
  onVol: (v: number) => void;
  liked: boolean;
  onLike: () => void;
  shuffle: boolean;
  onShuffle: () => void;
  repeat: RepeatMode;
  onRepeat: () => void;
  /** Множитель скорости; без кнопки скорости площадка её не меняет — 1. */
  speed?: number;
  /** Высота тона в полутонах («стретч»). 0 — как записано. */
  pitch?: number;
  /** Не передан — путь не умеет высоту, и кнопки нет вовсе (веб). */
  onPitch?: () => void;
  /** ТОЧНОЕ значение скорости — для ползунка в меню «Ещё». Не передан —
   *  в меню остаётся прежний пункт-кнопка, циклящий пресеты. */
  onSetSpeed?: (v: number) => void;
  /** ТОЧНОЕ значение высоты. Не передан — ряда высоты в меню нет вовсе
   *  (веб-путь высоту не умеет). */
  onSetPitch?: (v: number) => void;
  /** Нет обработчика — кнопки скорости в баре нет. */
  onSpeed?: () => void;
  lyricsOn?: boolean;
  /** Нет обработчика — кнопки текста песни нет. */
  onLyrics?: () => void;
  queueOn?: boolean;
  /** Нет обработчика — кнопки очереди нет. */
  onQueue?: () => void;
  /** Нет обработчика — кнопки эквалайзера нет. */
  onEqualizer?: () => void;
  /** Нет обработчика — иконки «без звука» нет (слайдер громкости остаётся). */
  onMute?: () => void;
  /** Развернуть на весь экран: клик по обложке и кнопка «развернуть».
   *  Нет обработчика — обложка не кликается, кнопки в баре нет. */
  onExpand?: () => void;
  /** Таймер сна: клик по луне циклит выкл → пресеты (prefs) → конец трека.
   *  Нет обработчика — кнопки нет. */
  sleepActive?: boolean;
  sleepLabel?: string;
  onSleep?: () => void;
  /** Совместное прослушивание (Stage 7): активная сессия подсвечивает кнопку.
   *  Нет обработчика — кнопки нет. */
  jamActive?: boolean;
  onJam?: () => void;
  /** ПКМ по обложке/названию (2026-07-20): меню текущего трека. */
  onTrackMenu?: (e: React.MouseEvent) => void;
  /** Перетаскивание обложки файлом наружу: подготовить файл трека (null = не
   *  вышло, тост уже показан снаружи). undefined — жеста нет (браузер/аноним). */
  onCoverDragOut?: () => Promise<string | null>;
  /** Компоновка (настройки → «Кнопки плеер-бара»): состав и порядок.
   *  Несъёмное — обложка/инфо/лайк, prev/play/next, прогресс. */
  buttons?: BarButtonPref[];
  /** T44: плагинные кнопки бара (мета + рантайм-состояние). */
  pluginButtons?: PluginBarButtonView[];
  /** T44: валидные плагинные ключи для нормализатора композиции. */
  pluginKeys?: readonly string[];
  /** T44: клик по плагинной кнопке — уведомить плагин. */
  onPluginButton?: (pluginId: string, slotId: string) => void;
  /** Вывод на устройства (2026-07-22): быстрый переключатель у громкости.
   *  Меню — эксклюзивный выбор (одно устройство/профиль/системное); тонкая
   *  настройка (несколько устройств, их громкости) — в под-экране настроек. */
  outputRoutes?: { deviceId: string; label: string }[];
  outputProfiles?: { id: string; name: string }[];
  activeOutputProfile?: string;
  /** Перечислить устройства вывода. Даёт площадка: список зависит от
   *  разрешений окна, и общий пакет про них знать не должен. */
  listOutputDevices?: () => Promise<OutputDeviceInfo[]>;
  onOutputSystem?: () => void;
  onOutputDevice?: (device: OutputDeviceInfo) => void;
  onOutputProfile?: (id: string) => void;
  onOutputSettings?: () => void;
  /** Класс рамки. Есть — вся геометрия и стекло берутся из CSS площадки
   *  (веб: .playerbar с безопасными зонами телефона); нет — инлайновые
   *  стили приложения, байт в байт прежние. */
  className?: string;
  /** Ширина зоны прогресса; по умолчанию прежние 480 px приложения. */
  progressStyle?: React.CSSProperties;
  /** Замена второй строки (артист) — например состоянием загрузки/ошибки.
   *  Не передали — как было, имя артиста. */
  subtitle?: React.ReactNode;
  /** Вставка в начало правой группы для кнопок, которых нет в компоновке
   *  (веб: боковая панель «Сейчас играет»). */
  extraButtons?: React.ReactNode;
  /** Видно ли окно приложения: свёрнуто или полностью накрыто чужим окном —
   *  false, и дорисовка прогресса кадрами выключается. По умолчанию true —
   *  у вкладки браузера своего окна нет, веб этот проп не передаёт и ведёт
   *  себя ровно как раньше. Платформенного знания в файле не появляется. */
  windowVisible?: boolean;
}) {
  const { t } = useT();
  const repeatLabel = repeat === "one" ? t("player.repeat.one") : repeat === "all" ? t("player.repeat.all") : t("player.repeat.off");

  // Компоновка: shuffle/repeat живут в центре вокруг транспорта, остальные —
  // справа в порядке массива; выключенное не рендерится
  const layout = normalizeBarButtons(buttons ?? [], pluginKeys);
  const barOn = (key: BarButtonKey) => layout.find((b) => b.key === key)?.on !== false;
  const rightOrder = layout.filter((b) => b.on && b.key !== "shuffle" && b.key !== "repeat");
  const pluginBtn = (key: string) => pluginButtons.find((b) => b.key === key);

  /** ХВАТАЕТ ЛИ МЕСТА МЕТКЕ ВРЕМЕНИ (2026-08-05, поймано пикселями на
   *  минимальном окне приложения 1024).
   *
   *  Правая колонка сетки — minmax(0, 1fr), ряд выровнен по правому краю, и
   *  когда набор кнопок шире колонки, содержимое переливается ВЛЕВО, под
   *  центральный транспорт. Кнопки в ряду flex: none, поэтому уступить может
   *  только метка — и она обязана уступать целиком: обрезанное «0:(» читается
   *  хуже, чем ничего, а позицию и длительность и так показывает полоса
   *  прогресса с подсказкой под курсором.
   *
   *  ⚠️ ПОЧЕМУ ПО ФАКТУ, А НЕ ПО РАСЧЁТУ. Первая версия складывала ширины
   *  кнопок и зазоров и сравнивала с колонкой — и ошибалась: на 1120 расчёт
   *  давал 100 свободных пикселей при нужных 80, а метке доставалось 64,
   *  потому что ряд переливался на 26px из-за содержимого, которого сумма
   *  детей не видит. Поэтому смотрим на результат: метка обрезана — прячем.
   *
   *  Петли это не даёт, и вот почему: колонка сетки объявлена minmax(0, 1fr),
   *  то есть её ширину задаёт СЕТКА, а не содержимое. Спрятали метку —
   *  clientWidth колонки не изменился, значит порог возврата не «поехал» под
   *  собственное решение. Возвращаем метку только когда колонка стала шире
   *  той, на которой сдались. */
  const rightRef = useRef<HTMLDivElement | null>(null);
  /** Ширина колонки, на которой метка перестала помещаться. Ниже неё не
   *  показываем, выше — пробуем снова. */
  const hideBelowRef = useRef(0);
  const [timeFits, setTimeFits] = useState(true);
  useLayoutEffect(() => {
    const el = rightRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const time = el.querySelector<HTMLElement>("[data-testid=player-timecode]");
      if (!time) return;
      // ⚠️ ПРОВЕРЯТЬ ВИДИМОСТЬ, А НЕ НАЛИЧИЕ. Скрываем через display: none, и
      // узел ОСТАЁТСЯ в DOM — querySelector находит его всегда. Первая версия
      // на этом и залипла: у скрытой метки scrollWidth и clientWidth оба нули,
      // условие «обрезана» ложно, ветка возврата не выполнялась никогда, и
      // однажды спрятанная метка не показывалась больше ни на какой ширине.
      if (time.offsetParent !== null) {
        // ВИДНА: смотрим не прогноз, а факт — обрезана или нет.
        if (time.scrollWidth > time.clientWidth + 1) {
          hideBelowRef.current = el.clientWidth;
          setTimeFits(false);
        }
        return;
      }
      // СКРЫТА: возвращаем, когда колонка стала шире той, на которой сдались.
      if (el.clientWidth > hideBelowRef.current) setTimeFits(true);
    };
    // Набор кнопок сменился — прежний порог больше ни о чём не говорит.
    hideBelowRef.current = 0;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
    // Набор кнопок справа меняется настройкой — пересобираем наблюдателя.
  }, [rightOrder.length]);
  // Жест перетаскивания с обложки: pointerdown взводит подготовку файла,
  // движение >12px запускает системный перенос, клик без движения — обычный
  // «Режим прослушивания». Порт берётся из розетки: в браузере его нет, и
  // тогда движение просто ничего не запускает.
  const dragOut = useDragOut();
  const dragRef = useRef<{ x: number; y: number; file: Promise<string | null>; started: boolean } | null>(null);
  const draggedRef = useRef(false);
  // Быстрый переключатель вывода: меню открывается над кнопкой (Menu сам
  // клампится к вьюпорту), устройства перечисляются на каждое открытие —
  // список мог измениться (наушники воткнули только что).
  const outputActive = outputRoutes.length > 0;
  const [outMenu, setOutMenu] = useState<{ x: number; y: number } | null>(null);
  const [outMenuDevices, setOutMenuDevices] = useState<OutputDeviceInfo[] | null>(null);
  const outBtnRef = useRef<HTMLSpanElement | null>(null);
  const openOutputMenu = () => {
    const rect = outBtnRef.current?.getBoundingClientRect();
    setOutMenu({ x: rect?.left ?? 0, y: rect?.top ?? 0 });
    setOutMenuDevices(null);
    void (listOutputDevices?.() ?? Promise.resolve([])).then(setOutMenuDevices);
  };
  const deviceRouted = (d: OutputDeviceInfo) =>
    outputRoutes.some((r) => r.deviceId === d.deviceId || r.label === d.label);
  const outMenuItems = [
    { header: t("player.output.header") },
    {
      icon: outputActive ? "monitor-speaker" : "check",
      label: t("player.output.system"),
      onClick: () => onOutputSystem?.(),
    },
    ...(outMenuDevices === null
      ? [{ label: t("player.output.loading"), disabled: true }]
      : outMenuDevices.map((d) => ({
          icon: deviceRouted(d) ? "check" : "speaker",
          label: d.label,
          onClick: () => onOutputDevice?.(d),
        }))),
    ...(outputProfiles.length > 0
      ? [
          "-" as const,
          ...outputProfiles.map((p) => ({
            icon: p.id === activeOutputProfile ? "check" : "bookmark",
            label: p.name,
            onClick: () => onOutputProfile?.(p.id),
          })),
        ]
      : []),
    "-" as const,
    { icon: "settings-2", label: t("player.output.configure"), onClick: () => onOutputSettings?.() },
  ];
  // «⋯» — ОДНА ДВЕРЬ ДЛЯ ВСЕГО, ЧЕГО НЕТ В БАРЕ (редизайн 04.08).
  //
  // Решение владельца: в баре остаётся то, что меняется ПОКА ТЫ СЛУШАЕШЬ
  // (перемешивание, переходы, повтор, текст, очередь, громкость), а то, что
  // настраивают раз в сеанс (эквалайзер, скорость, таймер сна, джем, полный
  // экран), уезжает сюда. Дефолты кнопок бара поменялись, но САМ СПИСОК
  // возможностей не сократился ни на одну позицию — иначе у людей, которые уже
  // настроили бар под себя, пропали бы кнопки.
  //
  // Правило одно: пункт появляется в меню ровно тогда, когда его кнопка в баре
  // ВЫКЛЮЧЕНА, а обработчик есть. Значит любое действие всегда достижимо, и
  // включённая кнопка не дублируется пунктом меню. Включил всё обратно в
  // настройках — меню становится пустым и кнопка «⋯» исчезает сама.
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const moreBtnRef = useRef<HTMLSpanElement | null>(null);
  const moreItems = [
    !barOn("lyrics") && onLyrics ? { icon: "mic-vocal", label: t("player.lyrics"), onClick: () => onLyrics() } : null,
    !barOn("queue") && onQueue ? { icon: "list-music", label: t("player.queue"), onClick: () => onQueue() } : null,
    !barOn("equalizer") && onEqualizer
      ? { icon: "sliders-vertical", label: t("settings.equalizer.title"), onClick: () => onEqualizer() }
      : null,
    // ⚠️ СКОРОСТЬ И ВЫСОТА — ПОЛЗУНКАМИ, А НЕ ПУНКТАМИ (11.08.2026, заказ
    // владельца: «высоту менять неудобно, зачем она в самом плеере»).
    // Пункт-кнопка циклил пресеты, и до нужного значения приходилось стучать
    // по нему многократно. Ползунок берёт значение одним движением и при этом
    // в покое выглядит обычной строкой меню — ряд не шумит.
    //
    // ⚠️ И ПОТОМУ ЖЕ ПОЛЗУНКИ ЖИВУТ ЗДЕСЬ ВСЕГДА — правило «есть кнопка в баре,
    // значит нет пункта в меню» на них НЕ распространяется (13.08.2026).
    //
    // Правило это про ДУБЛИРОВАНИЕ, и для обычных пунктов оно верно: кнопка
    // «Текст песни» в баре и строка «Текст песни» в меню делают ровно одно и
    // то же одним нажатием. У скорости и высоты это не так. Кнопка в баре
    // ЦИКЛИТ пресеты (0 → −1 → −2 → −3 → +1…), ползунок БЕРЁТ ЛЮБОЕ ЗНАЧЕНИЕ
    // одним движением — это две разные возможности над одним числом, а не
    // копия. Пряча ползунок за наличие кнопки, мы отнимали точную настройку
    // ровно у того, кто вынес ручку в бар, то есть у того, кто крутит её чаще
    // всех. Ради «не дублировать» терялась единственная дверь к «+7».
    //
    // Плата названа честно: «⋯» больше не исчезает при полностью набитом баре
    // — в меню всегда лежат два ползунка. Исчезающая кнопка была красивой
    // мелочью для тех, кто включил в баре ВСЁ; точная скорость и высота нужны
    // всем, кто их вообще трогает. Обмен в пользу второго.
    onSetSpeed
      ? {
          slider: {
            icon: "gauge",
            label: t("media.barButtons.speed.label"),
            value: speed,
            min: 0.25,
            max: 2,
            step: 0.05,
            format: (v: number) => `${v.toFixed(2).replace(/0$/, "").replace(".", ",")}×`,
            onChange: onSetSpeed,
          },
        }
      : !barOn("speed") && onSpeed
        ? { icon: "gauge", label: t("media.barButtons.speed.label"), onClick: () => onSpeed() }
        : null,
    // Высота — та же логика, что у скорости строкой выше: ползунок здесь
    // всегда. В баре кнопка высоты по умолчанию выключена (почти всегда
    // показывала «0» — место занимала, а сказать ей было нечего), но даже
    // включённая она умеет только цикл по семи пресетам.
    onSetPitch
      ? {
          slider: {
            icon: "music-2",
            label: t("media.barButtons.pitch.label"),
            value: pitch,
            min: -12,
            max: 12,
            step: 1,
            format: (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0"),
            onChange: onSetPitch,
          },
        }
      : null,
    !barOn("sleep") && onSleep ? { icon: "moon", label: sleepLabel, onClick: () => onSleep() } : null,
    !barOn("jam") && onJam
      ? { icon: "radio-tower", label: jamActive ? t("player.jamActiveTooltip") : t("player.jamTooltip"), onClick: () => onJam() }
      : null,
    !barOn("fullscreen") && onExpand && track
      ? { icon: "maximize-2", label: t("player.fullscreen"), onClick: () => onExpand() }
      : null,
  ].filter(Boolean) as { icon: string; label: string; onClick: () => void }[];

  return (
    <div
      className={className}
      // Маркер зоны для режима правки вида (shell/LookEditLayer.tsx): он
      // измеряет реальные края зон, а не пересчитывает их из токенов.
      data-zone="player"
      // Правый клик по ЛЮБОМУ месту полосы открывает то же меню — привычный
      // жест для панели инструментов и второй путь к спрятанному, если человек
      // не заметил «⋯». Клик по строке трека остаётся за её собственным меню
      // (там действия над треком, а не над плеером), поэтому его не трогаем.
      onContextMenu={
        moreItems.length
          ? (e) => {
              if ((e.target as HTMLElement).closest("[data-track-menu]")) return;
              e.preventDefault();
              setMoreMenu({ x: e.clientX, y: e.clientY });
            }
          : undefined
      }
      style={
        className
          ? undefined
          : {
              position: "absolute",
              // Геометрия силуэта — из переменных темы (themeVars.ts), а не
              // числами здесь: прижатая полоса и плавающая пилюля отличаются
              // только этими двумя значениями, и обе площадки читают одни и
              // те же. Прижатая — inset 0 и радиус 0.
              left: "var(--player-inset, var(--gap-zone))",
              right: "var(--player-inset, var(--gap-zone))",
              bottom: "var(--player-inset, var(--gap-zone))",
              height: "var(--h-playerbar)",
              // ⚠️ ОБЯЗАТЕЛЬНО. Глобального box-sizing: border-box в дереве
              // НЕТ (проверено grep'ом: правило есть только в двух локальных
              // файлах). Полоса получила padding-bottom под прогресс — и без
              // этой строки её высота стала 72+8=80, то есть на 8px больше,
              // чем говорит --h-playerbar. Врало всё, что от него считается:
              // зазор над баром съедался (28 → 20), --pad-under-bar
              // недосчитывал, очередь и «Сейчас играет» вставали ниже, чем
              // надо. Замер 04.08: bar.top 820 вместо 828.
              boxSizing: "border-box",
              borderRadius: "var(--r-deck, var(--r-lg))",
              // ⚠️ ЗДЕСЬ НЕ ДОЛЖНО БЫТЬ overflow: hidden.
              // Он тут был полдня 04.08 — ради обрезки полосы прогресса по
              // скруглению — и обрезал ПОДСКАЗКИ: Tooltip намеренно не
              // порталится (он position:absolute от своей обёртки, портал
              // сломал бы ему позиционирование — см. коммит 493fe36), рисуется
              // НАД кнопкой, а бар высотой 72px, и всё, что выше его кромки,
              // исчезало. Жалоба владельца: «наводишь на кнопку — подсказка
              // уходит за плеер». Обрезка переехала на саму полосу прогресса,
              // где она и нужна.
              // зональная прозрачность: своё стекло плеера, фолбэк — общее
              background: "var(--glass-player, var(--glass-panel))",
              backdropFilter: "blur(var(--blur-glass))",
              WebkitBackdropFilter: "blur(var(--blur-glass))",
              display: "grid",
              // ⚠️ minmax(0, 1fr), НЕ 1fr. У 1fr минимальный размер — это
              // min-content, поэтому боковые колонки могли требовать больше
              // своей доли и толкать середину: правая группа при полном наборе
              // кнопок (до десяти) и ползунке громкости 110px не влезала.
              // Замер до правки — колонки 434 / 480 / 514: транспорт и прогресс
              // стояли на 40px левее настоящего центра окна, и это тем
              // заметнее, чем крупнее масштаб интерфейса. Жалоба владельца
              // «плеер и прогресс-бар не центрированы» — ровно про это.
              gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
              alignItems: "center",
              gap: "var(--sp-5)",
              // ВЕРХНЕЕ поле идёт за толщиной полосы прогресса (линия теперь
              // по верхней кромке — набросок 04.08): человек настраивает
              // толщину сам, и на 16px содержимое иначе легло бы прямо на неё.
              // На дефолтных 4px это ровно 8px.
              padding: "calc(var(--h-progress, 4px) + 4px) var(--sp-5) 0",
              zIndex: 40,
            }
      }
    >
      {/* Ничего не играет — бар НЕ прячется: его высота (--h-playerbar) забита
          в сетку окна, и исчезновение дёргало бы раскладку на первом же плее.
          Вместо трека — честный плейсхолдер, транспорт выключен. */}
      {!track ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
          <Cover src={null} size="var(--size-cover-bar)" radius="var(--r-sm)" />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "var(--fs-body)",
                fontWeight: 400,
                color: "var(--text-2)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t("player.empty.title")}
            </div>
            <div
              style={{
                fontSize: "var(--fs-caption)",
                color: "var(--text-3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {t("player.empty.hint")}
            </div>
          </div>
        </div>
      ) : (
      // data-track-menu — маркер для правого клика по бару: у строки трека своё
      // меню (действия НАД ТРЕКОМ), и меню плеера не должно его перебивать.
      <div
        data-track-menu
        style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}
        onContextMenu={onTrackMenu}
      >
        {/* ⚠️ Обложка — КНОПКА ТОЛЬКО ТАМ, ГДЕ ЕЙ ЕСТЬ ЧТО ДЕЛАТЬ.
            Раньше `<button aria-label="Режим прослушивания">` рисовалась
            безусловно, а её `onClick` звал `onExpand?.()`. В вебе этот проп не
            передаётся НАМЕРЕННО (шапка apps/web/src/components/PlayerBar.tsx,
            решение 10.08: у одного действия один глиф, караоке уходит как
            `onLyrics`). Итог: скринридеру объявлялась кнопка с подписью
            «Режим прослушивания», которая не делала ничего.
            Правило продукта — «умение есть → рисуем; умения нет → его НЕТ, а не
            серое», поэтому здесь именно отсутствие кнопки, а не `disabled`. */}
        {!onExpand && !onCoverDragOut ? (
          <Cover key={track.id} src={track.cover} size="var(--size-cover-bar)" radius="var(--r-sm)" className="muza-view" />
        ) : (
        <Tooltip label={onCoverDragOut ? t("player.listeningModeTooltipDrag") : t("player.listeningModeTooltip")}>
          {/* настоящая кнопка: клавиатура открывает режим прослушивания;
              с зажатой ЛКМ обложка утаскивается файлом наружу */}
          <button
            type="button"
            aria-label={t("player.listeningModeTooltip")}
            onClick={() => {
              if (draggedRef.current) {
                draggedRef.current = false; // это был перенос, не клик
                return;
              }
              onExpand?.();
            }}
            onPointerDown={
              onCoverDragOut
                ? (e) => {
                    if (e.button !== 0) return;
                    draggedRef.current = false;
                    dragRef.current = { x: e.clientX, y: e.clientY, file: onCoverDragOut(), started: false };
                  }
                : undefined
            }
            onPointerMove={
              onCoverDragOut
                ? (e) => {
                    const d = dragRef.current;
                    if (!d || d.started) return;
                    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) return;
                    d.started = true;
                    draggedRef.current = true;
                    void d.file
                      .then((path) => (path && dragOut ? dragOut.startFileDrag(path) : undefined))
                      .catch(() => undefined);
                  }
                : undefined
            }
            onPointerUp={() => {
              dragRef.current = null;
            }}
            style={{ border: "none", background: "none", padding: 0, cursor: "pointer", flex: "none", display: "block" }}
          >
            {/* Через Cover, а не голый <img>: здесь не было object-fit, и
                непрямоугольная обложка источника честно сплющивалась в 60×60. */}
            <Cover
              key={track.id}
              src={track.cover}
              size="var(--size-cover-bar)"
              radius="var(--r-sm)"
              className="muza-view"
            />
          </button>
        </Tooltip>
        )}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-body)",
              fontWeight: 400,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </div>
          <div
            style={{
              fontSize: "var(--fs-caption)",
              color: "var(--text-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {subtitle ?? track.artist}
          </div>
        </div>
        {/* Пульс сердца при лайке. Класс muza-like-pop был описан в
            animations.css с самого начала и не подключён ни к чему — то есть
            обратной связи у самого эмоционального действия в приложении не
            было вовсе. key переигрывает анимацию на каждом включении: без него
            CSS проиграл бы её один раз за жизнь узла. */}
        <span
          key={liked ? "liked" : "unliked"}
          className={liked ? "muza-like-pop" : undefined}
          style={{ display: "inline-flex" }}
        >
          <IconButton icon="heart" size="sm" active={liked} filled={liked} label={t("common.like")} onClick={onLike} />
        </span>
      </div>
      )}
      {/* ЦЕНТР — ТОЛЬКО ТРАНСПОРТ (редизайн 04.08, макет владельца).
          Прогресс уехал отсюда вниз, во всю ширину бара: пока он сидел в этой
          же колонке, её ширину задавал он (480px), и центральная ячейка
          переставала быть «сколько нужно кнопкам». Теперь колонка меряется по
          пяти кнопкам, а линия прогресса не зависит от неё вовсе. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          {barOn("shuffle") ? (
            <IconButton icon="shuffle" size="sm" active={shuffle} label={t("player.shuffle")} onClick={onShuffle} />
          ) : null}
          <IconButton icon="skip-back" label={t("player.previous")} disabled={!track} onClick={onPrev} />
          {/* Кольцо буферизации ВРАЩАЕТСЯ. До 04.08 иконка loader-circle просто
              подменяла собой «play» и стояла неподвижно: «готовлю трек»
              выглядело как «завис» — а именно в эти секунды человек и решает,
              работает приложение или нет. Обёртка, а не проп: IconButton не
              пробрасывает класс на глиф, а display:contents не создаёт бокса и
              ничего в раскладке не меняет. */}
          <span className={buffering ? "muza-spin-icon" : undefined} style={{ display: "contents" }}>
            <IconButton
              icon={buffering ? "loader-circle" : playing ? "pause" : "play"}
              variant="accent"
              label={buffering ? t("player.buffering") : playing ? t("player.pause") : t("player.play")}
              disabled={!track}
              onClick={onTogglePlay}
            />
          </span>
          <IconButton icon="skip-forward" label={t("player.next")} disabled={!track} onClick={onNext} />
          {barOn("repeat") ? (
            <IconButton
              icon={repeat === "one" ? "repeat-1" : "repeat"}
              size="sm"
              active={repeat !== "off"}
              label={repeatLabel}
              onClick={onRepeat}
            />
          ) : null}
        </div>
      </div>
      <div
        ref={rightRef}
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-2)" }}
      >
        {/* Время одной табличной меткой «1:12 / 3:28» (макет владельца). Раньше
            это были два отдельных числа по краям полосы прогресса в 36px
            колонках — они держали середину бара шириной 480px и мешали её
            центровке. tabular-nums обязателен: без него метка дёргается по
            ширине на каждой смене секунды и тянет за собой всю правую группу. */}
        <span
          data-testid="player-timecode"
          style={{
            fontSize: "var(--fs-caption)",
            color: "var(--text-3)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            paddingRight: "var(--sp-1)",
            /* ⚠️ ВРЕМЯ УСТУПАЕТ ПЕРВЫМ (починка 2026-08-05, поймано пикселями
               на минимальном окне приложения 1024). Правая колонка сетки —
               minmax(0, 1fr), то есть ей позволено сжаться до нуля; её ряд
               выровнен по правому краю, и когда содержимое шире колонки, оно
               переливается ВЛЕВО — прямо под центральную группу транспорта.
               Кнопки в ряду flex: none, а у метки времени whiteSpace: nowrap
               даёт min-width: auto = ширине текста, поэтому не сжималось
               НИЧЕГО и метка просто оказывалась под кнопкой повтора: на 1024
               кнопка 594–630 лежала внутри метки 586–666.
               minWidth: 0 возвращает метке способность сжиматься, overflow
               обрезает её по своей же границе. Уступать обязана именно она:
               позицию и длительность показывает сама полоса прогресса, у неё
               же подсказка под курсором, — а кнопку, наехавшую на текст, не
               спасает ничто. */
            minWidth: 0,
            overflow: "hidden",
            // Обрезанное «0:(» читается хуже, чем ничего: цифры времени либо
            // видны целиком, либо их нет. Порог считает эффект ниже.
            display: timeFits ? undefined : "none",
          }}
        >
          {`${fmtTime(pos)} / ${fmtTime(track?.duration ?? 0)}`}
        </span>
        {extraButtons}
        {rightOrder.map(({ key }) => {
          switch (key) {
            case "sleep":
              return onSleep ? (
                <IconButton key={key} icon="moon" size="sm" active={sleepActive} label={sleepLabel} onClick={onSleep} />
              ) : null;
            case "speed":
              return onSpeed ? <SpeedButton key={key} speed={speed} onClick={onSpeed} /> : null;
            // Кнопки нет там, где путь не умеет высоту: onPitch не передан — слот пуст.
            case "pitch":
              return onPitch ? <PitchButton key={key} pitch={pitch} onClick={onPitch} /> : null;
            case "equalizer":
              return onEqualizer ? (
                <IconButton key={key} icon="sliders-vertical" size="sm" label={t("settings.equalizer.title")} onClick={onEqualizer} />
              ) : null;
            case "lyrics":
              return onLyrics ? (
                <IconButton key={key} icon="mic-vocal" size="sm" active={lyricsOn} label={t("player.lyrics")} onClick={onLyrics} />
              ) : null;
            case "jam":
              return onJam ? (
                <IconButton
                  key={key}
                  icon="radio-tower"
                  size="sm"
                  active={jamActive}
                  label={jamActive ? t("player.jamActiveTooltip") : t("player.jamTooltip")}
                  onClick={onJam}
                />
              ) : null;
            case "queue":
              return onQueue ? (
                // span-обёртка: маркер для QueuePanel (клик по переключателю не
                // «закрыть по клику вне» — иначе toggle схлопнулся бы в мигание)
                // и для возврата фокуса из closeQueue без привязки к aria-label
                <span key={key} data-queue-toggle style={{ display: "contents" }}>
                  <IconButton icon="list-music" size="sm" active={queueOn} label={t("player.queue")} onClick={onQueue} />
                </span>
              ) : null;
            case "volume":
              // клик по иконке — «без звука» (нативный жест), колесо на слайдере — ±громкость
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  {onOutputDevice ? (
                    <span ref={outBtnRef} style={{ display: "inline-flex" }}>
                      <IconButton
                        icon="speaker"
                        size="sm"
                        active={outputActive}
                        label={t("player.output.tooltip")}
                        onClick={openOutputMenu}
                      />
                    </span>
                  ) : null}
                  {onMute ? (
                    <IconButton
                      icon={vol === 0 ? "volume-x" : vol < 40 ? "volume-1" : "volume-2"}
                      size="sm"
                      label={vol === 0 ? t("player.unmute") : t("player.mute")}
                      onClick={onMute}
                    />
                  ) : null}
                  <div onWheel={(e) => onVol(Math.max(0, Math.min(100, vol + (e.deltaY < 0 ? 5 : -5))))} style={{ display: "flex" }}>
                    <Slider value={vol} onChange={onVol} ariaLabel={t("player.volume")} valueText={`${Math.round(vol)} %`} style={{ width: 110 }} />
                  </div>
                </div>
              );
            case "fullscreen":
              // второй вход в режим прослушивания (первый — клик по обложке);
              // без трека там показывать нечего
              return onExpand ? (
                <IconButton
                  key={key}
                  icon="maximize-2"
                  size="sm"
                  label={t("player.fullscreen")}
                  disabled={!track}
                  onClick={onExpand}
                />
              ) : null;
            default: {
              // T44: плагинная кнопка бара (ключ plugin:<id>:<slot>)
              if (!isPluginKey(key)) return null;
              const pb = pluginBtn(key);
              if (!pb) return null;
              return (
                <IconButton
                  key={key}
                  icon={pb.icon}
                  size="sm"
                  active={pb.active}
                  label={pb.badge ? `${pb.title} · ${pb.badge}` : pb.title}
                  onClick={() => onPluginButton?.(pb.pluginId, pb.slotId)}
                />
              );
            }
          }
        })}
        {moreItems.length ? (
          // Обёртка со ссылкой — тем же приёмом, что у кнопки вывода звука:
          // IconButton не отдаёт событие в onClick, а меню нужно поставить у
          // самой кнопки, а не в случайной точке экрана.
          <span ref={moreBtnRef} style={{ display: "inline-flex" }}>
            <IconButton
              icon="ellipsis"
              size="sm"
              active={!!moreMenu}
              label={t("player.more")}
              onClick={() => {
                const r = moreBtnRef.current?.getBoundingClientRect();
                if (r) setMoreMenu({ x: r.right, y: r.top });
              }}
            />
          </span>
        ) : null}
      </div>
      {/* ПОЛОСА ПРОГРЕССА — ПО ВЕРХНЕЙ КРОМКЕ, ВО ВСЮ ШИРИНУ (набросок
          владельца 04.08 вечером: «полоса над плеером, а не под ним»; до этого
          лежала по нижней). Верхняя кромка честнее и механикой: линия смотрит
          на содержимое, а не в край экрана, и пузырёк перемотки всплывает над
          ней в свободное место, а не поверх кнопок бара.
          Почему не в центральной колонке, как было изначально: там она
          задавала колонке ширину 480px, и центр бара считался не по кнопкам, а
          по ней. Здесь линия не участвует в сетке вовсе — она просто край
          полосы плеера, и её длина всегда равна ширине окна.
          Зона попадания шире видимой дорожки (--h-progress-hit, минимум 12px):
          целиться мышью в линию толщиной в четыре пикселя нельзя, а сама линия
          обязана лежать на кромке — отсюда align="start" у слайдера. Толщину
          задаёт человек (Ctrl+E или «Кастомизация»), запас на промах считает
          тема — см. themeVars.ts. */}
      {/* НОЖНИЦЫ ЛИНИИ — ВЕСЬ СИЛУЭТ ПЛЕЕРА, не полоска её высоты.
          ⚠️ Здесь была коробка высотой в зону попадания (12px) со скруглением
          r-deck: радиус 28 в коробку 12 не помещается, и CSS УЖИМАЕТ его до
          высоты коробки — линия выживала в клине между маленькой дугой ножниц
          и большой дугой самого плеера и «вылазила за плеер» на скруглённых
          углах (скрин владельца 04.08 ночью). Обрезка обязана держать ПОЛНУЮ
          дугу — поэтому она размером с бар; кликов не ворует: pointerEvents
          сняты, ловит только сам слайдер внутри. Бару overflow по-прежнему
          ставить нельзя — он съедает подсказки; пузырёк перемотки обрезки не
          боится — он уходит порталом. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "var(--r-deck, var(--r-lg))",
          overflow: "hidden",
          pointerEvents: "none",
          ...progressStyle,
        }}
      >
      <div
        // Маркер зоны для режима правки вида: за НИЖНИЙ край этой полосы
        // тянут толщину прогресса (shell/LookEditLayer.tsx) — верхний занят
        // ручкой высоты самого плеера, два жеста на одной кромке подрались бы.
        data-zone="progress"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "var(--h-progress-hit, 12px)",
          display: "flex",
          alignItems: "flex-start",
          pointerEvents: "auto",
        }}
      >
        <Slider
          value={pos}
          max={track?.duration ?? 0}
          onChange={onSeek}
          // подготовка трека — звук стоит, полоске ехать не за чем.
          // windowVisible — то же для свёрнутого/накрытого окна: Slider
          // держит собственный rAF-цикл, и без гейта он 60 раз в секунду
          // двигал бы заливку, которой никто не видит. Гасим здесь, у
          // ПОТРЕБИТЕЛЯ: сам Slider про окна не знает и знать не должен.
          rate={playing && !buffering && windowVisible ? speed : 0}
          ariaLabel={t("player.progress")}
          valueText={t("player.progressValueText", { pos: fmtTime(pos), duration: fmtTime(track?.duration ?? 0) })}
          hoverLabel={fmtTime}
          align="start"
          thickness="var(--h-progress, 4px)"
          style={{ flex: 1, height: "var(--h-progress-hit, 12px)" }}
        />
      </div>
      </div>
      {outMenu ? (
        <Menu open x={outMenu.x} y={outMenu.y} items={outMenuItems} onClose={() => setOutMenu(null)} />
      ) : null}
      {moreMenu ? (
        <Menu open x={moreMenu.x} y={moreMenu.y} items={moreItems} onClose={() => setMoreMenu(null)} />
      ) : null}
    </div>
  );
}
