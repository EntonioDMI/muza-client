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
  /** Скачать установщик, НЕ устанавливая. onProgress: 0..100 (или -1, если
   *  сервер не прислал размер).
   *
   *  Загрузка отделена от установки намеренно: кнопка обновления показывается
   *  готовой только когда установщик уже лежит на диске. Иначе человек жмёт
   *  «Установить» и минуту смотрит на неподвижное окно, не понимая, началось
   *  что-то или нет. */
  download: (onProgress: (pct: number) => void) => Promise<void>;
  /** Поставить уже скачанное и перезапуститься. Windows закрывает приложение
   *  сам — вызывать после download(). */
  install: () => Promise<void>;
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
    download: async (onProgress) => {
      let total = 0;
      let got = 0;
      await update.download((event) => {
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
    },
    install: async () => {
      await update.install();
      await relaunch();
    },
  };
}

/** Период автопроверки обновлений — на него App.tsx вешает setInterval.
 *
 *  Полчаса. Раньше стояло два часа, и вдобавок проверка глушилась меткой в
 *  localStorage: перезапустил приложение через десять минут — метка свежая,
 *  проверки при старте не происходит вовсе. Это ровно то, чего владелец не
 *  хотел; решение 10.08 — проверять КАЖДЫЙ старт и дальше раз в полчаса.
 *  Цена запроса нулевая: latest.json — статика с GitHub CDN, ни нашего
 *  сервера, ни заметного трафика это не касается. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Фоновая проверка: ошибки молча глотаются — беспокоить человека из-за
 *  отсутствия сети незачем. null означает «обновления нет или не дозвонились».
 *
 *  Троттла здесь намеренно НЕТ: частоту задаёт вызывающий (проверка при старте
 *  плюс интервал), а лишний слой «не чаще раза в N» уже однажды привёл к тому,
 *  что обновление не находилось совсем. */
export async function autoCheckForUpdate(): Promise<FoundUpdate | null> {
  if (!isTauri()) return null;
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}
