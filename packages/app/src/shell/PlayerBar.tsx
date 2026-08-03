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
 *  2) `progressStyle` — по умолчанию ровно прежние `width: 480`.
 *  3) `extraButtons` — вставка в правую группу; приложение её не передаёт,
 *     и ни одного лишнего узла в DOM не появляется.
 *
 *  ⚠️ Выноса файла на рабочий стол в вебе НЕТ и быть не может: жест берётся
 *  из розетки (useDragOut), у браузера порта нет — обработчики просто не
 *  навешиваются. Прямых импортов из lib/dragOut здесь больше нет. */

import { useRef, useState } from "react";
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
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          transition: "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
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
  onSpeed,
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
  return (
    <div
      className={className}
      style={
        className
          ? undefined
          : {
              position: "absolute",
              left: "var(--gap-zone)",
              right: "var(--gap-zone)",
              bottom: "var(--gap-zone)",
              height: "var(--h-playerbar)",
              borderRadius: "var(--r-lg)",
              // зональная прозрачность: своё стекло плеера, фолбэк — общее
              background: "var(--glass-player, var(--glass-panel))",
              backdropFilter: "blur(var(--blur-glass))",
              WebkitBackdropFilter: "blur(var(--blur-glass))",
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              gap: "var(--sp-5)",
              padding: "0 var(--sp-5)",
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
                fontWeight: 600,
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
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }} onContextMenu={onTrackMenu}>
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
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-body)",
              fontWeight: 600,
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
        <IconButton icon="heart" size="sm" active={liked} filled={liked} label={t("common.like")} onClick={onLike} />
      </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          {barOn("shuffle") ? (
            <IconButton icon="shuffle" size="sm" active={shuffle} label={t("player.shuffle")} onClick={onShuffle} />
          ) : null}
          <IconButton icon="skip-back" label={t("player.previous")} disabled={!track} onClick={onPrev} />
          <IconButton
            icon={buffering ? "loader-circle" : playing ? "pause" : "play"}
            variant="accent"
            label={buffering ? t("player.buffering") : playing ? t("player.pause") : t("player.play")}
            disabled={!track}
            onClick={onTogglePlay}
          />
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
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", ...(progressStyle ?? { width: 480 }) }}>
          <span
            style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums", width: 36, textAlign: "right" }}
          >
            {fmtTime(pos)}
          </span>
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
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums", width: 36 }}>
            {fmtTime(track?.duration ?? 0)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-2)" }}>
        {extraButtons}
        {rightOrder.map(({ key }) => {
          switch (key) {
            case "sleep":
              return onSleep ? (
                <IconButton key={key} icon="moon" size="sm" active={sleepActive} label={sleepLabel} onClick={onSleep} />
              ) : null;
            case "speed":
              return onSpeed ? <SpeedButton key={key} speed={speed} onClick={onSpeed} /> : null;
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
      </div>
      {outMenu ? (
        <Menu open x={outMenu.x} y={outMenu.y} items={outMenuItems} onClose={() => setOutMenu(null)} />
      ) : null}
    </div>
  );
}
