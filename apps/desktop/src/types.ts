import { DEFAULT_HOTKEYS, type HotkeyAction } from "./lib/hotkeys";
import type { Lang } from "./i18n";

export type View = "home" | "search" | "favorites" | "library" | "stats" | "playlist" | "settings" | "admin";

/** Режим повтора: выкл → вся очередь → один трек. */
export type RepeatMode = "off" | "all" | "one";

/** Блоки страницы «Статистика»: канонический порядок = дефолтный.
 *  «wrapped» удалён 2026-07-16 (вход во Wrapped — только с главной, решение
 *  владельца): ключ в старых сохранениях молча выбрасывает
 *  normalizeStatsBlocks (lib/statsBlocks.ts). */
export const STATS_BLOCK_KEYS = [
  "summary",
  "activity",
  "rhythm",
  "top_tracks",
  "top_artists",
  "streaks",
  "likes",
] as const;
export type StatsBlockKey = (typeof STATS_BLOCK_KEYS)[number];

/** Сентинел «переопределение выключено» для radiusControls/radiusFields:
 *  токен не ставится, форма кнопок/полей — как в ДС (пилюля/пресет). */
export const RADIUS_OVERRIDE_OFF = 999;

/** Настраиваемые кнопки плеер-бара: порядок массива = дефолтный порядок.
 *  Несъёмное (обложка/инфо/лайк, prev/play/next, прогресс) сюда не входит. */
export const BAR_BUTTON_KEYS = [
  "shuffle",
  "repeat",
  "sleep",
  "speed",
  "equalizer",
  "lyrics",
  "jam",
  "queue",
  "volume",
  "fullscreen",
] as const;
export type BarButtonKey = (typeof BAR_BUTTON_KEYS)[number];

/** Вкладки сайдбара, доступные компоновке (админка/настройки — вне её). */
// «favorites» здесь НЕТ намеренно (2026-07-16): «Любимое» больше не вкладка
// сайдбара, а закреплённый первым плейлист (в сайдбаре и в библиотеке —
// Spotify-паттерн). Экран остаётся живым (тип View его держит), в сайдбар
// ведёт закреплённая строка. Убрав ключ отсюда, normalizeNavItems заодно
// вычищает favorites из СТАРЫХ сохранений — иначе он завис бы во вкладках.
export const NAV_ITEM_KEYS = ["home", "search", "library", "stats"] as const;
export type NavItemKey = (typeof NAV_ITEM_KEYS)[number];

