export type View = "home" | "search" | "favorites" | "library" | "playlist" | "settings";

/** Режим повтора: выкл → вся очередь → один трек. */
export type RepeatMode = "off" | "all" | "one";

export interface Prefs {
  /** custom — произвольный цвет из customAccent (пикер в настройках). */
  accent: "blue" | "red" | "bolt" | "custom";
  /** Hex свого акцента; остальные акцент-токены выводятся из него (lib/accent). */
  customAccent: string;
  radius: "mild" | "soft" | "round";
  bgCover: boolean;
  autostart: boolean;
  tray: boolean;
  normalize: boolean;
  crossfade: boolean;
  blur: number;
  glassOpacity: number;
  anims: boolean;
  /** Лимит локального аудио-кэша, ГБ (сам кэш — Stage 3, лимит выбирается уже сейчас). */
  cacheLimitGb: number;
  /** Discord Rich Presence: кнопка активности (текст + ссылка). RPC — Stage 3, значения живут уже сейчас. */
  discordBtnOn: boolean;
  discordBtnLabel: string;
  discordBtnUrl: string;
}

export const DEFAULT_PREFS: Prefs = {
  accent: "blue",
  customAccent: "#22c55e",
  radius: "soft",
  bgCover: false,
  autostart: true,
  tray: true,
  normalize: true,
  crossfade: false,
  blur: 28,
  glassOpacity: 62,
  anims: true,
  cacheLimitGb: 2,
  discordBtnOn: false,
  discordBtnLabel: "Открыть в Muza",
  discordBtnUrl: "https://muza.lol",
};
