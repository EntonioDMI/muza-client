/** Мост main-окна и мини-плеера (tauri events). Звук живёт ТОЛЬКО в main:
 *  main шлёт снапшоты состояния, мини шлёт команды. Мини при старте кричит
 *  hello — main отвечает свежим снапшотом (иначе пустое окно до первого
 *  события). Вне Tauri все функции — no-op. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface MiniState {
  title: string;
  artist: string;
  cover: string;
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
  await invoke("miniplayer_show").catch(() => undefined);
}

export async function miniHide(): Promise<void> {
  if (!isTauri()) return;
  await invoke("miniplayer_hide").catch(() => undefined);
}

export async function miniSendState(state: MiniState): Promise<void> {
  if (!isTauri()) return;
  await emitTo("mini", STATE_EVENT, state).catch(() => undefined);
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
  await emitTo("main", HELLO_EVENT, null).catch(() => undefined);
}

export async function miniCommand(cmd: MiniCommand): Promise<void> {
  if (!isTauri()) return;
  await emitTo("main", CMD_EVENT, cmd).catch(() => undefined);
}

export async function miniOnState(cb: (s: MiniState) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<MiniState>(STATE_EVENT, (e) => cb(e.payload));
}
