import { useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { MuzaApi } from "@muza/api-client";

/** Visit-пинг (админ-панель, кусок B; решение владельца 16.07): «уникальные
 *  посещения за день» без идентификаторов — дедуп ЗДЕСЬ, на клиенте: максимум
 *  один пинг в календарный (локальный) день, отметка в localStorage. Сервер
 *  видит только счётчик (day, appVersion, platform). Та же галочка
 *  prefs.telemetry; эндпоинт анонимный — canSearch не нужен. */

export const VISIT_DAY_KEY = "muza.visit.v1";

// пинг чуть позже старта: не толкаемся с загрузкой каталога и плеера
const PING_DELAY_MS = 3_000;

export function detectPlatform(userAgent: string): string {
  if (/windows/i.test(userAgent)) return "windows";
  if (/mac os|macintosh/i.test(userAgent)) return "macos";
  if (/linux|x11/i.test(userAgent)) return "linux";
  return "unknown";
}

const localDay = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function useVisitPing(api: MuzaApi, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const today = localDay();
    if (localStorage.getItem(VISIT_DAY_KEY) === today) return;
    const timer = setTimeout(() => {
      void (async () => {
        let appVersion = "0.0.0";
        try {
          appVersion = await getVersion();
        } catch {
          /* web/тесты — версия неизвестна */
        }
        try {
          await api.sendVisit({ appVersion, platform: detectPlatform(navigator.userAgent) });
          // день отмечаем ТОЛЬКО после удачи: сорвалось — следующий запуск повторит
          localStorage.setItem(VISIT_DAY_KEY, today);
        } catch {
          /* best-effort: посещение потеряно — не страшно */
        }
      })();
    }, PING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [api, enabled]);
}
