/** ДВИЖОК ТЕМЫ — единственное место, где профиль настроек превращается в
 *  CSS-переменные корня. Считают его ОБА клиента: приложение подставляет
 *  результат в свой rootStyle (apps/desktop/src/App.tsx), веб — в корневой div
 *  ThemeRoot (apps/web/src/providers.tsx → theme/ThemeRoot.tsx).
 *
 *  ПОЧЕМУ ЗДЕСЬ, А НЕ В App.tsx (переезд 2026-08-02, фаза 2 веб-паритета):
 *  формулы жили внутри компонента приложения, и веб знал лишь восемь ключей из
 *  сорока с лишним. Следствие было не «веб выглядит иначе», а хуже: ряды
 *  настроек, которым нечего применить, в браузере показывать НЕЛЬЗЯ — человек
 *  дёргает ползунок «Простор», и не происходит ничего. Поэтому переехали не
 *  восемь формул, а весь rootStyle целиком: масштаб интерфейса, простор,
 *  размытие и плотность стекла по зонам, скругления по типам элементов,
 *  скорость движения, базовый фон, типографика, плотность.
 *
 *  ИНВАРИАНТ ПРИЛОЖЕНИЯ: у десктопа дифф обязан быть НУЛЕВЫМ — он подставляет
 *  ровно тот же объект, просто собранный этой функцией. Любая правка формулы
 *  здесь меняет ОБА клиента; «поправлю только для веба» — значит завести вторую
 *  правду, ровно ту, из-за которой этот файл и появился.
 *
 *  ЧЕГО ЗДЕСЬ НЕТ (и почему): фон-сценография (обложка/градиент/вращающиеся
 *  диски), скрим поверх него и «свой CSS» — это РАЗМЕТКА, а не переменные; их
 *  рисует оболочка каждого клиента. Размер текста (fontScale) — font-size на
 *  <html>, а не на корне темы: rem-токены резолвятся от документа.
 *
 *  Светлая тема: часть слоёв перекрашивает themes.css из @muza/ui по
 *  data-theme (см. themeAttrs) — здесь только то, что зависит от профиля. */

import type { CSSProperties } from "react";
import { fontFamily } from "../prefs/fonts";
import { DEFAULT_PREFS, RADIUS_OVERRIDE_OFF, type Prefs } from "../prefs/types";
import { accentRoleVars, customAccentVars } from "./accent";

/** Ключи профиля, из которых считается корневой стиль. Pick из общей модели —
 *  разъехаться типам физически негде (до 2026-08-02 здесь было ручное
 *  объявление восьми полей «как в desktop types.ts»). */
export type ThemePrefs = Pick<
  Prefs,
  | "theme"
  | "accent"
  | "customAccent"
  | "accentRolesOn"
  | "accentPlay"
  | "accentSlider"
  | "accentActive"
  | "radius"
  | "radiusTiles"
  | "radiusPanels"
  | "radiusControls"
  | "radiusFields"
  | "radiusTabs"
  | "glassZonesOn"
  | "glassPlayer"
  | "glassMenu"
  | "glassDialog"
  | "glassSidebar"
  | "glassNowPlaying"
  | "blurScenery"
  | "bgAnimSpeedSec"
  | "bgTint"
  | "baseBg"
  | "textDim"
  | "uiScale"
  | "animSpeed"
  | "durMenuMult"
  | "durDialogMult"
  | "durPageMult"
  | "easeStyle"
  | "anims"
  | "hPlayerBar"
  | "coverBarSize"
  | "tileSize"
  | "padTile"
  | "gapZone"
  | "fontUi"
  | "fontDisplay"
  | "headingScale"
  | "spaceScale"
  | "karaokeSize"
  | "wSidebar"
  | "wNowPlaying"
  | "lineSpacing"
  | "density"
  | "blur"
  | "glassOpacity"
>;

/** Вход движка — ЛЮБОЙ срез профиля: чего нет, то берётся из DEFAULT_PREFS.
 *  Так сделано ради постепенности: клиент, который пока передаёт половину
 *  полей, продолжает работать и выглядит ровно как раньше (недостающее =
 *  дефолт = родной токен ДС), а не падает сборкой. */
export type ThemeInput = Partial<ThemePrefs>;

/** Прежнее имя типа (веб знал только тему) — оставлено для потребителей. */
export type WebTheme = ThemeInput;

