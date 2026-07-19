/** Темы как объекты (Stage 6): именованный снапшот оформления — подмножество
 *  Prefs (THEME_KEYS) + CSS-тир. Хранение локальное (localStorage), обмен —
 *  JSON через буфер (файловый экспорт — беклог) и маркетплейс (сервер). */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";
import { DEFAULT_PREFS, type Prefs } from "../types";
import { LEGACY_ENUM_TO_NUMBER, migrateLegacyValue } from "./legacyPrefs";

/** Ключи Prefs, входящие в тему: ТОЛЬКО оформление. Поведение (телеметрия,
 *  радио, EQ и т.п.) темой не переносится — чужая тема не должна менять
 *  ничего, кроме внешности. */
export const THEME_KEYS = [
  "theme",
  "accent",
  "customAccent",
  "accentRolesOn",
  "accentPlay",
  "accentSlider",
  "accentActive",
  "radius",
  "radiusTiles",
  "radiusPanels",
  "radiusControls",
  "radiusFields",
  "radiusTabs",
  "bgType",
  "bgColor",
  "bgColor2",
  "bgImageUrl",
  "bgDim",
  "bgTint",
  "bgAnimatedInvert",
  "blurScenery",
  "baseBg",
  "textDim",
  "uiScale",
  "animSpeed",
  "karaokeSize",
  "wSidebar",
  "wNowPlaying",
  "blur",
  "glassOpacity",
  "glassZonesOn",
  "glassPlayer",
  "glassMenu",
  "glassDialog",
  "glassSidebar",
  "glassNowPlaying",
  "anims",
  "customCssOn",
  "customCss",
  // Дыра 19.07 закрыта (спека настроек §6): раньше темы молча ТЕРЯЛИ эти
  // группы — человек делился темой, а типографика, плотность, визуализатор
  // и состав строки трека не переезжали. Всё это оформление — едет с темой.
  "fontScale",
  "lineSpacing",
  "density",
  "rowShow",
  "visualizer",
  "visualizerBars",
  "visualizerMirror",
  "visualizerWaveSmooth",
  "visualizerWaveCalm",
  "visualizerWaveThick",
  "visualizerWaveFill",
  "visualizerWaveAmp",
  "visualizerBarFill",
  "visualizerBarRound",
  "visualizerBarCalm",
  "visualizerOpacity",
  "bassShake",
  "bassShakeStrength",
] as const satisfies readonly (keyof Prefs)[];

/** Ключи Prefs, ОСОЗНАННО не переносимые темой: поведение, приватное,
 *  привязанное к машине или аккаунту. Чужая тема не должна менять ничего,
 *  кроме внешности (шапка THEME_KEYS), и не должна тащить чужие персональные
 *  списки (навигация, кнопки бара, блоки статистики). Полноту классификации
 *  сторожит themes.coverage.test.ts: новое поле Prefs без места в одном из
 *  двух списков валит тест. */
export const THEME_EXCLUDED = [
  "startView",
  "meaningMode",
  "autostart",
  "miniPlayer",
  "tray",
  "closeToTray",
  "normalize",
  "crossfade",
  "crossfadeSec",
  "gapless",
  "cacheLimitGb",
  "eqOn",
  "eqPreset",
  "eqBands",
  "speedSteps",
  "sleepPresets",
  "radioEndless",
  "telemetry",
  "discordRpcOn",
  "discordBtnOn",
  "discordBtnLabel",
  "discordBtnUrl",
  "discordShowCover",
  "discordLine1",
  "discordLine2",
  "barButtons",
  "navItems",
  "statsBlocks",
  "statsPeriod",
  "language",
  "resumePosition",
  "doubleClickAction",
  "mediaKeys",
  "instantSearch",
  "searchScope",
  "searchGrouping",
  "syncedLyrics",
  "lyricsAutoScroll",
  "lyricsEndNote",
  "listeningLyricsShown",
  "wrappedAmbientVol",
  "streamQuality",
  "sourcesEnabled",
  "sourcePolicy",
  "hotkeys",
] as const satisfies readonly (keyof Prefs)[];

export type ThemeTokens = Partial<Pick<Prefs, (typeof THEME_KEYS)[number]>>;

export interface SavedTheme {
  id: string;
  name: string;
  createdAt: string;
  tokens: ThemeTokens;
}

