import React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import * as HI from "@hugeicons/core-free-icons";

/** Иконка дизайн-системы. Рисует Hugeicons, внешне — прежний контракт:
 *  kebab-case `name`, `size`, `strokeWidth`, `color`, `filled`, `style`.
 *
 *  ⚠️ ПЕРЕЕЗД С LUCIDE НА HUGEICONS (12.08.2026, решение владельца: «lucide
 *  стоковый, его используют почти все нейросети»). Публичный контракт не
 *  тронут НАМЕРЕННО — иконки зовут больше сотни мест по всему приложению и
 *  вебу, и менять их все ради смены поставщика значит гарантированно что-то
 *  сломать. Меняется ровно одно: чем рисуется имя.
 *
 *  ⚠️ ТАБЛИЦА ЯВНАЯ, А НЕ ВЫВЕДЕННАЯ ИЗ ИМЕНИ. Раньше имя переводилось в
 *  PascalCase и искалось в экспортax lucide — это работало, потому что имена
 *  и были lucide-именами. У Hugeicons своя номенклатура («Tick02Icon» вместо
 *  «Check», «Cancel01Icon» вместо «X», «FavouriteIcon» вместо «Heart»), и
 *  автоподбор по похожести дал бы тихо НЕ ТЕ картинки: «check» уехал бы в
 *  «CheckListIcon», «pin» — в «BowlingPinsIcon». Неверная иконка хуже
 *  отсутствующей: отсутствующую видно сразу.
 *
 *  ⚠️ Пакет `hugeicons-react` УСТАРЕЛ. Официальный путь — рендерер
 *  `@hugeicons/react` плюс набор `@hugeicons/core-free-icons`, где иконка это
 *  данные (массив путей), а не компонент.
 *
 *  Про `filled`: в бесплатном наборе залитых вариантов нет, поэтому заливка
 *  делается SVG-свойством `fill` поверх штрихового контура — ровно как было с
 *  lucide. Единственный живой потребитель — сердечко «в любимом». */

/** kebab-имя дизайн-системы → экспорт @hugeicons/core-free-icons.
 *  Пары подобраны по смыслу вручную; сторож ниже (Icon.test.jsx) проверяет,
 *  что каждая правая часть существует, а каждое имя из кода есть в левой. */
