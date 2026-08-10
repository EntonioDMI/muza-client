"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_LANG, type Lang } from "@muza/app";
import { DEFAULT_PREFS, type Prefs } from "@muza/app/prefs/types";
import { loadPrefs, mergePrefs, parseStoredPrefs, PREFS_KEY, savePrefs } from "@muza/app/prefs/load";

/** Настройки веба — ТОТ ЖЕ профиль, что у приложения (волна веб-паритета,
 *  фаза 2, 2026-08-02).
 *
 *  Было: свой узкий тип WebPrefs на 14 полей и свой ключ хранения. Стало:
 *  общая модель @muza/app/prefs. Причина — не красота, а поведение: пока
 *  профили разные, настройка, сделанная в приложении, в браузере просто не
 *  существует, и наоборот.
 *
 *  Два правила, из которых всё следует:
 *  1. ХРАНИМ ЦЕЛИКОМ. В браузере лежат и те поля, которые вкладка применить
 *     не может (окно поверх других, значок у часов, вывод на устройства).
 *     Иначе заход на сайт стирал бы половину профиля, собранного в программе.
 *  2. ПРИМЕНЯЕМ ТОЛЬКО ЧТО УМЕЕМ. Список применяемого — ниже по файлу и в
 *     потребителях (providers.tsx → ThemeRoot, AppShell, player.tsx). Чего
 *     площадка не умеет, у неё и не спрашивают (розетка @muza/app/platform). */

/** Язык интерфейса по умолчанию для СОВСЕМ нового посетителя (хранилище
 *  пусто): смотрим `navigator.language`, ru* → ru, иначе EN (И5-веб, 22.07).
 *  Профили, сохранённые ДО языковой настройки, мигрирует mergePrefs
 *  (resolveMigratedLanguage — им остаётся привычный русский). */
function detectBrowserLanguage(): Lang {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : DEFAULT_LANG;
}

/** Дефолты ПЕРВОГО ЗАПУСКА в браузере. Отличие от DEFAULT_PREFS ровно одно и
 *  оно намеренное: размытая обложка фоном — фирменный вид сайта, и раньше
 *  веб-дефолт `bgCover: true` его включал. В приложении фон по умолчанию
 *  выключен (bgType "none"), там за вид отвечает целый раздел настроек.
 *  Сохранённый профиль всегда главнее этих значений — приехавший из программы
 *  bgType не перезаписывается. */
export const DEFAULT_WEB_PREFS: Prefs = { ...DEFAULT_PREFS, bgType: "cover" };

/** Старый ключ веба. Читается ОДИН раз — при первом запуске на общей модели,
 *  и НЕ УДАЛЯЕТСЯ: если релиз придётся откатить, человек вернётся на прежнюю
 *  версию сайта и найдёт свои настройки на месте. Лишние ~300 байт в
 *  localStorage — честная цена за это. */
const LEGACY_WEB_KEY = "muza.web.prefs.v1";

/** Форма старого веб-профиля: имена полей совпадали с Prefs, кроме `bgCover`
 *  (предок `bgType`, тот же переход приложение прошло в Stage 6). */
type LegacyWebPrefs = Partial<Prefs> & { bgCover?: boolean };

/** Профиль старого ключа → общая модель. `bgCover` разбирается здесь, а не
 *  в общем mergePrefs: тот умеет только `true → "cover"` (в сохранениях
 *  приложения поля просто не было, когда фон не просили), а веб писал и
 *  явное `false` — «человек ВЫКЛЮЧИЛ сценографию», и включать её обратно
 *  веб-дефолтом нельзя. */
function fromLegacyWeb(legacy: LegacyWebPrefs): Prefs {
  const { bgCover, ...rest } = legacy;
  // bgCover выбрасывается, а не переносится: в общем профиле поля больше нет,
  // и таскать его дальше значило бы возить между клиентами ключ-призрак.
  // Сам старый ключ хранилища при этом остаётся нетронутым (LEGACY_WEB_KEY).
  return mergePrefs({ ...rest, bgType: bgCover === false ? "none" : "cover" }, DEFAULT_WEB_PREFS);
}

/** Совместимость имени: старые потребители писали `WebPrefs["theme"]` и т.п.
 *  Отдельного веб-типа больше нет — это общая модель. */
export type WebPrefs = Prefs;

interface PrefsCtx {
  prefs: Prefs;
  set: (patch: Partial<Prefs>) => void;
  /** Заменить профиль ЦЕЛИКОМ. Нужен синхронизации: приехавший с сервера
   *  профиль — это не «правка нескольких полей», а другое состояние. */
  applyPrefs: (p: Prefs) => void;
  /** Профиль уже поднят с диска (localStorage читается после маунта). */
  loaded: boolean;
}

const Ctx = createContext<PrefsCtx | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_WEB_PREFS);
  /** Локальный профиль поднят с диска. До этого синхронизации нельзя давать
   *  ход: она залила бы на сервер дефолты вместо настроек этого устройства. */
  const [loaded, setLoaded] = useState(false);

  // localStorage читается после маунта (SSR-пререндер его не видит)
  useEffect(() => {
    try {
      // 1. Общий профиль — если он есть, старый ключ больше не смотрим.
      if (localStorage.getItem(PREFS_KEY)) {
        setPrefs(loadPrefs(DEFAULT_WEB_PREFS));
        return;
      }
      // 2. Первый запуск после переезда: поднимаем профиль со старого ключа
      //    и пишем его в общий. Старый остаётся лежать (см. LEGACY_WEB_KEY).
      const legacy = parseStoredPrefs(localStorage.getItem(LEGACY_WEB_KEY)) as LegacyWebPrefs | null;
      if (legacy) {
        const migrated = fromLegacyWeb(legacy);
        savePrefs(migrated);
        setPrefs(migrated);
        return;
      }
      // 3. Совсем новый посетитель — язык браузера решает дефолт вкладки.
      setPrefs({ ...DEFAULT_WEB_PREFS, language: detectBrowserLanguage() });
    } catch {
      /* битые сохранения — дефолты */
    } finally {
      setLoaded(true);
    }
  }, []);

  const set = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next); // профиль пишется ЦЕЛИКОМ, включая неприменимые поля
      return next;
    });
  }, []);

  /** Профиль приехал с сервера — кладём целиком и на диск тоже: следующий
   *  запуск обязан открыться уже с ним, не дожидаясь сети. */
  const applyPrefs = useCallback((next: Prefs) => {
    savePrefs(next);
    setPrefs(next);
  }, []);

  return <Ctx.Provider value={{ prefs, set, applyPrefs, loaded }}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrefs вне PrefsProvider");
  return ctx;
}
