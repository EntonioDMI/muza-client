"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Настройки веба (мини-версия десктопных Prefs): живут в localStorage,
 *  применяются мгновенно. Скоуп сознательно узкий — «минимальные настройки»,
 *  остальная кастомизация — фишка десктопа. */

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
      if (raw) setPrefs({ ...DEFAULT_WEB_PREFS, ...(JSON.parse(raw) as Partial<WebPrefs>) });
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
