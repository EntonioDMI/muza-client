/** Движок темы веба (Э1 веб-паритета, 2026-07-21): подмножество формул
 *  rootStyle десктопа (apps/desktop/src/App.tsx, ~1578) — РОВНО те же
 *  выражения для общих ключей, чтобы одна тема выглядела одинаково на обеих
 *  платформах. Источник истины формул пока App.tsx: сведение десктопа на этот
 *  модуль — следующий этап марафона (правка сердца App.tsx делается отдельным
 *  заходом с приёмкой, не ночью). Расхождение формул = баг.
 *
 *  Светлая тема: ставим data-theme="light" — слои перекрашивает themes.css
 *  из @muza/ui (та же механика, что на десктопе). */

import type { CSSProperties } from "react";
import { accentRoleVars, customAccentVars } from "./accent";

/** Подмножество Prefs десктопа, которым уже управляет веб. Имена и типы
 *  ключей 1-в-1 с desktop types.ts — тема, снятая на десктопе, приложится
 *  на вебе без переименований (задел под общий Prefs). */
export interface WebTheme {
  theme: "dark" | "light";
  accent: "blue" | "red" | "bolt" | "custom";
  customAccent: string;
  radius: "mild" | "soft" | "round";
  /** px блюра матового стекла (--blur-glass). */
  blur: number;
  /** Плотность стекла, % (--glass-panel). */
  glassOpacity: number;
  /** Приглушённость вторичного текста, % (--text-2/3). */
  textDim: number;
  fontUi: "golos" | "unbounded" | "system";
}

/** Дефолты = DEFAULT_PREFS десктопа (types.ts) для общих ключей. */
export const DEFAULT_WEB_THEME: WebTheme = {
  theme: "dark",
  accent: "blue",
  customAccent: "#22c55e",
  radius: "soft",
  blur: 28,
  glassOpacity: 62,
  textDim: 62,
  fontUi: "golos",
};

/** Реестр шрифтов веба — подмножество lib/fonts.ts десктопа (golos/unbounded
 *  бандлятся через @muza/ui fonts.css; системный — стек Segoe UI). */
export function fontFamily(key: WebTheme["fontUi"]): string {
  switch (key) {
    case "unbounded":
      return `"Unbounded", "Segoe UI", system-ui, sans-serif`;
    case "system":
      return `"Segoe UI", system-ui, sans-serif`;
    default:
      return `"Golos Text", "Segoe UI", system-ui, sans-serif`;
  }
}

/** data-атрибуты корня: пресетные акценты/радиусы применяет CSS ДС. */
export function themeAttrs(t: WebTheme): {
  "data-theme"?: "light";
  "data-accent"?: string;
  "data-radius"?: string;
} {
  return {
    ...(t.theme === "light" ? { "data-theme": "light" as const } : {}),
    ...(t.accent !== "blue" && t.accent !== "custom" ? { "data-accent": t.accent } : {}),
    ...(t.radius !== "soft" ? { "data-radius": t.radius } : {}),
  };
}

/** CSS-переменные корня — формулы зеркалят rootStyle App.tsx. */
export function buildThemeVars(t: WebTheme): CSSProperties {
  const isLight = t.theme === "light";
  // База текста/стекла зависит от темы (App.tsx:1520-1521)
  const textBase = isLight ? "28, 26, 23" : "244, 243, 241";
  const glassBase = isLight ? "250, 249, 246" : "23, 22, 20";
  return {
    "--blur-glass": `${t.blur}px`,
    "--glass-panel": `rgba(${glassBase}, ${t.glassOpacity / 100})`,
    ...(t.accent === "custom" ? customAccentVars(t.customAccent, isLight) : {}),
    "--text-2": `rgba(${textBase}, ${(t.textDim / 100).toFixed(2)})`,
    "--text-3": `rgba(${textBase}, ${Math.max(0.2, t.textDim / 100 - 0.24).toFixed(2)})`,
    ...(t.fontUi !== "golos" ? { "--font-ui": fontFamily(t.fontUi) } : {}),
  } as CSSProperties;
}

export { accentRoleVars, customAccentVars };
