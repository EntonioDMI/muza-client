/** Мост main-окна и мини-плеера (tauri events). Звук живёт ТОЛЬКО в main:
 *  main шлёт снапшоты состояния, мини шлёт команды. Мини при старте кричит
 *  hello — main отвечает свежим снапшотом (иначе пустое окно до первого
 *  события). Вне Tauri все функции — no-op. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Снапшот для мини-окна. `title === null` — в main ничего не играет (очередь
 *  пуста): мини рисует честное «нет трека», а не последний застрявший. */
export interface MiniState {
  title: string | null;
  artist: string | null;
  /** ⚠️ ПОЛЕ НЕОБЯЗАТЕЛЬНОЕ, и это не мелочь: обложка приезжает сюда уже
   *  КАРТИНКОЙ ЦЕЛИКОМ (useCoverArt кропает её на канве в data-URL) — сотни
   *  килобайт. Снапшот уходит на каждый тик позиции, то есть раз в секунду,
   *  и до 02.08 эти килобайты сериализовались и переезжали между процессами
   *  заново каждую секунду при неизменной картинке.
   *  Договор: поле ОТСУТСТВУЕТ — «не менялась, оставь прежнюю»; поле есть
   *  (в том числе null) — «вот новая». Поэтому приёмник обязан МЕРЖИТЬ
   *  снапшот в предыдущий, а не заменять (см. mini/MiniPlayer.tsx). */
  cover?: string | null;
  playing: boolean;
  pos: number;
  duration: number;
  liked: boolean;
}

export type MiniCommand = "toggle" | "next" | "prev" | "like" | "close";

const STATE_EVENT = "muza://mini-state";
const CMD_EVENT = "muza://mini-cmd";
const HELLO_EVENT = "muza://mini-hello";

// ── Сторона main ──────────────────────────────────────────────────

export async function miniShow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("miniplayer_show").catch((err) => console.error("[miniBridge]", err));
}

export async function miniHide(): Promise<void> {
  if (!isTauri()) return;
  await invoke("miniplayer_hide").catch((err) => console.error("[miniBridge]", err));
}

export async function miniSendState(state: MiniState): Promise<void> {
  if (!isTauri()) return;
  await emitTo("mini", STATE_EVENT, state).catch((err) => console.error("[miniBridge]", err));
}

/** main: слушать команды мини и его hello (ответить снапшотом). */
export async function miniListen(
  onCommand: (cmd: MiniCommand) => void,
  onHello: () => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  const un1 = await listen<MiniCommand>(CMD_EVENT, (e) => onCommand(e.payload));
  const un2 = await listen(HELLO_EVENT, () => onHello());
  return () => {
    un1();
    un2();
  };
}

// ── Сторона мини ──────────────────────────────────────────────────

export async function miniHello(): Promise<void> {
  if (!isTauri()) return;
  await emitTo("main", HELLO_EVENT, null).catch((err) => console.error("[miniBridge]", err));
}

export async function miniCommand(cmd: MiniCommand): Promise<void> {
  if (!isTauri()) return;
  await emitTo("main", CMD_EVENT, cmd).catch((err) => console.error("[miniBridge]", err));
}

export async function miniOnState(cb: (s: MiniState) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<MiniState>(STATE_EVENT, (e) => cb(e.payload));
}
