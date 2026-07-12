/**
 * @muza/ui — дизайн-система Muza (источник истины: muza-design-system/project/).
 * Тёмный монохром + один акцент, зоны полупрозрачными слоями, матовое стекло.
 * Кастомизация: атрибуты [data-accent] и [data-radius] на корневом элементе.
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

// feedback
export { Dialog } from "./components/feedback/Dialog.jsx";
export { EmptyState } from "./components/feedback/EmptyState.jsx";
export { Menu } from "./components/feedback/Menu.jsx";
export { Toast } from "./components/feedback/Toast.jsx";
export { Tooltip } from "./components/feedback/Tooltip.jsx";

// media
export { Lyrics } from "./components/media/Lyrics.jsx";
export { Shelf } from "./components/media/Shelf.jsx";
export { Tile } from "./components/media/Tile.jsx";
export { TrackRow } from "./components/media/TrackRow.jsx";
