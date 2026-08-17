/**
 * @muza/ui — дизайн-система Muza (источник истины: muza-design-system/project/).
 * Тёмный монохром + один акцент, зоны полупрозрачными слоями, матовое стекло.
 * Кастомизация: атрибут [data-accent] на корневом элементе + переменные, которые
 * ставит инлайном движок темы (packages/app/src/theme/themeVars.ts). Скругление
 * с 2026-08-13 задаётся ТОЛЬКО переменными --r-*: атрибут [data-radius] снят,
 * потому что у свободного числа имени пресета нет (см. tokens/radius.css).
 */
import "./styles.css";

// core
export { Badge } from "./components/core/Badge.jsx";
export { Button } from "./components/core/Button.jsx";
export { Chip } from "./components/core/Chip.jsx";
export { ChipGroup } from "./components/core/ChipGroup.jsx";
export { ColorPicker } from "./components/core/ColorPicker.jsx";
export { Fader } from "./components/core/Fader.jsx";
export { Icon } from "./components/core/Icon.jsx";
export { IconButton } from "./components/core/IconButton.jsx";
export { Kbd } from "./components/core/Kbd.jsx";
export { SearchInput } from "./components/core/SearchInput.jsx";
export { Select } from "./components/core/Select.jsx";
export { Slider } from "./components/core/Slider.jsx";
export { Spinner } from "./components/core/Spinner.jsx";
export { Switch } from "./components/core/Switch.jsx";
export { Tabs } from "./components/core/Tabs.jsx";
export { Panel } from "./components/core/Panel.jsx";
export { Table } from "./components/core/Table.jsx";

// feedback
export { Dialog } from "./components/feedback/Dialog.jsx";
export { EmptyState } from "./components/feedback/EmptyState.jsx";
export { Menu } from "./components/feedback/Menu.jsx";
export { Toast } from "./components/feedback/Toast.jsx";
export { Tooltip } from "./components/feedback/Tooltip.jsx";

// lib
export { cssZoom } from "./lib/cssZoom.js";
export { useLayerState } from "./lib/useLayerState.js";
export { useModalFocus } from "./lib/useModalFocus.js";
export { readDurationMs, DELAY_TIP, TOAST_HOLD, TOAST_HOLD_ACTION } from "./lib/motion.js";

// media
export { Cover } from "./components/media/Cover.jsx";
export { Marquee } from "./components/media/Marquee.jsx";
export { CoverGlow } from "./components/media/CoverGlow.jsx";
export { CountUp } from "./components/core/CountUp.jsx";
export { Lyrics } from "./components/media/Lyrics.jsx";
export { Shelf } from "./components/media/Shelf.jsx";
export { Tile } from "./components/media/Tile.jsx";
export { TrackRow } from "./components/media/TrackRow.jsx";