/** Что движок знать не может — это состояние окна и трека, а не настройка. */
export type ThemeStage = {
  /** Доминирующий цвет обложки текущего трека для «реакции фона на обложку»
   *  (prefs.bgTint). null/не задан — тонировки нет. */
  coverTint?: string | null;
  /** Окно достаточно широкое, чтобы сайдбар слушался настройку ширины. false —
   *  ширина прибита к 220px: узкое окно пережимает панель независимо от
   *  желания человека. Не задан — считаем, что широкое. */
  wideSidebar?: boolean;
};

/** Дефолты общих ключей — буквально DEFAULT_PREFS, не копия. */
export const DEFAULT_WEB_THEME: ThemeInput = {
  theme: DEFAULT_PREFS.theme,
  accent: DEFAULT_PREFS.accent,
  customAccent: DEFAULT_PREFS.customAccent,
  radius: DEFAULT_PREFS.radius,
  blur: DEFAULT_PREFS.blur,
  glassOpacity: DEFAULT_PREFS.glassOpacity,
  textDim: DEFAULT_PREFS.textDim,
  fontUi: DEFAULT_PREFS.fontUi,
};

/** Пресеты базовых bg-слоёв («Базовый фон»); graphite = дефолт ДС. */
const BASE_BG: Record<Prefs["baseBg"], { bg0: string; bg1: string } | null> = {
  graphite: null,
  warm: { bg0: "#151110", bg1: "#1b1512" },
  cold: { bg0: "#0f1114", bg1: "#13171c" },
  amoled: { bg0: "#000000", bg1: "#0b0b0b" },
};

/** Базовые значения шкалы радиусов по пресету [data-radius] (radius.css ДС) —
 *  «скругление по типам» (ползунки-проценты) умножает их и переопределяет
 *  токены inline. */
const RADIUS_BASE: Record<Prefs["radius"], { xs: number; sm: number; md: number; lg: number; xl: number }> = {
  mild: { xs: 6, sm: 8, md: 12, lg: 16, xl: 20 },
  soft: { xs: 10, sm: 14, md: 20, lg: 28, xl: 36 },
  round: { xs: 14, sm: 18, md: 26, lg: 36, xl: 48 },
};

/** Дефолтные --bg-0/1 тем (colors.css / themes.css ДС) — база для тонировки
 *  обложкой, когда baseBg-пресет не активен. */
const BG_DEFAULTS = {
  dark: { bg0: "#121110", bg1: "#171614" },
  light: { bg0: "#f3f1ed", bg1: "#faf9f6" },
};

/** Плотность (ползунок 0–100) → отступ зоны 14–26px (--pad-zone, дефолт 20
 *  при 50) + высота строки трека 52–68px (--h-trackrow, TrackRow читает с
 *  фолбэком 60). Межстрочный: prefs.lineSpacing 125–160 → --lh-ui 1.25–1.60. */
const densityPad = (d: number) => 14 + Math.round((12 * d) / 100);
const densityRow = (d: number) => 52 + Math.round((16 * d) / 100);

/** Характер движения: пресеты кривой --ease-out. soft — родная кривая ДС
 *  (tokens/effects.css), crisp — быстрее выходит на цель, linear — ровный ход.
 *  Произвольного ввода кривой нет намеренно: это язык разработчика. */
const EASE_CURVES: Record<Prefs["easeStyle"], string> = {
  soft: "cubic-bezier(0.22, 1, 0.36, 1)",
  crisp: "cubic-bezier(0.33, 1, 0.68, 1)",
  linear: "linear",
};

/** Шкала отступов ДС (--sp-1..10, spacing.css) — база множителя «Простор». */
const SPACE_SCALE_BASE = [4, 8, 12, 16, 20, 24, 32, 40, 56, 80];

