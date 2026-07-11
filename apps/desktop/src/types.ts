export type View = "home" | "search" | "favorites" | "library" | "stats" | "playlist" | "settings" | "admin";

/** Режим повтора: выкл → вся очередь → один трек. */
export type RepeatMode = "off" | "all" | "one";

/** Блоки страницы «Статистика»: канонический порядок = дефолтный. */
export const STATS_BLOCK_KEYS = [
  "summary",
  "activity",
  "rhythm",
  "top_tracks",
  "top_artists",
  "streaks",
  "likes",
  "wrapped",
] as const;
export type StatsBlockKey = (typeof STATS_BLOCK_KEYS)[number];

export interface Prefs {
  /** custom — произвольный цвет из customAccent (пикер в настройках). */
  accent: "blue" | "red" | "bolt" | "custom";
  /** Hex свого акцента; остальные акцент-токены выводятся из него (lib/accent). */
  customAccent: string;
  radius: "mild" | "soft" | "round";
  /** Фон за интерфейсом (Stage 6): выкл / из обложки / цвет / градиент /
   *  картинка по URL. Старое поле bgCover=true мигрирует в "cover". */
  bgType: "none" | "cover" | "color" | "gradient" | "image";
  bgColor: string;
  /** Второй цвет градиента (bgType=gradient). */
  bgColor2: string;
  /** URL картинки фона (bgType=image). */
  bgImageUrl: string;
  /** Затемнение фона поверх (0–80%): контент читается на любом фоне. */
  bgDim: number;
  /** Размытие фона-обложки/картинки, px (--blur-scenery). */
  blurScenery: number;
  /** Базовые bg-слои: графит (дефолт ДС) / тёплый / холодный / AMOLED. */
  baseBg: "graphite" | "warm" | "cold" | "amoled";
  /** Приглушение вторичного текста, % непрозрачности text-2 (40–80). */
  textDim: number;
  /** Масштаб интерфейса, % (85–125) — zoom на корне. */
  uiScale: number;
  /** Скорость анимаций: множитель к --dur-* (быстрее/стандарт/мягче). */
  animSpeed: "fast" | "normal" | "slow";
  /** Размер караоке-строки, px (--fs-karaoke). */
  karaokeSize: number;
  /** Ширины зон, px (узкое окно всё равно пережимает сайдбар). */
  wSidebar: number;
  wNowPlaying: number;
  /** Экран при запуске. */
  startView: "home" | "search" | "favorites" | "library";
  /** CSS-тир (опасная зона): свой CSS поверх всех токенов. */
  customCssOn: boolean;
  customCss: string;
  /** Визуализатор в режиме прослушивания (встроенное расширение). */
  visualizer: "bars" | "wave" | "off";
  /** «Режим смысла»: пунктирные строки с Genius-аннотациями (Stage 5).
   *  Выключен — текст без пунктира и карточек. */
  meaningMode: boolean;
  autostart: boolean;
  /** Иконка Muza в области уведомлений. */
  tray: boolean;
  /** Закрытие окна сворачивает в трей (музыка играет дальше), а не выходит.
   *  Действует только при включённом tray — иначе окно было бы не вернуть. */
  closeToTray: boolean;
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
  /** Бесконечное радио (Stage 5): каталожная очередь кончилась — продолжаем
   *  похожими треками с сервера (/radio от последнего трека). */
  radioEndless: boolean;
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
  /** Страница «Статистика»: видимость и порядок блоков (порядок массива =
   *  порядок на странице; новые блоки дописываются включёнными). */
  statsBlocks: { key: StatsBlockKey; on: boolean }[];
  /** Период, с которым открывается страница статистики. */
  statsPeriod: "week" | "month" | "year" | "all";
}

export const DEFAULT_PREFS: Prefs = {
  accent: "blue",
  customAccent: "#22c55e",
  radius: "soft",
  bgType: "none",
  bgColor: "#1a1815",
  bgColor2: "#101418",
  bgImageUrl: "",
  bgDim: 40,
  blurScenery: 64,
  baseBg: "graphite",
  textDim: 62,
  uiScale: 100,
  animSpeed: "normal",
  karaokeSize: 56,
  wSidebar: 280,
  wNowPlaying: 340,
  startView: "home",
  customCssOn: false,
  customCss: "",
  visualizer: "bars",
  autostart: true,
  tray: true,
  closeToTray: true,
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
  radioEndless: true,
  meaningMode: true,
  telemetry: true,
  discordRpcOn: false,
  discordBtnOn: false,
  discordBtnLabel: "Открыть в Muza",
  discordBtnUrl: "https://muza.lol",
  statsBlocks: STATS_BLOCK_KEYS.map((key) => ({ key, on: true })),
  statsPeriod: "month",
};
