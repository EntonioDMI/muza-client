/** Темы как объекты (Stage 6): именованный снапшот оформления — подмножество
 *  Prefs (THEME_KEYS) + CSS-тир. Хранение локальное (localStorage), обмен —
 *  JSON через буфер (файловый экспорт — беклог) и маркетплейс (сервер).
 *
 *  ПЕРЕЕЗД 2026-08-02 из apps/desktop/src/lib/themes.ts: классификация ключей
 *  живёт РЯДОМ с самой моделью (prefs/types.ts) намеренно — сторож
 *  themes.coverage.test.ts связывает их в одну точку правды, и разъехаться
 *  им теперь физически негде. */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";
import { VIS_LIMITS } from "../lib/visualizerMath";
import { DEFAULT_PREFS, type Prefs } from "./types";
import { clampToRange, LEGACY_ENUM_TO_NUMBER, migrateLegacyValue, PREF_RANGES, type NumberRange } from "./legacyPrefs";

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
  "bgAnimSpeedSec",
  "bgAnimOpacity",
  "bgAnimScale",
  "bgAnimEdge",
  "blurScenery",
  "baseBg",
  "textDim",
  "uiScale",
  "animSpeed",
  "karaokeSize",
  "karaokeLines",
  "lyricsPanelLines",
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
  "bassSharp",
  "bassReach",
  "hPlayerBar",
  "coverBarSize",
  "durMenuMult",
  "durDialogMult",
  "durPageMult",
  "easeStyle",
  "tileSize",
  "padTile",
  "gapZone",
  "fontUi",
  "fontDisplay",
  "headingScale",
  "spaceScale",
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
  // Вывод на устройства (2026-07-22): deviceId привязаны к машине —
  // в чужой системе таких устройств нет, тема их переносить не должна.
  "audioOutputs",
  "outputProfiles",
  "activeOutputProfile",
  "micDeviceId",
  "micDeviceLabel",
  "micGain",
  "speedSteps",
  "sleepPresets",
  "radioEndless",
  "telemetry",
  "discordRpcOn",
  "discordBtnOn",
  "discordBtnLabel",
  "discordBtnUrl",
  "discordShowCover",
  "discordProgressOn",
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
  "videoNowPlaying",
  // Открывать ли «Сейчас играет» самой — привычка человека, а не внешность:
  // чужая тема не должна распахивать панель (и уж тем более закрывать).
  "npOpen",
  "listeningLyricsShown",
  "wrappedAmbientVol",
  "streamQuality",
  "sourcesEnabled",
  "sourcePolicy",
  "hotkeys",
  "seekStepSec",
  "warmAhead",
  "preloadAheadSec",
  // Прокрутка — эргономика ввода (мышь конкретного человека), не внешность.
  "scrollSpeed",
  "scrollSmooth",
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
 *  `lang` — язык дефолтного имени, если пользователь ничего не ввёл. Зовущий
 *  обязан его передать: значение по умолчанию здесь — только для вызовов без
 *  языка вообще, и русский интерфейс получал от них «My theme» (2026-08-03,
 *  все три вызова экрана настроек язык теперь передают). */
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

/** ГРАНИЦЫ ЧИСЛОВЫХ КЛЮЧЕЙ ТЕМЫ (2026-08-03).
 *
 *  Зачем: до этой таблицы чужая тема проверялась ТОЛЬКО на тип, и `uiScale:
 *  100000` проезжал насквозь — zoom корня становился 1000, интерфейс переставал
 *  читаться, а кнопка «Сбросить оформление» уезжала за пределы окна. Тема
 *  ставится штатной кнопкой с витрины (views/settings/MarketSub.tsx), то есть
 *  «закирпичить» окно мог кто угодно, а восстановление оставалось одно — чистка
 *  хранилища. Так же вели себя NaN, −1e9 и `wSidebar: 999999`.
 *
 *  Числа = границам ползунков соответствующих рядов настроек (свой ползунок
 *  дать больше не может, и чужая тема тоже не должна). Границы ползунков
 *  визуализатора берутся из VIS_LIMITS, а границы ключей, переживших миграцию
 *  из строковых пресетов, — из PREF_RANGES: обе таблицы уже существуют, копия
 *  их чисел здесь разъехалась бы с ними.
 *
 *  Полноту сторожит themes.test.ts: числовой ключ THEME_KEYS без строки здесь
 *  валит тест — иначе новая ручка снова поехала бы без границ. */