export interface Prefs {
  /** Тема оформления: тёмная (дефолт ДС) / светлая (инверсия слоёв). */
  theme: "dark" | "light";
  /** custom — произвольный цвет из customAccent (пикер в настройках). */
  accent: "blue" | "red" | "bolt" | "custom";
  /** Hex свого акцента; остальные акцент-токены выводятся из него (lib/accent). */
  customAccent: string;
  /** Роли акцента: отдельные цвета для play-кнопок, слайдеров и активного
   *  трека (--accent-play/-slider/-active-text, фолбэк — общий --accent). */
  accentRolesOn: boolean;
  accentPlay: string;
  accentSlider: string;
  accentActive: string;
  radius: "mild" | "soft" | "round";
  /** Скругление по типам поверх пресета radius: плитки/строки и панели —
   *  ПРОЦЕНТ от пресета (0–200, 100 = как пресет; 0 = острые углы, 200 =
   *  супер-круглые); кнопки и поля — px 0–26 либо RADIUS_OVERRIDE_OFF (999) =
   *  «как в ДС» (пилюля/пресет, токен --r-control/--r-field не ставится).
   *  Старые строковые пресеты мигрируются в числа (lib/legacyPrefs). */
  radiusTiles: number;
  radiusPanels: number;
  radiusControls: number;
  radiusFields: number;
  /** Скругление Tabs-«баблов» (переключатели/сегменты), px 0–26 либо
   *  RADIUS_OVERRIDE_OFF (999) = «пилюля» (дефолт ДС, токен --r-tabs
   *  не ставится). Та же схема, что у radiusControls/radiusFields. */
  radiusTabs: number;
  /** Фон за интерфейсом (Stage 6): выкл / из обложки / цвет / градиент /
   *  картинка по URL / анимированный (T15: две обложки вращаются навстречу
   *  друг другу к центру). Старое поле bgCover=true мигрирует в "cover". */
  bgType: "none" | "cover" | "color" | "gradient" | "image" | "animated";
  bgColor: string;
  /** Второй цвет градиента (bgType=gradient). */
  bgColor2: string;
  /** URL картинки фона (bgType=image). */
  bgImageUrl: string;
  /** Затемнение фона поверх (0–80%): контент читается на любом фоне. */
  bgDim: number;
  /** Реакция фона на обложку: --bg-0/1 подкрашиваются доминирующим цветом
   *  обложки текущего трека (lib/coverTint). */
  bgTint: boolean;
  /** T15 (bgType=animated): направления вращения наоборот (левый диск —
   *  против часовой, правый — по часовой; по умолчанию наоборот). */
  bgAnimatedInvert: boolean;
  /** Анимированный фон, раскрытые ручки (спека настроек 19.07, зона 1).
   *  Дефолты = прежним зашитым значениям: у существующих пользователей после
   *  обновления фон выглядит РОВНО как раньше. Пресеты — PRESETS_BG
   *  (lib/presets.ts): Спокойно/Живо/Ярко поверх этих четырёх полей. */
  /** Секунд на полный оборот диска (16–180; было зашито 64s в app.css). */
  bgAnimSpeedSec: number;
  /** Прозрачность дисков, % (5–60; было зашито opacity 0.22). */
  bgAnimOpacity: number;
  /** Диаметр дисков, % от большей стороны окна (100–200; было 140vw/vh). */
  bgAnimScale: number;
  /** Заход диска за край окна, % (0–40; было left/right −20%). Знак минус
   *  ставит рендер — в настройке человек видит положительное «насколько
   *  спрятать за край». */
  bgAnimEdge: number;
  /** Прозрачность/фон по зонам: своя плотность стекла у плеера, меню,
   *  диалогов, сайдбара и «Сейчас играет» (--glass-<зона>, % плотности). */
  glassZonesOn: boolean;
  glassPlayer: number;
  glassMenu: number;
  glassDialog: number;
  glassSidebar: number;
  glassNowPlaying: number;
  /** Размытие фона-обложки/картинки, px (--blur-scenery). */
  blurScenery: number;
  /** Базовые bg-слои: графит (дефолт ДС) / тёплый / холодный / AMOLED. */
  baseBg: "graphite" | "warm" | "cold" | "amoled";
  /** Приглушение вторичного текста, % непрозрачности text-2 (40–80). */
  textDim: number;
  /** Масштаб интерфейса, % (85–125) — zoom на корне. */
  uiScale: number;
  /** Скорость анимаций, % длительности --dur-* (60–170: влево быстрее,
   *  вправо мягче; 100 = дефолт ДС). Старые fast/normal/slow мигрируются. */
  animSpeed: number;
  /** Зона 2 спеки 19.07 (движение) — множители ПОВЕРХ animSpeed, по группам:
   *  быстрые отклики (меню/подсказки, --dur-fast), диалоги/панели (--dur-base),
   *  переходы страниц и текст (--dur-slow). 100 = как раньше. */
  durMenuMult: number;
  durDialogMult: number;
  durPageMult: number;
  /** Характер движения: кривая --ease-out. soft = прежняя (0.22,1,0.36,1). */
  easeStyle: "soft" | "crisp" | "linear";
  /** Скорость колеса мыши, % (50–300; 100 = нативная, листенер не вешается). */
  scrollSpeed: number;
  /** Плавная прокрутка: колесо докатывает список инерцией вместо прыжка. */
  scrollSmooth: boolean;
  /** Зона 3 спеки 19.07 (плеер) — дефолты = прежним зашитым значениям. */
  /** Шаг перемотки стрелками, сек (1–60; было зашито 5 в App.tsx). */
  seekStepSec: number;
  /** Высота полосы плеера, px (72–120; было 92 в spacing.css). */
  hPlayerBar: number;
  /** Обложка в полосе плеера, px (44–80; было 60). */
  coverBarSize: number;
  /** Сколько следующих треков очереди готовить заранее (0–30; было 10 в
   *  useWarmer). Больше — мгновенный старт, но выше расход трафика. */
  warmAhead: number;
  /** За сколько секунд до конца трека готовить следующий (5–60; было 20). */
  preloadAheadSec: number;
  /** Отклик на бас, «резкость» 0–100 (50 = прежние атака 0.05с/спад 0.35с). */
  bassSharp: number;
  /** Отклик на бас, «размах» 0–100 (50 = прежние scale 0.02/подъём 1.5px). */
  bassReach: number;
  /** Зона 4 спеки 19.07 (списки) — дефолты = прежним токенам ДС. */
  /** Размер плитки, px (140–240; было 176 — дефолт Tile И minmax сеток:
   *  оба места читают одну --w-tile). */
  tileSize: number;
  /** Внутренний отступ плитки, px (8–24; --pad-tile, было 16). */
  padTile: number;
  /** Зазор между зонами окна, px (4–20; --gap-zone, было 12). */
  gapZone: number;
  /** Зона 5 спеки 19.07 (шрифт и текст) — до 19.07 шрифт не менялся вообще.
   *  Ключи реестра lib/fonts.ts; family уезжает в --font-ui/--font-display. */
  fontUi: string;
  fontDisplay: string;
  /** Размер заголовков, % (85–120; масштабирует --fs-title/h1/greet). */
  headingScale: number;
  /** Простор интерфейса, % (85–125; множитель всей шкалы --sp-1..10). */
  spaceScale: number;
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
  /** Плотность баров, штук (24–96). Вид, но НЕ тема: как и сам visualizer,
   *  это встроенное расширение, а не оформление — см. bassShake ниже. */
  visualizerBars: number;
  /** Зеркальный спектр: низы в центре, верхи по краям. Внешность, не починка
   *  (мёртвые верхние бары лечит лог-шкала в shell/visualizerMath.ts). */
  visualizerMirror: boolean;
  /** Сглаживание волны, % (0–100). 0 — сырая полилиния по сэмплам, как было
   *  до T48 (жёстко, «пила»); 100 — максимально мягкая линия. */
  visualizerWaveSmooth: number;
  /** Ручки T50 ниже — все числовые, диапазоны и дефолты держит VIS_LIMITS
   *  (shell/visualizerMath.ts, единая точка правды для настроек/рендера/
   *  пресетов); согласованность с DEFAULT_PREFS ловит тест. Как и остальной
   *  визуализатор — встроенное расширение, НЕ тема. */
  /** Межкадровая плавность волны, % (0–100): экспоненциальная инерция формы.
   *  Главное лекарство от «дёргается при любых настройках» — time-domain срез
   *  каждый кадр новый, и без инерции форма прыгала с частотой кадров
   *  (smoothingTimeConstant анализатора волну не сглаживает — только спектр). */
  visualizerWaveCalm: number;
  /** Толщина волны, % (0–100): 0 — прежняя нитка 2px, 100 — плотная лента. */
  visualizerWaveThick: number;
  /** Заливка волны к центру, % (0–100): полупрозрачное тело под линией. */
  visualizerWaveFill: number;
  /** Размах волны, % высоты её полосы (25–150). */
  visualizerWaveAmp: number;
  /** Ширина бара, % слота (30–100): 100 — сплошная лента без зазоров. */
  visualizerBarFill: number;
  /** Скругление баров, % от половины ширины (0–100): 0 — прямоугольники,
   *  100 — пилюли. */
  visualizerBarRound: number;
  /** Плавность спада баров, % (0–100): атака мгновенная, падение мягче. */
  visualizerBarCalm: number;
  /** Насыщенность визуализатора на сцене, % (15–100) — раньше жёсткие 50
   *  сидели в ListeningMode и не крутились. */
  visualizerOpacity: number;
  /** «Качание при басах» (встроенное расширение, T14): в полноэкранном плеере
   *  (ListeningMode) экран мягко пульсирует в такт низким частотам (первые
   *  бины analyser'а движка). Уважает общий anims и OS prefers-reduced-motion
   *  (выключается принудительно). Поведенческий преф — НЕ в THEME_KEYS. */
  bassShake: boolean;
  /** Сила качания, % (0–300; 100 = амплитуда T14). Вкусовщина без «правильного»
   *  значения — кому-то нужен лёгкий пульс, кому-то ощутимая тряска. */
  bassShakeStrength: number;
  /** «Режим смысла»: пунктирные строки с Genius-аннотациями (Stage 5).
   *  Выключен — текст без пунктира и карточек. */
  meaningMode: boolean;
  autostart: boolean;
  /** Мини-плеер: компактное окно поверх всех (Rust-окно "mini"). */
  miniPlayer: boolean;
  /** Иконка Muza в области уведомлений. */
  tray: boolean;
  /** Закрытие окна сворачивает в трей (музыка играет дальше), а не выходит.
   *  Действует только при включённом tray — иначе окно было бы не вернуть. */
  closeToTray: boolean;
  normalize: boolean;
  crossfade: boolean;
  /** Длительность кроссфейда в секундах (диапазон 1–12; ползунок в настройках).
   *  Действует ТОЛЬКО при crossfade: true — задаёт и длину самого фейда, и окно
   *  раннего триггера авто-перехода (см. player/gaplessPlan.ts::planAutoAdvance).
   *  Кламп границ — там же (clampCrossfadeSec), т.к. значение приходит и из
   *  чужих/старых сохранений, а не только из ползунка. */
  crossfadeSec: number;
  /** Честный gapless-стык (T19, точный триггер — fast-follow ревью #2):
   *  вместо длинного слышимого кроссфейда — короткий (~50мс) micro-fade на
   *  границе треков, запланированный заранее по engine().position() (не по
   *  timeupdate — см. player/usePlayback.pollGapless и player/gaplessPlan.ts).
   *  Взаимоисключим с crossfade — если оба включены, работает crossfade (его
   *  длинная кривая надёжнее прячет джиттер таймингов). Поведенческий преф —
   *  НЕ в THEME_KEYS. */
  gapless: boolean;
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
  /** Обложка трека в активности Discord. */
  discordShowCover: boolean;
  /** Шаблоны строк активности; подстановки {track} {artist} {album}. */
  discordLine1: string;
  discordLine2: string;
  /** Кнопки плеер-бара: состав и порядок (порядок массива = порядок в баре;
   *  shuffle/repeat живут в центре вокруг транспорта, остальное — справа).
   *  T44: ключ — родной BarButtonKey либо плагинный `plugin:<id>:<slot>`
   *  (строка), потому тип ключа расширен до string. */
  barButtons: { key: string; on: boolean }[];
  /** Вкладки сайдбара: состав, порядок и переименование (label = своё имя,
   *  пусто/нет — дефолт). Главную выключить нельзя (normalizeNavItems).
   *  T44: ключ — родной NavItemKey либо плагинный `plugin:<id>:<tab>`. */
  navItems: { key: string; on: boolean; label?: string }[];
  /** Строка трека: что показывать. album/source добавлены 19.07 (спека §5
   *  зона 4) с дефолтом false — у существующих пользователей строка не
   *  меняется. album показывается, когда сервер начнёт отдавать Track.album
   *  (поле в контракте уже есть, опциональное); source — бейдж источника,
   *  как в поиске (там он виден всегда, независимо от этого тумблера). */
  rowShow: { cover: boolean; duration: boolean; album: boolean; source: boolean };
  /** Страница «Статистика»: видимость и порядок блоков (порядок массива =
   *  порядок на странице; новые блоки дописываются включёнными). */
  statsBlocks: { key: StatsBlockKey; on: boolean }[];
  /** Период, с которым открывается страница статистики. */
  statsPeriod: "week" | "month" | "year" | "all";

