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
