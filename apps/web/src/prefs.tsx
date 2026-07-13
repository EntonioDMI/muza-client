"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Настройки веба (мини-версия десктопных Prefs): живут в localStorage,
 *  применяются мгновенно. Скоуп сознательно узкий — «минимальные настройки»,
 *  остальная кастомизация — фишка десктопа. */

export interface WebPrefs {
  /** Акцент ДС: blue (дефолт токенов) | red (пламя лого) | bolt (глубокий синий). */
  accent: "blue" | "red" | "bolt";
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
  accent: "blue",
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
