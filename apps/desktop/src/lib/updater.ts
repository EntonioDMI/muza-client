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
   *  Нужен сайдбару: он тянет установщик молча сразу после проверки, чтобы к
   *  моменту, когда человек заметит и нажмёт кнопку, ставить было уже нечего.
   *  Иначе человек жмёт «Установить» и минуту смотрит на неподвижное окно. */
  download: (onProgress: (pct: number) => void) => Promise<void>;
  /** Скачать (если ещё не) и поставить, затем перезапуститься. Windows
   *  закрывает приложение сам — код после вызова не исполняется.
   *
   *  ⚠️ «ЕСЛИ ЕЩЁ НЕ» — ЭТО И ЕСТЬ ИСПРАВЛЕНИЕ (жалоба 17.08: «Couldn't
   *  install the update», при том что проверка обновление находит). Потоков
   *  обновления ДВА, и раньше выживал только один:
   *    - сайдбар (App.tsx) — сам звал `download()`, потом `install()`: работал;
   *    - экран настроек — зовёт `install(onProgress)` СРАЗУ, потому что порт
   *      `UpdatesPort` объявляет ровно одну операцию «скачать и поставить».
   *      Он попадал в install() без единого download — а плагин на это
   *      отвечает `Update.install called before Update.download`
   *      (dist-js/index.js). Человек видел общее «не удалось установить».
   *  Теперь инвариант «к установке байты есть» держит ЭТОТ модуль, а не
   *  дисциплина вызывающих: их двое, и один её уже нарушил.
   *
   *  ⚠️ ПОЧЕМУ ЭТО НЕ ПОЙМАЛ TYPESCRIPT: функция с МЕНЬШИМ числом аргументов
   *  присваивается туда, где ждут больше. `install: () => Promise<void>` тихо
   *  сошла за `install(onProgress)` из порта, и сборка была зелёной. */
  install: (onProgress?: (pct: number) => void) => Promise<void>;
}

export function updaterAvailable(): boolean {
  return isTauri();
}

/** null — обновлений нет; бросает, если проверка не удалась (нет сети и т.п.). */
export async function checkForUpdate(): Promise<FoundUpdate | null> {
  if (!isTauri()) return null;
  const update: Update | null = await check();
  if (!update) return null;
  // Скачано ли уже — ЗДЕСЬ, а не у вызывающих: их двое (сайдбар и настройки),
  // и повторный download на одном и том же Update качал бы установщик заново.
  let downloaded = false;
  const runDownload = async (onProgress: (pct: number) => void) => {
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
    downloaded = true;
  };
  return {
    version: update.version,
    notes: update.body ?? null,
    download: runDownload,
    install: async (onProgress) => {
      if (!downloaded) await runDownload(onProgress ?? (() => undefined));
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
