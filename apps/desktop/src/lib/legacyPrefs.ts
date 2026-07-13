/** Миграция строковых пресетов Prefs в числа (ползунки вместо пресетов).
 *  До этой волны radiusTiles/…/animSpeed/density/lineSpacing были enum-строками
 *  («sharper», «compact»…) — старые сохранения (localStorage muza.prefs.v1),
 *  локальные темы и опубликованные темы маркетплейса держат их до сих пор.
 *  Используется в App.loadPrefs И themes.sanitizeTokens (темы!). */

import { RADIUS_OVERRIDE_OFF } from "../types";

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

/** Диапазоны клампинга (мусор из чужих тем не должен ломать вид).
 *  Для radiusControls/Fields значения выше max трактуются как сентинел OFF. */
const RANGES: Record<string, { min: number; max: number; offAbove?: boolean }> = {
  radiusTiles: { min: 50, max: 160 },
  radiusPanels: { min: 50, max: 160 },
  radiusControls: { min: 6, max: 26, offAbove: true },
  radiusFields: { min: 6, max: 26, offAbove: true },
  density: { min: 0, max: 100 },
  lineSpacing: { min: 125, max: 160 },
  animSpeed: { min: 60, max: 170 },
};

export const MIGRATED_PREF_KEYS = Object.keys(LEGACY_ENUM_TO_NUMBER);

/** Строка-пресет или число → валидное число; не распозналось → undefined
 *  (звонящий подставляет дефолт). */
export function migrateLegacyValue(key: string, value: unknown): number | undefined {
  const range = RANGES[key];
  if (!range) return undefined;
  if (typeof value === "string") {
    return LEGACY_ENUM_TO_NUMBER[key]?.[value];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (range.offAbove && value > range.max) return RADIUS_OVERRIDE_OFF;
    return Math.min(range.max, Math.max(range.min, Math.round(value)));
  }
  return undefined;
}
