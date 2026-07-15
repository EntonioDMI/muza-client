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

/** Период автопроверки обновлений — на него App.tsx вешает setInterval.
 *  Раньше периодичности не было вовсе: единственной проверкой был одноразовый
 *  таймер при старте, поэтому сессия, открытая несколько суток (для плеера это
 *  норма), не узнавала о новой версии никогда. Два часа взяты щедро, потому что
 *  цена запроса нулевая: latest.json — статика с GitHub CDN, ни нашего сервера,
 *  ни трафика это не касается. */
export const UPDATE_CHECK_INTERVAL_MS = 2 * 3600 * 1000;

/** Автопроверка: не чаще UPDATE_CHECK_INTERVAL_MS, ошибки молча глотаются
 *  (фоновая проверка не должна беспокоить). null = обновления нет/рано.
 *  Троттл на метке в localStorage — страховка МЕЖДУ перезапусками (частые
 *  рестарты не должны долбить проверкой на каждый старт); периодичность внутри
 *  живой сессии даёт setInterval, а не он. */
export async function autoCheckForUpdate(): Promise<FoundUpdate | null> {
  if (!isTauri()) return null;
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
  if (Date.now() - last < UPDATE_CHECK_INTERVAL_MS) return null;
  try {
    const found = await checkForUpdate();
    // Метка ставится ТОЛЬКО после успеха. Раньше она писалась до try, и упавшая
    // проверка (нет сети, спящий ноутбук) сжигала всё окно до следующей попытки.
    // Ответ «обновлений нет» (null) — тоже успех: сервер ответил, метку пишем.
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    return found;
  } catch {
    return null;
  }
}
