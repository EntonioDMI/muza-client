/** Автообновление (Stage 8): tauri-plugin-updater поверх GitHub Releases.
 *  Endpoint и pubkey зашиты в tauri.conf.json — сюда приходит уже проверенный
 *  подписанный артефакт (minisign-подпись updater-ключа, анти-подмена).
 *  В браузере (vite без Tauri) всё честно недоступно. */

import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export interface FoundUpdate {
  version: string;
  notes: string | null;
  /** Скачать, установить и перезапуститься. onProgress: 0..100 (или -1, если
   *  сервер не прислал размер). Windows завершает приложение сам. */
  install: (onProgress: (pct: number) => void) => Promise<void>;
}

export function updaterAvailable(): boolean {
  return isTauri();
}

/** null — обновлений нет; бросает, если проверка не удалась (нет сети и т.п.). */
export async function checkForUpdate(): Promise<FoundUpdate | null> {
  if (!isTauri()) return null;
  const update: Update | null = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? null,
    install: async (onProgress) => {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          onProgress(total > 0 ? 0 : -1);
        } else if (event.event === "Progress") {
          got += event.data.chunkLength;
          if (total > 0) onProgress(Math.min(99, Math.round((got / total) * 100)));
        } else {
          onProgress(100);
        }
      });
      await relaunch();
    },
  };
}

const LAST_CHECK_KEY = "muza.updater.lastCheck.v1";

/** Автопроверка при старте: не чаще раза в сутки, ошибки молча глотаются
 *  (фоновая проверка не должна беспокоить). null = обновления нет/рано. */
export async function autoCheckForUpdate(): Promise<FoundUpdate | null> {
  if (!isTauri()) return null;
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
  if (Date.now() - last < 24 * 3600 * 1000) return null;
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}
