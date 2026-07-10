/** Discord Rich Presence: JS-мост к src-tauri/src/rpc.rs (Stage 3, слайс 7).
 *  Discord не запущен / client_id не настроен — Rust молча вернёт false. */

import { invoke, isTauri } from "@tauri-apps/api/core";

export interface DiscordActivity {
  details: string;
  state: string;
  /** Только https (Discord тянет внешние URL сам); локальные обложки не отдаём. */
  coverUrl: string | null;
  /** Unix-секунды старта трека — прогресс «слушает N минут». */
  startTs: number | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
}

export async function updateDiscordActivity(a: DiscordActivity): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("rpc_update", {
      payload: {
        details: a.details,
        state: a.state,
        cover_url: a.coverUrl,
        start_ts: a.startTs,
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
