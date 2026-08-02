/** Discord Rich Presence: JS-мост к src-tauri/src/rpc.rs (Stage 3, слайс 7).
 *  Discord не запущен / client_id не настроен — Rust молча вернёт false. */

import { invoke, isTauri } from "@tauri-apps/api/core";

export interface DiscordActivity {
  details: string;
  state: string;
  /** Только https (Discord тянет внешние URL сам); локальные обложки не отдаём. */
  coverUrl: string | null;
  /** Unix-секунды старта трека — счётчик «слушает N минут». */
  startTs: number | null;
  /** Unix-секунды конца трека: вместе со start Discord рисует нативную
   *  прогресс-линию (prefs.discordProgressOn); null — только счётчик. */
  endTs: number | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
}

/** ЧИСТЫЕ ПРАВИЛА (годность ссылки кнопки, сборка строки активности, адрес
 *  обложки) переехали в @muza/app/lib/discord — по ним же рисует предпросмотр
 *  под-экрана настроек, а он стал общим (волна «настройки», 2026-08-02).
 *  Ре-экспорт: потребители (App.tsx, discord.test.ts) импортов не меняли. */
export { discordCoverUrl, formatTemplate, isValidButtonUrl } from "@muza/app/lib/discord";

export async function updateDiscordActivity(a: DiscordActivity): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("rpc_update", {
      payload: {
        details: a.details,
        state: a.state,
        cover_url: a.coverUrl,
        start_ts: a.startTs,
        // end_ts обязателен для прогресс-линии: поле уже терялось здесь молча
        // (в типах обеих сторон было, в передаче — нет), Discord показывал
        // счётчик минут вместо шкалы. Контракт закреплён discord.test.ts.
        end_ts: a.endTs,
        button_label: a.buttonLabel,
        button_url: a.buttonUrl,
      },
    });
  } catch {
    return false;
  }
}

export async function clearDiscordActivity(): Promise<void> {
  if (!isTauri()) return;
  await invoke("rpc_clear").catch(() => undefined);
}

/** Настроен ли Application ID (компайл-тайм client_id в rpc.rs непуст).
 *  В вебе всегда false — как и весь Discord-мост. */
export async function rpcAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("rpc_available");
  } catch {
    return false;
  }
}
