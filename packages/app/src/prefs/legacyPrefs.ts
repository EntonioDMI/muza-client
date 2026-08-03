/** Миграция строковых пресетов Prefs в числа (ползунки вместо пресетов).
 *  До этой волны radiusTiles/…/animSpeed/density/lineSpacing были enum-строками
 *  («sharper», «compact»…) — старые сохранения (localStorage muza.prefs.v1),
 *  локальные темы и опубликованные темы маркетплейса держат их до сих пор.
 *  Используется в prefs/load.ts (loadPrefs обоих клиентов) И
 *  themes.sanitizeTokens (темы!).
 *
 *  ПЕРЕЕЗД 2026-08-02 из apps/desktop/src/lib/legacyPrefs.ts: миграция обязана
 *  ехать вместе с моделью — иначе браузер, получив профиль со старыми
 *  строковыми пресетами, молча отбросил бы половину оформления. */

import { RADIUS_OVERRIDE_OFF } from "./types";

/** Пресет → число. Значения = бывшие таблицы App.tsx, чтобы мигрированный
 *  вид совпал со старым пиксель-в-пиксель. */
export const LEGACY_ENUM_TO_NUMBER: Record<string, Record<string, number>> = {
  radiusTiles: { sharper: 50, preset: 100, rounder: 160 },
  radiusPanels: { sharper: 50, preset: 100, rounder: 160 },
  radiusControls: { pill: RADIUS_OVERRIDE_OFF, soft: 14, sharp: 8 },
  radiusFields: { preset: RADIUS_OVERRIDE_OFF, soft: 16, sharp: 8 },
  density: { compact: 0, normal: 50, spacious: 100 },
  lineSpacing: { tight: 125, normal: 140, relaxed: 160 },
  animSpeed: { fast: 60, normal: 100, slow: 170 },
};

/** Диапазон числовой настройки. `offAbove` — значение выше max означает не
 *  «зажать до max», а сентинел RADIUS_OVERRIDE_OFF («как в ДС»). */
export interface NumberRange {
  min: number;
  max: number;
  offAbove?: boolean;
}

/** Диапазоны клампинга (мусор из чужих тем не должен ломать вид).
 *  Для radiusControls/Fields значения выше max трактуются как сентинел OFF.
 *  T7: углы «до упора» — radiusTiles/Panels 0–200% (было 50–160), radius-
 *  Controls/Fields минимум 0px (было 6px, max/сентинел не менялись).
 *
 *  ЭКСПОРТИРУЕТСЯ (2026-08-03): границы нужны не только миграции строковых
 *  пресетов, но и фильтру чужих тем — themes.ts достраивает из этой таблицы
 *  THEME_NUMBER_RANGES на ВСЕ числовые ключи темы. Вторая таблица тех же чисел
 *  разъехалась бы с этой на первой же правке диапазона, поэтому таблица ОДНА.
 *  Отсюда же чинится строка radiusTabs: этот ключ строковым пресетом никогда не
 *  был, в LEGACY_ENUM_TO_NUMBER его нет — а migrateLegacyValue зовут ТОЛЬКО для
 *  ключей оттуда, так что до правки его диапазон был недостижим. Теперь его
 *  читает sanitizeTokens по общей числовой ветке. */
export const PREF_RANGES: Record<string, NumberRange> = {
  radiusTiles: { min: 0, max: 200 },
  radiusPanels: { min: 0, max: 200 },
  radiusControls: { min: 0, max: 26, offAbove: true },
  radiusFields: { min: 0, max: 26, offAbove: true },
  radiusTabs: { min: 0, max: 26, offAbove: true },
  density: { min: 0, max: 100 },
  lineSpacing: { min: 125, max: 160 },
  animSpeed: { min: 60, max: 170 },
};

export const MIGRATED_PREF_KEYS = Object.keys(LEGACY_ENUM_TO_NUMBER);

/** Число в границы диапазона; не число, NaN или Infinity → undefined
 *  (звонящий подставляет дефолт). Отдельной функцией, потому что зовут её из
 *  двух мест: миграция старых сохранений и фильтр чужих тем. */
export function clampToRange(range: NumberRange, value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (range.offAbove && value > range.max) return RADIUS_OVERRIDE_OFF;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Строка-пресет или число → валидное число; не распозналось → undefined
 *  (звонящий подставляет дефолт). */
export function migrateLegacyValue(key: string, value: unknown): number | undefined {
  const range = PREF_RANGES[key];
  if (!range) return undefined;
  if (typeof value === "string") {
    return LEGACY_ENUM_TO_NUMBER[key]?.[value];
  }
  return clampToRange(range, value);
}