  // ── Типографика (продвинутая кастомизация) ──
  /** Размер текста, % (85–125) — root font-size; токены в rem → масштабируется
   *  только текст, не отступы (в отличие от uiScale=zoom). */
  fontScale: number;
  /** Межстрочный интервал UI-текста ×100 (125–160 → --lh-ui 1.25–1.60).
   *  Старые tight/normal/relaxed мигрируются. */
  lineSpacing: number;

  // ── Плотность (продвинутая кастомизация) ──
  /** «Просторность» 0–100: отступы зон 14–26px + высота строки трека
   *  52–68px (0 = компактно, 50 = стандарт). Старые compact/normal/spacious
   *  мигрируются. */
  density: number;

  // ── Поведение ──
  /** Язык интерфейса (T28, эпик W5 i18n). Поведенческий ключ — НЕ THEME
   *  (чужая тема оформления не должна переключать язык). DEFAULT_PREFS="en"
   *  (по требованию владельца — дефолт английский); миграция существующих
   *  профилей без этого поля → "ru" (их привычный язык), см. App.loadPrefs. */
  language: Lang;
  /** Продолжать трек с места остановки (позиция per-track в localStorage). */
  resumePosition: boolean;
  /** Двойной клик по строке трека: играть или добавить в очередь. */
  doubleClickAction: "play" | "queue";
  /** Медиаклавиши/SMTC Windows (useMediaSession). */
  mediaKeys: boolean;
  /** Живой каталожный поиск при вводе (выкл = только по Enter). */
  instantSearch: boolean;
  /** Где искать: каталог + источники (yt-dlp) или только накопленный каталог.
   *  Локальные файлы в поиске не участвуют (живут в Библиотеке). */
  searchScope: "all" | "catalog";
  /** T37 (эпик W6): группировка ремиксов/версий в поиске (сервер T36,
   *  ?group=1) — оригинал/канон + версии одной карточкой, лайк карточки
   *  бьёт по канону. Выкл — обычный плоский поиск (как раньше). Поведенческий
   *  преф — НЕ THEME. */
  searchGrouping: boolean;
  /** Синхронизированный текст (выкл = plain-список без подсветки/автоследования). */
  syncedLyrics: boolean;
  /** Автоследование за активной строкой текста (выкл = свободный скролл). */
  lyricsAutoScroll: boolean;
  /** Декоративная нотка в самом низу текста песни (по умолчанию вкл). Мелочь
   *  оформления — но поведенческий преф пользователя, НЕ THEME_KEYS. */
  lyricsEndNote: boolean;
  /** Текст в режиме прослушивания показан (кнопка mic-vocal в слое
   *  авто-прячущихся контролов оверлея + клавиша T). false — «только
   *  обложка/визуализатор»: блок текста плавно скрыт, обложка по центру.
   *  Запоминается между сессиями. Поведенческий преф — НЕ в THEME_KEYS. */
  listeningLyricsShown: boolean;
  /** Эмбиент Wrapped «Итоги года»: громкость топ-трека, играющего фоном
   *  оверлея, позиция слайдера 0–100 (кривая как у плеера — квадрат).
   *  Регулятор — за иконкой в правом верхнем углу оверлея. Поведенческий
   *  преф — НЕ THEME. */
  wrappedAmbientVol: number;
  /** Качество стрима: auto = лестница рецепта, econom = меньший битрейт
   *  (движок ставит низкобитрейтные форматы в голову лестницы yt-dlp). */
  streamQuality: "auto" | "econom";
  /** Вкл/выкл провайдеров при добыче (фильтр источников перед resolve;
   *  локальные файлы не фильтруются; всё выключить нельзя). */
  sourcesEnabled: { youtube: boolean; soundcloud: boolean; bandcamp: boolean };
  /** Политика выбора источника: порядок сервера (официальное первым)
   *  или SoundCloud вперёд. */
  sourcePolicy: "official" | "soundcloudFirst";