/** Проводной формат обмена (буфер/маркетплейс): маркер + токены. */
export interface ThemeFile {
  muzaTheme: 1;
  name: string;
  tokens: ThemeTokens;
}

const STORE_KEY = "muza.themes.v1";

export function listThemes(): SavedTheme[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTheme[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(themes: SavedTheme[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(themes));
}

/** Снять токены темы с текущих Prefs. */
export function tokensFromPrefs(prefs: Prefs): ThemeTokens {
  const tokens: ThemeTokens = {};
  for (const k of THEME_KEYS) {
    (tokens as Record<string, unknown>)[k] = prefs[k];
  }
  return tokens;
}

/** Сохранить текущее оформление как тему (одноимённая перезаписывается).
 *  `lang` — язык дефолтного имени, если пользователь ничего не ввёл
 *  (потребитель, views/SettingsView.tsx, вне зоны этой правки — без lang
 *  дефолт EN, было RU). */
export function saveTheme(name: string, prefs: Prefs, lang: Lang = DEFAULT_LANG): SavedTheme {
  const theme: SavedTheme = {
    id: crypto.randomUUID(),
    name: name.trim() || translate(lang, "media.themes.myTheme"),
    createdAt: new Date().toISOString(),
    tokens: tokensFromPrefs(prefs),
  };
  const rest = listThemes().filter((t) => t.name !== theme.name);
  persist([theme, ...rest].slice(0, 50));
  return theme;
}

export function deleteTheme(id: string): void {
  persist(listThemes().filter((t) => t.id !== id));
}

/** Добавить готовую тему (импорт/маркетплейс) в локальный список. */
export function addTheme(name: string, tokens: ThemeTokens, lang: Lang = DEFAULT_LANG): SavedTheme {
  const theme: SavedTheme = {
    id: crypto.randomUUID(),
    name: name.trim() || translate(lang, "media.themes.theme"),
    createdAt: new Date().toISOString(),
    tokens: sanitizeTokens(tokens),
  };
  const rest = listThemes().filter((t) => t.name !== theme.name);
  persist([theme, ...rest].slice(0, 50));
  return theme;
}

/** Применить тему к Prefs: только известные ключи, чужие поля отбрасываются.
 *  Отсутствующий в теме ключ оформления сбрасывается к дефолту — тема
 *  описывает вид целиком, а не патч. */
export function applyTheme(tokens: ThemeTokens, prefs: Prefs): Prefs {
  const next = { ...prefs };
  const clean = sanitizeTokens(tokens);
  for (const k of THEME_KEYS) {
    (next as Record<string, unknown>)[k] = k in clean ? clean[k] : DEFAULT_PREFS[k];
  }
  return next;
}

/** Отфильтровать токены: только THEME_KEYS и только тип, совпадающий с
 *  дефолтом (грубая рантайм-валидация чужого JSON). Ключи-ползунки, бывшие
 *  строковыми пресетами (radiusTiles и т.п.), мигрируются ДО typeof-фильтра —
 *  иначе старые темы молча теряли бы эти ключи. */
export function sanitizeTokens(raw: unknown): ThemeTokens {
  const out: Record<string, unknown> = {};
  if (typeof raw !== "object" || raw === null) return out as ThemeTokens;
  for (const k of THEME_KEYS) {
    let v = (raw as Record<string, unknown>)[k];
    if (v !== undefined && k in LEGACY_ENUM_TO_NUMBER) {
      v = migrateLegacyValue(k, v); // строка-пресет/мусор → число или undefined
    }
    if (v !== undefined && typeof v === typeof DEFAULT_PREFS[k]) out[k] = v;
  }
  return out as ThemeTokens;
}

export function serializeTheme(name: string, tokens: ThemeTokens): string {
  const file: ThemeFile = { muzaTheme: 1, name, tokens };
  return JSON.stringify(file, null, 2);
}

/** Разобрать JSON темы из буфера; null — это не тема Muza. */
export function parseTheme(json: string): { name: string; tokens: ThemeTokens } | null {
  try {
    const parsed = JSON.parse(json) as Partial<ThemeFile>;
    if (parsed.muzaTheme !== 1 || typeof parsed.name !== "string") return null;
    return { name: parsed.name.slice(0, 60), tokens: sanitizeTokens(parsed.tokens) };
  } catch {
    return null;
  }
}