/** ЛЕСТНИЦА МАТЕРИАЛОВ — один ползунок «Плотность стекла» на все поверхности.
 *
 *  ЧТО БЫЛО НЕ ТАК (жалоба владельца, 03.08). Ползунок двигал ровно одну
 *  переменную — --glass-panel. Сайдбар, «Сейчас играет» и рельс настроек
 *  красились плоским --surface-1, диалоги — глухим --bg-1, и ни один из них на
 *  ползунок не отзывался. Человек тянет «Стекло» — половина окна не шевелится.
 *
 *  КАК УСТРОЕНО ТЕПЕРЬ. Каждый материал — своя прямая α = c0 + c1·g, где
 *  g = glassOpacity/100. Ползунок один, но масштаб у каждого материала свой:
 *  чем выше элемент в стопке, тем плотнее его стекло (зона < панель < диалог).
 *  Смысл ровно тот же, что у Apple: материал окна тоньше материала поповера.
 *
 *  ПОЧЕМУ ИМЕННО ЭТИ ЧИСЛА — ЧИТАЕМОСТЬ, А НЕ ВКУС. Нижние границы (c0, то есть
 *  значение при ползунке 30 — это минимум, который отдаёт настройка) подобраны
 *  так, чтобы любая текстовая ступень на этом материале И на каждой плёнке
 *  элевации поверх него добирала 4.5:1 по WCAG 2.1 в худшем случае — белая
 *  обложка под стеклом при штатном затемнении фона. Худшая точка всего хода
 *  ползунка в обеих темах — 4.61:1. Сторож — themeVars.test.ts, «стеклянная
 *  лестница»; он же не даст опустить границу «на глаз».
 *
 *  Верхние концы (c0 + c1, ползунок 100) намеренно НЕ доходят до 1.0 у зоны и
 *  панели: стекло, ставшее глухим, перестаёт быть стеклом, а фон-сценография —
 *  отдельная настройка, которую человек включал не для того, чтобы её закрыли.
 *  Полностью глухими материалы делает системное «меньше прозрачности»
 *  (tokens/glass.css), и там это осмысленно.
 *
 *  ⚠️ Одинаковы для обеих тем НАРОЧНО: «62 %» обязано значить одно и то же при
 *  переключении темы, иначе ползунок врёт. Разный у тем только ТОН (см.
 *  glassBase ниже), не плотность. */
const MATERIAL = {
  /** Зоны окна: сайдбар, «Сейчас играет», рельс настроек, центральная область. */
  zone: [0.42, 0.28],
  /** Плавающее над содержимым: плеер, очередь, меню, выпадашки, тосты. */
  panel: [0.44, 0.32],
  /** Диалог — поверх всего, поэтому самый плотный. */
  dialog: [0.62, 0.32],
  /** Полноэкранные скримы: караоке, подложка диалога. */
  deep: [0.56, 0.38],
} as const;

/** α материала при текущем положении ползунка. Округление до сотых — чтобы
 *  значение в инлайн-стиле совпадало с фолбэком в tokens/glass.css: иначе
 *  экран входа (там движка ещё нет) отличался бы от приложения на волос. */
const materialAlpha = (kind: keyof typeof MATERIAL, g: number) => {
  const [c0, c1] = MATERIAL[kind];
  return Math.min(1, c0 + c1 * g).toFixed(2);
};

/** Смешение двух hex-цветов: a + (b − a) × t. Живёт в движке темы, потому что
 *  единственный потребитель — тонировка --bg-0/1 обложкой; добыча самого цвета
 *  (canvas-даунсэмпл) остаётся на стороне клиента (desktop lib/coverTint.ts). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const ca = (pa >> sh) & 255;
    const cb = (pb >> sh) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  return "#" + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("");
}

/** data-атрибуты корня: пресетные акценты/радиусы применяет CSS ДС.
 *  Приложение ставит атрибуты само (у него data-theme стоит всегда, включая
 *  "dark") — эта функция для веба, где лишний атрибут в разметке не нужен. */
export function themeAttrs(t: ThemeInput): {
  "data-theme"?: "light";
  "data-accent"?: string;
  "data-radius"?: string;
} {
  const theme = t.theme ?? DEFAULT_PREFS.theme;
  const accent = t.accent ?? DEFAULT_PREFS.accent;
  const radius = t.radius ?? DEFAULT_PREFS.radius;
  return {
    ...(theme === "light" ? { "data-theme": "light" as const } : {}),
    ...(accent !== "blue" && accent !== "custom" ? { "data-accent": accent } : {}),
    ...(radius !== "soft" ? { "data-radius": radius } : {}),
  };
}

/** Профиль → CSS-переменные корня (плюс zoom: масштаб интерфейса — настоящее
 *  CSS-свойство, а не переменная, но это ровно та же ручка настроек).
 *
 *  Порядок ключей в объекте значения не имеет: имена переменных различны, а
 *  var() резолвится после применения всего стиля. */
