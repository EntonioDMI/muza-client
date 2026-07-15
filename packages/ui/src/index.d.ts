// Декларации компонентов @muza/ui. Props-интерфейсы живут в *.d.ts рядом с
// каждым компонентом (источник истины — дизайн-система), здесь — сами функции.
import type * as React from "react";

import type { BadgeProps } from "./components/core/Badge";
import type { ButtonProps } from "./components/core/Button";
import type { ChipProps } from "./components/core/Chip";
import type { ChipGroupProps } from "./components/core/ChipGroup";
import type { ColorPickerProps } from "./components/core/ColorPicker";
import type { FaderProps } from "./components/core/Fader";
import type { IconProps } from "./components/core/Icon";
import type { IconButtonProps } from "./components/core/IconButton";
import type { KbdProps } from "./components/core/Kbd";
import type { SearchInputProps } from "./components/core/SearchInput";
import type { SelectProps } from "./components/core/Select";
import type { SliderProps } from "./components/core/Slider";
import type { SpinnerProps } from "./components/core/Spinner";
import type { SwitchProps } from "./components/core/Switch";
import type { TabsProps } from "./components/core/Tabs";
import type { DialogProps } from "./components/feedback/Dialog";
import type { EmptyStateProps } from "./components/feedback/EmptyState";
import type { MenuProps } from "./components/feedback/Menu";
import type { ToastProps } from "./components/feedback/Toast";
import type { TooltipProps } from "./components/feedback/Tooltip";
import type { CoverProps } from "./components/media/Cover";
import type { LyricsProps } from "./components/media/Lyrics";
import type { ShelfProps } from "./components/media/Shelf";
import type { TileProps } from "./components/media/Tile";
import type { TrackRowProps } from "./components/media/TrackRow";

export type {
  ButtonProps,
  ChipProps,
  ChipGroupProps,
  FaderProps,
  IconProps,
  IconButtonProps,
  SearchInputProps,
  SliderProps,
  SwitchProps,
  TabsProps,
  DialogProps,
  MenuProps,
  ToastProps,
  TooltipProps,
  CoverProps,
  LyricsProps,
  ShelfProps,
  TileProps,
  TrackRowProps,
};

export declare function Badge(props: BadgeProps): React.JSX.Element;
export declare function Button(props: ButtonProps): React.JSX.Element;
export declare function Chip(props: ChipProps): React.JSX.Element;
export declare function ChipGroup(props: ChipGroupProps): React.JSX.Element;
export declare function ColorPicker(props: ColorPickerProps): React.JSX.Element;
export declare function Fader(props: FaderProps): React.JSX.Element;
export declare function Icon(props: IconProps): React.JSX.Element;
export declare function IconButton(props: IconButtonProps): React.JSX.Element;
export declare function Kbd(props: KbdProps): React.JSX.Element;
export declare function SearchInput(props: SearchInputProps): React.JSX.Element;
export declare function Select(props: SelectProps): React.JSX.Element;
export declare function Slider(props: SliderProps): React.JSX.Element;
export declare function Spinner(props: SpinnerProps): React.JSX.Element;
export declare function Switch(props: SwitchProps): React.JSX.Element;
export declare function Tabs(props: TabsProps): React.JSX.Element;
export declare function Dialog(props: DialogProps): React.JSX.Element;
export declare function EmptyState(props: EmptyStateProps): React.JSX.Element;
export declare function Menu(props: MenuProps): React.JSX.Element;
export declare function Toast(props: ToastProps): React.JSX.Element;
export declare function Tooltip(props: TooltipProps): React.JSX.Element;
export declare function Lyrics(props: LyricsProps): React.JSX.Element;
export declare function Cover(props: CoverProps): React.JSX.Element;
export declare function Shelf(props: ShelfProps): React.JSX.Element;
export declare function Tile(props: TileProps): React.JSX.Element;
export declare function TrackRow(props: TrackRowProps): React.JSX.Element;
