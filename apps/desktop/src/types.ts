export type View = "home" | "search" | "library" | "settings";

export interface Prefs {
  accent: "blue" | "red" | "bolt";
  radius: "mild" | "soft" | "round";
  bgCover: boolean;
  autostart: boolean;
  tray: boolean;
  normalize: boolean;
  crossfade: boolean;
  blur: number;
  glassOpacity: number;
  anims: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  accent: "blue",
  radius: "soft",
  bgCover: false,
  autostart: true,
  tray: true,
  normalize: true,
  crossfade: false,
  blur: 28,
  glassOpacity: 62,
  anims: true,
};