export function buildThemeVars(input: ThemeInput, stage: ThemeStage = {}): CSSProperties {
  const t: ThemePrefs = { ...DEFAULT_PREFS, ...input };
  const coverTint = stage.coverTint ?? null;
  const wideSidebar = stage.wideSidebar ?? true;

  const isLight = t.theme === "light";
  // baseBg-пресеты (тёплый/холодный/AMOLED) заточены под тёмную — в светлой не применяем
  const baseBg = isLight ? null : BASE_BG[t.baseBg];
  const animMult = t.animSpeed / 100;
  // База текста/стекла зависит от темы: тёмная = белый текст на тёмном стекле,
  // светлая = тёмный текст на светлом стекле (иначе инлайн перебил бы [data-theme])
  const textBase = isLight ? "28, 26, 23" : "244, 243, 241";
  // Смещение и шаг текстовой рампы — см. развёрнутое обоснование у --text-2 ниже.
  const textAlpha2 = Math.min(1, t.textDim / 100 + (isLight ? 0.16 : 0));
  const textAlpha3 = Math.max(0.2, textAlpha2 - (isLight ? 0.12 : 0.06));
  const glassBase = isLight ? "250, 249, 246" : "23, 22, 20";
  // Тон глубокого скрима чуть темнее обычного стекла (караоке, подложка
  // диалога) — как в токенах ДС.
  const deepBase = isLight ? "248, 246, 243" : "18, 17, 16";
  // Плотность стекла: 0–1 из ползунка. Один вход на всю лестницу материалов.
  const g = t.glassOpacity / 100;
  // Скругление по типам: плитки/панели — процент от пресета, кнопки/поля — px
  // (RADIUS_OVERRIDE_OFF = токен не ставим, форма как в ДС)
  const rBase = RADIUS_BASE[t.radius];
  const rTilesMult = t.radiusTiles / 100;
  const rPanelsMult = t.radiusPanels / 100;
  const rControl = t.radiusControls >= RADIUS_OVERRIDE_OFF ? null : `${t.radiusControls}px`;
  const rField = t.radiusFields >= RADIUS_OVERRIDE_OFF ? null : `${t.radiusFields}px`;
  const rTabs = t.radiusTabs >= RADIUS_OVERRIDE_OFF ? null : `${t.radiusTabs}px`;
  // Тонировка фона обложкой поверх действующей пары bg-слоёв
  const bgPair = baseBg ?? BG_DEFAULTS[isLight ? "light" : "dark"];
  const tintStrength = isLight ? 0.12 : 0.22;
  const tintedBg =
    t.bgTint && coverTint
      ? { bg0: mixHex(bgPair.bg0, coverTint, tintStrength), bg1: mixHex(bgPair.bg1, coverTint, tintStrength) }
      : null;

  return {
    "--blur-glass": `${t.blur}px`,
    // ЛЕСТНИЦА МАТЕРИАЛОВ — всё стекло приложения от одного ползунка (см.
    // MATERIAL выше). Ставится ВСЕГДА, а не только при «стекле по зонам»:
    // именно поэтому ползунок наконец двигает и сайдбар, и «Сейчас играет», и
    // диалоги, а не одни плавающие панели.
    "--glass-zone": `rgba(${glassBase}, ${materialAlpha("zone", g)})`,
    "--glass-panel": `rgba(${glassBase}, ${materialAlpha("panel", g)})`,
    "--glass-dialog": `rgba(${glassBase}, ${materialAlpha("dialog", g)})`,
    "--glass-deep": `rgba(${deepBase}, ${materialAlpha("deep", g)})`,
    // Размытие зон — тоже всегда. Раньше переменная появлялась только вместе с
    // «стеклом по зонам», и зоны оставались плоской заливкой: стекло без
    // размытия читается как краска, а не как материал.
    "--bf-zone": "blur(var(--blur-glass))",
    // свой акцент: все четыре акцент-токена выводятся из выбранного hex (theme-aware)
    ...(t.accent === "custom" ? customAccentVars(t.customAccent, isLight) : {}),
    // роли акцента: play/слайдеры/активный трек отдельно (фолбэк — --accent)
    ...(t.accentRolesOn
      ? accentRoleVars({ play: t.accentPlay, slider: t.accentSlider, active: t.accentActive }, isLight)
      : {}),
    // скругление по типам поверх пресета [data-radius]
    ...(t.radiusTiles !== 100
      ? {
          "--r-xs": `${Math.round(rBase.xs * rTilesMult)}px`,
          "--r-sm": `${Math.round(rBase.sm * rTilesMult)}px`,
          "--r-md": `${Math.round(rBase.md * rTilesMult)}px`,
        }
      : {}),
    ...(t.radiusPanels !== 100
      ? {
          "--r-lg": `${Math.round(rBase.lg * rPanelsMult)}px`,
          "--r-xl": `${Math.round(rBase.xl * rPanelsMult)}px`,
        }
      : {}),
    ...(rControl ? { "--r-control": rControl } : {}),
    ...(rField ? { "--r-field": rField } : {}),
    ...(rTabs ? { "--r-tabs": rTabs } : {}),
    // ТОЧНАЯ ПОДСТРОЙКА ПОВЕРХ ЛЕСТНИЦЫ («Стекло по зонам» в Кастомизации).
    // Общий ползунок задаёт материал каждой зоне; эти пять переопределяют его
    // поштучно — например, плеер поплотнее, а «Сейчас играет» потоньше.
    // ⚠️ Все пять теперь в ОДНОМ тоне (glassBase). Раньше сайдбар и «Сейчас
    // играет» считались от surfaceBase — светлеющей плёнки, — и их ползунки
    // жили в другом масштабе, чем остальные три: 4 % у одних значило «почти
    // ничего», 62 % у других — «плотное стекло». Одна шкала на все зоны, иначе
    // человек тянет соседние ползунки и получает разное поведение.
    // ⚠️ Дефолты glassSidebar/glassNowPlaying переехали с 4 на 59 вместе с
    // тоном (prefs/types.ts). У кого «стекло по зонам» было включено ДО этой
    // правки, сохранённая четвёрка теперь означает «почти прозрачно» — зоны
    // придётся подкрутить заново. Тумблер по умолчанию выключен, так что это
    // касается единиц; молча чинить сохранённое число нельзя — мы не отличим
    // старую четвёрку от осознанно выставленной.
    ...(t.glassZonesOn
      ? {
          "--glass-player": `rgba(${glassBase}, ${t.glassPlayer / 100})`,
          "--glass-menu": `rgba(${glassBase}, ${t.glassMenu / 100})`,
          "--glass-dialog": `rgba(${glassBase}, ${t.glassDialog / 100})`,
          "--glass-sidebar": `rgba(${glassBase}, ${t.glassSidebar / 100})`,
          "--glass-nowplaying": `rgba(${glassBase}, ${t.glassNowPlaying / 100})`,
        }
      : {}),
    // токен-уровневые переопределения базового фона (+ тонировка обложкой)
    ...(tintedBg
      ? { "--bg-0": tintedBg.bg0, "--bg-1": tintedBg.bg1 }
      : baseBg
        ? { "--bg-0": baseBg.bg0, "--bg-1": baseBg.bg1 }
        : {}),
    // ⚠️ Этот инлайн-стиль сильнее любого правила таблицы стилей, поэтому именно
    // он, а не токен ДС, решает, что увидит пользователь. Отсюда правило: правка
    // текстовой рампы в токенах БЕЗ правки здесь до людей не доезжает вовсе.
    // Так уже было дважды — с правкой контраста 27.07 (шаг оставался старым) и с
    // правкой светлой рампы 03.08 (токены подняли, а формула их перебивала).
    //
    // У СВЕТЛОЙ и ТЁМНОЙ тем разные база и шаг, и это не вкусовщина, а физика:
    // тёмные чернила по светлому теряют контраст быстрее, чем светлые по тёмному,
    // поэтому одна и та же «приглушённость» на светлой теме обязана быть плотнее.
    // Числа = токенам ДС (packages/ui/src/tokens/{colors,themes}.css) при
    // значении ручки по умолчанию 62: тёмная 0.62/0.56 (шаг 0.06), светлая
    // 0.78/0.66 (шаг 0.12). Правишь токен — правь и здесь, иначе разъедется.
    //
    // ШАГ ТЁМНОЙ ТЕМЫ СЖАТ с 0.10 до 0.06 волной «больше стекла» (03.08).
    // Третий тон лежит на плёнке элевации, а плёнка в тёмной теме СВЕТЛИТ —
    // и светлит поверх любого стекла, даже непрозрачного (замер: 4.23:1 при
    // альфе 0.52). То есть поднять плотность стекла эту пару не спасает в
    // принципе, единственный рычаг — чернила. Развёрнутый разбор с цифрами —
    // у токена --text-3 в packages/ui/src/tokens/colors.css.
    "--text-2": `rgba(${textBase}, ${textAlpha2.toFixed(2)})`,
    "--text-3": `rgba(${textBase}, ${textAlpha3.toFixed(2)})`,
    "--blur-scenery": `${t.blurScenery}px`,
    // Скорость орбит анимированного фона: app.css читает var(--orb-dur, 64s) —
    // дефолт токена = прежней зашитой скорости.
    "--orb-dur": `${t.bgAnimSpeedSec}s`,
    // Размеры плеера: все потребители уже читают эти переменные
    // (PlayerBar height/Cover size, отступы зон в App и PluginFrames).
    "--h-playerbar": `${t.hPlayerBar}px`,
    "--size-cover-bar": `${t.coverBarSize}px`,
    // Списки: --w-tile читают и дефолт Tile, и minmax сеток —
    // фиксированные ленты и текучие сетки крутятся одной ручкой.
    "--w-tile": `${t.tileSize}px`,
    "--pad-tile": `${t.padTile}px`,
    "--gap-zone": `${t.gapZone}px`,
    // Шрифт и текст: family из реестра prefs/fonts.ts; заголовки и шкала
    // отступов — множителями. При дефолтах переменные не ставятся — работают
    // родные токены ДС.
    ...(t.fontUi !== "golos" ? { "--font-ui": fontFamily(t.fontUi) } : {}),
    ...(t.fontDisplay !== "unbounded" ? { "--font-display": fontFamily(t.fontDisplay) } : {}),
    ...(t.headingScale !== 100
      ? {
          "--fs-title": `${((1.375 * t.headingScale) / 100).toFixed(4)}rem`,
          "--fs-h1": `${((1.75 * t.headingScale) / 100).toFixed(4)}rem`,
          "--fs-greet": `${((2.25 * t.headingScale) / 100).toFixed(4)}rem`,
        }
      : {}),
    ...(t.spaceScale !== 100
      ? Object.fromEntries(
          SPACE_SCALE_BASE.map((base, i) => [`--sp-${i + 1}`, `${Math.round((base * t.spaceScale) / 100)}px`]),
        )
      : {}),
    "--fs-karaoke": `${t.karaokeSize}px`,
    "--w-nowplaying": `${t.wNowPlaying}px`,
    // Типографика и плотность: межстрочный + отступ зоны + высота строки трека;
    // размер шрифта — через root font-size, он живёт в оболочке клиента
    "--lh-ui": (t.lineSpacing / 100).toFixed(2),
    "--pad-zone": `${densityPad(t.density)}px`,
    "--h-trackrow": `${densityRow(t.density)}px`,
    // zoom масштабирует весь UI (WebView2/Chromium); 100% — без свойства
    ...(t.uiScale !== 100 ? { zoom: t.uiScale / 100 } : {}),
    ...(wideSidebar ? { "--w-sidebar": `${t.wSidebar}px` } : { "--w-sidebar": "220px" }),
    ...(t.anims
      ? animMult !== 1 || t.durMenuMult !== 100 || t.durDialogMult !== 100 || t.durPageMult !== 100
        ? {
            // Групповые множители ПОВЕРХ общего animSpeed — быстрые отклики /
            // диалоги / переходы крутятся поотдельности.
            "--dur-fast": `${Math.round((150 * animMult * t.durMenuMult) / 100)}ms`,
            "--dur-base": `${Math.round((220 * animMult * t.durDialogMult) / 100)}ms`,
            "--dur-slow": `${Math.round((400 * animMult * t.durPageMult) / 100)}ms`,
          }
        : {}
      : { "--dur-fast": "1ms", "--dur-base": "1ms", "--dur-slow": "1ms" }),
    // Характер движения: --ease-out из пресета; soft = прежняя кривая ДС
    // (0.22,1,0.36,1) — переменную в этом случае не трогаем вовсе.
    ...(t.easeStyle !== "soft" ? { "--ease-out": EASE_CURVES[t.easeStyle] } : {}),
  } as CSSProperties;
}

/** Реэкспорт: у веба был свой мини-реестр шрифтов, теперь он один на оба
 *  клиента (prefs/fonts.ts). Имя оставлено ради прежних потребителей. */
export { fontFamily };
export { accentRoleVars, customAccentVars };
