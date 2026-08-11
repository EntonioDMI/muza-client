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

/** Чем кончилась попытка показать активность. Зеркало RpcOutcome из rpc.rs.
 *
 *  ⚠️ Раньше здесь был `boolean`, и пять разных исходов приходили неотличимо.
 *  Именно поэтому жалоба «у меня Discord не работает вообще» (5 из семи,
 *  12.08) не поддавалась разбору: у нас не было НИ ОДНОГО способа узнать, что
 *  именно не сложилось у человека. */
export interface DiscordOutcome {
  ok: boolean;
  /** Где оборвалось: "off" — сборка без application id; "no_client" — клиент
   *  IPC не создался; "no_discord" — Discord не отвечает (не запущен, запущен
   *  от другого пользователя, версия из Microsoft Store с изолированным
   *  каналом); "rejected" — Discord отклонил активность; "ok" — показана. */
  stage: "off" | "no_client" | "no_discord" | "rejected" | "ok";
  /** Что сказали система или Discord; null — сказать нечего. */
  message: string | null;
}

const NOT_DESKTOP: DiscordOutcome = { ok: false, stage: "off", message: null };

/** Итог последней попытки — чтобы настройки могли его показать, не дёргая
 *  Discord заново. Живёт в модуле: активность шлёт App, а показывает экран
 *  настроек, и городить ради одного поля общее состояние незачем. */
let lastOutcome: DiscordOutcome | null = null;

export function discordLastOutcome(): DiscordOutcome | null {
  return lastOutcome;
}

export async function updateDiscordActivity(a: DiscordActivity): Promise<DiscordOutcome> {
  if (!isTauri()) return NOT_DESKTOP;
  try {
    lastOutcome = await invoke<DiscordOutcome>("rpc_update", {
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
    return lastOutcome;
  } catch (e) {
    // Сама команда не доехала — это уже не «Discord не запущен», а поломка
    // моста; путать их нельзя, иначе диагностика будет врать.
    lastOutcome = {
      ok: false,
      stage: "no_client",
      message: e instanceof Error ? e.message : String(e),
    };
    return lastOutcome;
  }
}

/** Проба связи для кнопки «Проверить подключение» в настройках.
 *
 *  Шлёт НАСТОЯЩУЮ активность, а не пингует канал: у Discord подключение и приём
 *  активности — разные шаги, и отклонить он может именно второй. Кнопка идёт с
 *  теми же значениями, что стоят у человека, — иначе проверка проверяла бы не
 *  то, на что он жалуется (пункт 2 из семи: «кастомная кнопка не работает»). */
export async function testDiscordActivity(button: {
  label: string | null;
  url: string | null;
}): Promise<DiscordOutcome> {
  const now = Math.floor(Date.now() / 1000);
  return updateDiscordActivity({
    details: "Muza",
    state: "Проверка подключения",
    coverUrl: null,
    startTs: now,
    endTs: null,
    buttonLabel: button.label,
    buttonUrl: button.url,
  });
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
