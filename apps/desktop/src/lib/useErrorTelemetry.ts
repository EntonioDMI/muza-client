import { useEffect, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { MuzaApi } from "@muza/api-client";
import { errorReporter, type ErrorReporter } from "./errorReporter";

const SEND_EVERY_MS = 10 * 60_000; // ритм useTelemetry — не плодим свои интервалы

/** Отправка буфера errorReporter (админ-панель, кусок A): раз в 10 минут под
 *  согласием prefs.telemetry. В отличие от useTelemetry НЕ гейтится на
 *  isTauri/canSearch: POST /telemetry/error анонимный, а падения до логина —
 *  самые ценные. Выключенная телеметрия выбрасывает буфер, а не копит его. */
export function useErrorTelemetry(api: MuzaApi, enabled: boolean, reporter: ErrorReporter = errorReporter) {
  const busyRef = useRef(false);

  useEffect(() => {
    const flush = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        if (!enabled) {
          reporter.clear();
          return;
        }
        const errors = reporter.take();
        if (errors.length === 0) return;
        // не getVersion().catch(): вне Tauri invoke кидает СИНХРОННО
        let appVersion = "0.0.0";
        try {
          appVersion = await getVersion();
        } catch {
          /* web/тесты — версия неизвестна */
        }
        // ⚠️ СУФФИКС РАЗРАБОТКИ (11.08.2026). getVersion() читает
        // tauri.conf.json, а он ОДИН И ТОТ ЖЕ у `pnpm desktop` и у собранного
        // установщика — из-за этого вкладка «Ошибки» показывала разработку
        // вперемешку с продом, и отличить одно от другого по данным было
        // нельзя. Разбор: docs/notes/2026-08-11-разбор-ошибок-на-проде.md
        // (1003 «ошибки» на 0.2.0 — все до одной свои же dev-сессии).
        //
        // Не глушим отправку целиком: падение в разработке — ровно тот случай,
        // когда телеметрия нужна больше всего, просто смотреть на него надо
        // отдельно. Сервер прячет `-dev` из вкладки, пока его не попросят.
        //
        // ⚠️ app_version на сервере — VarChar(32); суффикс обязан влезть в него
        // ВМЕСТЕ с версией, поэтому режем до отправки, а не после.
        if (import.meta.env.DEV) appVersion = `${appVersion}-dev`.slice(0, 32);
        await api.sendClientErrors({ appVersion, errors });
      } catch {
        /* best-effort: окно потеряно — не страшно (симметрия useTelemetry) */
      } finally {
        busyRef.current = false;
      }
    };
    if (enabled) reporter.onUrgent(() => void flush());
    const iv = setInterval(() => void flush(), SEND_EVERY_MS);
    return () => {
      clearInterval(iv);
      reporter.onUrgent(null);
    };
  }, [api, enabled, reporter]);
}
