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

/** Шаблон строки активности: подстановки {track}/{artist}/{album}. Пустые
 *  значения подчищаются вместе с висячими разделителями (« — », «·»…):
 *  "{artist} — {album}" без альбома отдаёт просто артиста. Лимит Discord —
 *  128 символов. */
export function formatTemplate(
  tpl: string,
  vars: { track: string; artist: string; album?: string },
): string {
  const out = tpl
    .replaceAll("{track}", vars.track)
    .replaceAll("{artist}", vars.artist)
    .replaceAll("{album}", vars.album ?? "")
    // разделители, повисшие на месте пустой подстановки
    .replace(/^[\s\-—–·|:]+/, "")
    .replace(/[\s\-—–·|:]+$/, "")
    .replace(/\s{2,}/g, " ");
  return out.slice(0, 128);
}

/** Обложка для Discord-активности. Discord тянет внешний https-URL как есть и
 *  НЕ кропает его (в статусе — letterbox-кадр с полями, жалоба 2026-07-16), а
 *  локальные байты (кроп useCoverArt — data-URL канвы) ему не отдать. Для
 *  ytimg-тумб — центральный квадрат через публичный резайз-прокси weserv
 *  (стандартный трюк RPC-интеграций): у музыкальных тумб YouTube арт всегда
 *  ровно по центру кадра (hqdefault 480×360 → арт 360×360, maxres 1280×720 →
 *  720×720), так что слепой center-crop без канвы режет точно по арту. Прокси
 *  упал — Discord просто покажет активность без картинки, не ошибка.
 *  Остальные источники (iTunes и т.п.) и так квадратные — как есть. */
export function discordCoverUrl(raw: string | null): string | null {
  if (!raw || !raw.startsWith("https")) return null;
  try {
    if (!/(^|\.)ytimg\.com$/.test(new URL(raw).hostname)) return raw;
  } catch {
    return null; // кривой URL из каталога — лучше без картинки, чем падение эффекта
  }
  // trim=30 — автообрезка однотонных полей ДО квадратного кропа: у hqdefault
  // рамки ДВОЙНЫЕ (16:9-кадр в 4:3-холсте + поля вокруг самого арта), и слепой
  // центральный квадрат оставлял боковые полосы внутри (жалоба 2026-07-16).
  // Проверено на тёмных и светлых артах: поля уходят, арт не отъедается.
  return `https://images.weserv.nl/?url=${encodeURIComponent(raw)}&trim=30&w=600&h=600&fit=cover`;
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
