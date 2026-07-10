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
  /** Лимит локального аудио-кэша, ГБ (движок Stage 3 эвиктит по нему LRU). */
  cacheLimitGb: number;
  /** Эквалайзер (Stage 3: живой звук через Web Audio). */
  eqOn: boolean;
  eqPreset: string;
  /** 10 полос, дБ −12..+12 (31 Гц … 16 кГц). */
  eqBands: number[];
  /** Шаги кнопки скорости в баре — настраиваются целиком (правка владельца). */
  speedSteps: number[];
  /** Пресеты таймера сна в минутах (цикл луны: выкл → пресеты → конец трека). */
  sleepPresets: number[];
  /** Анонимная агрегированная статистика (Stage 4: честная галочка).
   *  Только обезличенные счётчики добычи/прослушиваний; по ним чинится
   *  добыча (KPI SABR/403). Документ о данных — настройки → Аккаунт. */
  telemetry: boolean;
  /** Discord Rich Presence (Stage 3): статус «слушает Muza». Работает при
   *  созданном приложении в Discord Dev Portal (MUZA_DISCORD_CLIENT_ID). */
  discordRpcOn: boolean;
  /** Кнопка активности (текст + ссылка). */
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
  eqOn: false,
  eqPreset: "Ровный",
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  speedSteps: [1, 1.25, 1.5, 2, 0.75],
  sleepPresets: [15, 30, 60],
  telemetry: true,
  discordRpcOn: false,
  discordBtnOn: false,
  discordBtnLabel: "Открыть в Muza",
  discordBtnUrl: "https://muza.lol",
};
