/** Анонимная агрегированная аналитика (Stage 3, слайс 8): раз в 10 минут
 *  снимаем счётчики добычи из Rust (engine_stats_take — снял и обнулил) и
 *  локальные счётчики прослушиваний, шлём на сервер БЕЗ идентификаторов.
 *  Модель согласия — заметка аналитики: анонимный агрегат по умолчанию. */

import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import type { MuzaApi } from "@muza/api-client";
import { engineStatsTake } from "./engine";

const SEND_EVERY_MS = 10 * 60_000;

export interface PlayCounters {
  plays: number;
  completed: number;
}

export function useTelemetry(api: MuzaApi, enabled: boolean, playCounters: React.RefObject<PlayCounters>) {
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    const tick = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const stats = await engineStatsTake();
        const plays = playCounters.current ?? { plays: 0, completed: 0 };
        const total =
          stats.resolve_ok + stats.resolve_fail + stats.attempts + stats.cache_hits + plays.plays;
        if (total === 0) return; // пустое окно — не шумим
        const recipe = await invoke<{ recipe_version?: number }>("recipe_current").catch(
          () => ({}) as { recipe_version?: number },
        );
        const appVersion = await getVersion().catch(() => "0.0.0");
        await api.sendTelemetry({
          appVersion,
          recipeVersion: recipe.recipe_version ?? 0,
          resolveOk: stats.resolve_ok,
          resolveFail: stats.resolve_fail,
          attempts: stats.attempts,
          cacheHits: stats.cache_hits,
          fail403: stats.fail_403,
          failBot: stats.fail_bot,
          failFormat: stats.fail_format,
          failOther: stats.fail_other,
          plays: plays.plays,
          playsCompleted: plays.completed,
        });
        // окно ушло — обнуляем локальные счётчики (Rust обнулил свои сам)
        playCounters.current = { plays: 0, completed: 0 };
      } catch {
        /* best-effort: не дошло — счётчики прослушиваний пропали, не страшно */
      } finally {
        busyRef.current = false;
      }
    };
    const iv = setInterval(() => void tick(), SEND_EVERY_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, enabled]);
}