export const ICONS = {
  // ── навигация и стрелки ──
  "arrow-left": HI.ArrowLeft01Icon,
  "arrow-down-to-line": HI.ArrowDownToLineIcon,
  "arrow-up-to-line": HI.ArrowUpToLineIcon,
  "chevron-down": HI.ChevronDownIcon,
  "chevron-left": HI.ChevronLeftIcon,
  "chevron-right": HI.ChevronRightIcon,
  "chevron-up": HI.ChevronUpIcon,
  "circle-arrow-up": HI.CircleArrowUp01Icon,
  "external-link": HI.ExternalLinkIcon,
  menu: HI.Menu01Icon,
  ellipsis: HI.MoreHorizontalIcon,
  "grip-vertical": HI.DragDropVerticalIcon,
  locate: HI.FocusIcon,

  // ── плеер ──
  play: HI.PlayIcon,
  "skip-back": HI.Backward01Icon,
  "skip-forward": HI.Forward01Icon,
  shuffle: HI.ShuffleIcon,
  "refresh-cw": HI.RefreshIcon,
  "rotate-ccw": HI.ArrowTurnBackwardIcon,
  "rotate-cw": HI.ArrowTurnForwardIcon,
  speaker: HI.Speaker01Icon,
  "audio-lines": HI.AudioLinesIcon,
  "sliders-vertical": HI.SlidersVerticalIcon,
  gauge: HI.DashboardSpeed01Icon,
  "mic-vocal": HI.MicIcon,

  // ── музыка и списки ──
  music: HI.MusicNote01Icon,
  "music-2": HI.MusicNote03Icon,
  "file-music": HI.FileMusicIcon,
  "list-music": HI.ListMusicIcon,
  "list-start": HI.ListStartIcon,
  "list-end": HI.Queue01Icon,
  "list-x": HI.ListXIcon,
  "list-checks": HI.CheckListIcon,
  "library-big": HI.LibraryIcon,
  radio: HI.Radio01Icon,
  "radio-tower": HI.Radio02Icon,
  heart: HI.FavouriteIcon,
  history: HI.HistoryIcon,
  home: HI.Home01Icon,

  // ── действия ──
  check: HI.Tick02Icon,
  x: HI.Cancel01Icon,
  plus: HI.Add01Icon,
  minus: HI.MinusSignIcon,
  search: HI.Search01Icon,
  copy: HI.Copy01Icon,
  "clipboard-paste": HI.ClipboardPasteIcon,
  download: HI.Download04Icon,
  upload: HI.Upload04Icon,
  import: HI.FileImportIcon,
  save: HI.SaveIcon,
  "trash-2": HI.Delete02Icon,
  eraser: HI.EraserIcon,
  pencil: HI.PencilEdit01Icon,
  "share-2": HI.Share01Icon,
  link: HI.Link01Icon,
  unlink: HI.Unlink01Icon,
  pin: HI.PinIcon,
  "pin-off": HI.PinOffIcon,
  flag: HI.Flag02Icon,
  "square-check-big": HI.CheckmarkSquare01Icon,
  "loader-circle": HI.Loading03Icon,

  // ── файлы и папки ──
  "folder-open": HI.FolderOpenIcon,
  "folder-down": HI.FolderDownloadIcon,
  image: HI.Image01Icon,

  // ── интерфейс и оформление ──
  settings: HI.Settings01Icon,
  "settings-2": HI.Settings02Icon,
  paintbrush: HI.PaintBrush01Icon,
  // Пипетка выбора цвета (ColorPicker.jsx). Первый же прогон сторожа поймал
  // её пропажу: имя приходит не из JSX-атрибута, а из свойства компонента,
  // и беглый обход по `<Icon name=` его не видел.
  pipette: HI.DropperIcon,
  "panel-right": HI.PanelRightIcon,
  "maximize-2": HI.Maximize01Icon,
  "minimize-2": HI.Minimize01Icon,
  moon: HI.Moon02Icon,
  blend: HI.BlendIcon,
  sparkles: HI.SparklesIcon,
  text: HI.TextIcon,
  type: HI.TextFontIcon,
  languages: HI.TranslateIcon,
  "chart-line": HI.ChartLineData01Icon,
  puzzle: HI.PuzzleIcon,

  // ── аккаунт и доступ ──
  user: HI.UserIcon,
  "user-round": HI.UserCircleIcon,
  "user-x": HI.UserRemove01Icon,
  users: HI.UserGroupIcon,
  "log-in": HI.Login01Icon,
  "log-out": HI.Logout01Icon,
  mail: HI.Mail01Icon,
  lock: HI.LockIcon,
  "key-round": HI.Key01Icon,
  // ⚠️ ЧЕТЫРЕ РАЗНЫХ СОСТОЯНИЯ — ЧЕТЫРЕ РАЗНЫЕ КАРТИНКИ. В первом заходе
  // shield/shield-check и shield-alert/shield-off стояли парами на одном
  // экспорте, и лист иконок это сразу показал: «пароль изменён» выглядел как
  // «раздел админки», а «опасное разрешение плагина» — как «отозвать доступ».
  // Щита с галочкой в бесплатном наборе нет, поэтому смысл несут ключ (пароль
  // и сессии) и минус (отзыв).
  shield: HI.Shield01Icon,
  "shield-check": HI.ShieldKeyIcon,
  "shield-alert": HI.ShieldBanIcon,
  "shield-off": HI.ShieldMinusIcon,
  "eye-off": HI.ViewOffIcon,

  // ── сеть и состояние ──
  globe: HI.GlobeIcon,
  "cloud-off": HI.CloudOffIcon,
  server: HI.ServerStack01Icon,
  // Не UnavailableIcon: он рисуется тем же кругом с чертой, что и
  // circle-off ниже, а это разные вещи — «сервер молчит» и «выключено».
  "server-off": HI.NoInternetIcon,
  "circle-off": HI.BanIcon,
  info: HI.InformationCircleIcon,
  "circle-help": HI.HelpCircleIcon,
  "git-branch": HI.GitBranchIcon,
};

export function Icon({ name, size = 20, strokeWidth = 1.75, color = "currentColor", filled = false, style }) {
  const icon = ICONS[name];
  if (!icon) {
    if (import.meta.env?.DEV) {
      console.warn(`[@muza/ui] Иконки "${name}" нет в таблице ICONS (Icon.jsx)`);
    }
    // Пустой квадрат того же размера: раскладка не прыгает, пропажа видна.
    return <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none", ...style }} aria-hidden="true" />;
  }
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      fill={filled ? color : "none"}
      style={{ flex: "none", ...style }}
      aria-hidden="true"
    />
  );
}