  // ── Горячие клавиши: actionId → combo (по e.code, layout-независимо) ──
  hotkeys: Record<HotkeyAction, string>;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  accent: "blue",
  customAccent: "#22c55e",
  accentRolesOn: false,
  accentPlay: "#3b82f6",
  accentSlider: "#3b82f6",
  accentActive: "#3b82f6",
  radius: "soft",
  radiusTiles: 100,
  radiusPanels: 100,
  radiusControls: RADIUS_OVERRIDE_OFF,
  radiusFields: RADIUS_OVERRIDE_OFF,
  radiusTabs: RADIUS_OVERRIDE_OFF,
  bgType: "none",
  bgColor: "#1a1815",
  bgColor2: "#101418",
  bgImageUrl: "",
  bgDim: 40,
  bgTint: false,
  bgAnimatedInvert: false,
  bgAnimSpeedSec: 64,
  bgAnimOpacity: 22,
  bgAnimScale: 140,
  bgAnimEdge: 20,
  glassZonesOn: false,
  glassPlayer: 62,
  glassMenu: 62,
  glassDialog: 100,
  glassSidebar: 4,
  glassNowPlaying: 4,
  blurScenery: 64,
  baseBg: "graphite",
  textDim: 62,
  uiScale: 100,
  animSpeed: 100,
  durMenuMult: 100,
  durDialogMult: 100,
  durPageMult: 100,
  easeStyle: "soft",
  scrollSpeed: 100,
  scrollSmooth: false,
  seekStepSec: 5,
  hPlayerBar: 92,
  coverBarSize: 60,
  warmAhead: 10,
  preloadAheadSec: 20,
  bassSharp: 50,
  bassReach: 50,
  tileSize: 176,
  padTile: 16,
  gapZone: 12,
  fontUi: "golos",
  fontDisplay: "unbounded",
  headingScale: 100,
  spaceScale: 100,
  karaokeSize: 56,
  wSidebar: 280,
  wNowPlaying: 340,
  startView: "home",
  customCssOn: false,
  customCss: "",
  visualizer: "bars",
  visualizerBars: 56,
  visualizerMirror: false,
  // 60% — дефолт-починка: волна была «отвратительной» именно потому, что
  // сглаживания не было вовсе (0). Кому нужна прежняя жёсткость — ставит 0.
  visualizerWaveSmooth: 60,
  // Дефолты T50 = пресеты «Мягкая»/«Классика» (lib/visualizerPresets): волна
  // толстая и плавная ИЗ КОРОБКИ — жалоба «резкая, тонкая, дёргается» чинится
  // дефолтом, без похода в настройки (прецедент — bassShakeStrength 150).
  // Бары: вид прежний (fill 84 ≈ старый зазор slot/6, round 100 = пилюли),
  // плюс лёгкий плавный спад — «все виды красивее» из того же задания.
  visualizerWaveCalm: 60,
  visualizerWaveThick: 45,
  visualizerWaveFill: 45,
  visualizerWaveAmp: 100,
  visualizerBarFill: 84,
  visualizerBarRound: 100,
  visualizerBarCalm: 30,
  visualizerOpacity: 50,
  bassShake: false,
  // 150%, а не 100: владелец пришёл с «bass shake очень маленький», и дефолт
  // обязан отвечать на жалобу сам, без похода в настройки. Преф выключен по
  // умолчанию, так что тише ни у кого не станет — включивший увидит сильнее.
  bassShakeStrength: 150,
  autostart: true,
  miniPlayer: false,
  tray: true,
  closeToTray: true,
  normalize: true,
  crossfade: false,
  crossfadeSec: 4,
  gapless: false,
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
  discordShowCover: true,
  discordLine1: "{track}",
  discordLine2: "{artist}",
  barButtons: BAR_BUTTON_KEYS.map((key) => ({ key, on: true })),
  navItems: NAV_ITEM_KEYS.map((key) => ({ key, on: true })),
  rowShow: { cover: true, duration: true, album: false, source: false },
  statsBlocks: STATS_BLOCK_KEYS.map((key) => ({ key, on: true })),
  statsPeriod: "month",
  fontScale: 100,
  lineSpacing: 140,
  density: 50,
  language: "en",
  resumePosition: false,
  doubleClickAction: "play",
  mediaKeys: true,
  instantSearch: true,
  searchScope: "all",
  searchGrouping: true,
  syncedLyrics: true,
  lyricsAutoScroll: true,
  lyricsEndNote: true,
  listeningLyricsShown: true,
  wrappedAmbientVol: 20,
  streamQuality: "auto",
  sourcesEnabled: { youtube: true, soundcloud: true, bandcamp: true },
  sourcePolicy: "official",
  hotkeys: DEFAULT_HOTKEYS,
};