export const THEME_NUMBER_RANGES: Record<string, NumberRange> = {
  // radiusTiles/Panels/Controls/Fields/Tabs, density, lineSpacing, animSpeed
  ...PREF_RANGES,
  bgDim: { min: 0, max: 80 },
  bgAnimSpeedSec: { min: 16, max: 180 },
  bgAnimOpacity: { min: 5, max: 60 },
  bgAnimScale: { min: 100, max: 200 },
  bgAnimEdge: { min: 0, max: 40 },
  blurScenery: { min: 0, max: 80 },
  textDim: { min: 40, max: 80 },
  uiScale: { min: 85, max: 125 },
  durMenuMult: { min: 60, max: 170 },
  durDialogMult: { min: 60, max: 170 },
  durPageMult: { min: 60, max: 170 },
  karaokeSize: { min: 36, max: 72 },
  karaokeLines: { min: 3, max: 11 },
  // 0 — «Авто» (размер строки диктует общий «Размер текста»), дальше 4..14
  lyricsPanelLines: { min: 0, max: 14 },
  wSidebar: { min: 240, max: 340 },
  wNowPlaying: { min: 300, max: 420 },
  blur: { min: 0, max: 64 },
  // Общее стекло панелей: пол — GLASS_MIN ряда «Прозрачность» (ниже панели с
  // текстом не читаются). Зональное стекло идёт от нуля намеренно — см.
  // комментарий у GLASS_MIN в views/settings/primitives.tsx.
  glassOpacity: { min: 30, max: 100 },
  glassPlayer: { min: 0, max: 100 },
  glassMenu: { min: 0, max: 100 },
  glassDialog: { min: 0, max: 100 },
  glassSidebar: { min: 0, max: 100 },
  glassNowPlaying: { min: 0, max: 100 },
  fontScale: { min: 85, max: 125 },
  headingScale: { min: 85, max: 120 },
  spaceScale: { min: 85, max: 125 },
  hPlayerBar: { min: 72, max: 120 },
  coverBarSize: { min: 44, max: 80 },
  tileSize: { min: 140, max: 240 },
  padTile: { min: 8, max: 24 },
  gapZone: { min: 4, max: 20 },
  bassShakeStrength: { min: 0, max: 300 },
  bassSharp: { min: 0, max: 100 },
  bassReach: { min: 0, max: 100 },
  visualizerBars: VIS_LIMITS.bars,
  visualizerBarFill: VIS_LIMITS.barFill,
  visualizerBarRound: VIS_LIMITS.barRound,
  visualizerBarCalm: VIS_LIMITS.barCalm,
  visualizerWaveSmooth: VIS_LIMITS.waveSmooth,
  visualizerWaveCalm: VIS_LIMITS.waveCalm,
  visualizerWaveThick: VIS_LIMITS.waveThick,
  visualizerWaveFill: VIS_LIMITS.waveFill,
  visualizerWaveAmp: VIS_LIMITS.waveAmp,
  visualizerOpacity: VIS_LIMITS.opacity,
};

/** Объектный токен темы (сегодня такой один — rowShow) по образцу дефолта.
 *
 *  Почему не хватало `typeof v === typeof DEFAULT_PREFS[k]`: `typeof null`
 *  тоже "object", и тема с `"rowShow": null` клала null прямо в профиль. Дальше
 *  экран «Кастомизация» читал `prefs.rowShow.cover` и падал — причём падал ровно
 *  там, где тему и снимают, так что руками из этого было уже не выбраться.
 *  Массив ловится тем же местом. Под-поля собираются от дефолта: чужой объект
 *  без половины ключей не должен оставлять `rowShow.duration === undefined`. */
function sanitizeObjectToken(def: object, v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = { ...(def as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    if (typeof src[key] === typeof out[key]) out[key] = src[key];
  }
  return out;
}

/** Отфильтровать токены: только THEME_KEYS, только тип, совпадающий с дефолтом,
 *  и только значение в границах ряда настроек (грубая рантайм-валидация чужого
 *  JSON). Ключи-ползунки, бывшие строковыми пресетами (radiusTiles и т.п.),
 *  мигрируются ДО typeof-фильтра — иначе старые темы молча теряли бы эти ключи.
 *
 *  Инвариант: что бы ни лежало в чужом JSON, applyTheme не может положить в
 *  Prefs ни null вместо объекта, ни число вне диапазона ползунка. */
export function sanitizeTokens(raw: unknown): ThemeTokens {
  const out: Record<string, unknown> = {};
  if (typeof raw !== "object" || raw === null) return out as ThemeTokens;
  for (const k of THEME_KEYS) {
    let v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (k in LEGACY_ENUM_TO_NUMBER) {
      v = migrateLegacyValue(k, v); // строка-пресет/мусор → число или undefined
      if (v === undefined) continue;
    }
    const def: unknown = DEFAULT_PREFS[k];
    if (def !== null && typeof def === "object") {
      const obj = sanitizeObjectToken(def, v);
      if (obj) out[k] = obj;
      continue;
    }
    if (typeof v !== typeof def) continue;
    if (typeof v === "number") {
      const range = THEME_NUMBER_RANGES[k];
      // Ключа нет в таблице — тест-сторож такого не пропустит; на всякий
      // случай отбрасываем NaN/Infinity, они ломают любой CSS-токен.
      const n = range ? clampToRange(range, v) : Number.isFinite(v) ? v : undefined;
      if (n !== undefined) out[k] = n;
      continue;
    }
    out[k] = v;
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
