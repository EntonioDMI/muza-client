"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_LANG, resolveMigratedLanguage, type Lang } from "@muza/app";

/** Настройки веба (мини-версия десктопных Prefs): живут в localStorage,
 *  применяются мгновенно. Скоуп сознательно узкий — «минимальные настройки»,
 *  остальная кастомизация — фишка десктопа. */

/** Язык интерфейса по умолчанию для СОВСЕМ нового посетителя (localStorage
 *  пуст): смотрим `navigator.language`, ru* → ru, иначе EN (И5-веб, 22.07).
 *  Для профилей, сохранённых ДО этой правки (language нет, но prefs уже
 *  есть), сохраняем привычный русский — см. `resolveMigratedLanguage` ниже,
 *  та же логика, что у десктопа (i18n/index.tsx), веб был русским хардкодом. */
function detectBrowserLanguage(): Lang {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : DEFAULT_LANG;
}

export interface WebPrefs {
  /** Э1 веб-паритета (2026-07-21): тема — общее подмножество Prefs десктопа
   *  (имена/типы 1-в-1, см. @muza/app theme/themeVars.ts). Применяет ThemeRoot
   *  в providers.tsx. Акцент расширен значением "custom" (+customAccent). */
  theme: "dark" | "light";
  accent: "blue" | "red" | "bolt" | "custom";
  customAccent: string;
  radius: "mild" | "soft" | "round";
  blur: number;
  glassOpacity: number;
  textDim: number;
  fontUi: "golos" | "unbounded" | "system";
  /** Сценография: размытая обложка текущего трека фоном (фирменный вид Muza). */
  bgCover: boolean;
  /** Правая панель «Сейчас играет» открывается сама при старте трека (≥1200px). */
  npOpen: boolean;
  eqOn: boolean;
  eqPreset: string;
  eqBands: number[];
  /** T41: группировка ремиксов/версий в поиске — оригинал + версии одной
   *  карточкой (?group=1 сервера, T36). Default true (дизайн-док). */
  searchGrouping: boolean;
  /** И5-веб (2026-07-22): язык интерфейса, общий i18n-модуль @muza/app —
   *  см. providers.tsx (LanguageProvider) и detectBrowserLanguage выше. */
  language: Lang;
}

export const DEFAULT_WEB_PREFS: WebPrefs = {
  theme: "dark",
  accent: "blue",
  customAccent: "#22c55e",
  radius: "soft",
  blur: 28,
  glassOpacity: 62,
  textDim: 62,
  fontUi: "golos",
  bgCover: true,
  npOpen: true,
  eqOn: false,
  eqPreset: "Ровный",
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  searchGrouping: true,
  // Модульный дефолт — безопасен на сервере (SSR-пререндер статического
  // экспорта); реальный язык посетителя подставляется в эффекте ниже.
  language: DEFAULT_LANG,
};

const KEY = "muza.web.prefs.v1";

interface PrefsCtx {
  prefs: WebPrefs;
  set: (patch: Partial<WebPrefs>) => void;
}

const Ctx = createContext<PrefsCtx | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<WebPrefs>(DEFAULT_WEB_PREFS);

  // localStorage читается после маунта (SSR-пререндер его не видит)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<WebPrefs>;
        setPrefs({
          ...DEFAULT_WEB_PREFS,
          ...stored,
          // Профиль СУЩЕСТВОВАЛ до языковой настройки (raw уже был) — сохраняем
          // привычный русский, а не подсовываем detectBrowserLanguage: это тот
          // же манёвр, что resolveMigratedLanguage у десктопа (i18n/index.tsx).
          language: resolveMigratedLanguage(stored.language),
        });
      } else {
        // Совсем новый посетитель — язык браузера решает дефолт вкладки.
        setPrefs({ ...DEFAULT_WEB_PREFS, language: detectBrowserLanguage() });
      }
    } catch {
      /* битые сохранения — дефолты */
    }
  }, []);

  const set = useCallback((patch: Partial<WebPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ prefs, set }}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrefs вне PrefsProvider");
  return ctx;
}
