/** API-модуль Muza.Player (эпик W8, T44): плеер + очередь. Метод→право —
 *  в @muza/core METHOD_PERMISSIONS; здесь только реализация поверх бриджа.
 *  Ошибка формы args → throw "bad_args: ...". */

import type { PluginApiContext, PluginApiModule } from "../types";

function num(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`bad_args: ${name} — число`);
  return v;
}
function strArr(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`bad_args: ${name} — массив строк`);
  return v as string[];
}
function arg(args: unknown): Record<string, unknown> {
  return (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
}

/** Метаданные трека для плагина — БЕЗ URL источников/токенов (§3.1 дока). */
function safeTrack(t: { id: string; title: string; artist: string; album: string; duration: number } | null) {
  if (!t) return null;
  return { id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration };
}

export const playerApi: PluginApiModule = {
  "player.getState": ({ bridge }: PluginApiContext) => {
    const s = bridge.player.getState();
    return { state: s.state, position: s.position, volume: s.volume, queue: s.queue.map(safeTrack) };
  },
  "player.getCurrentTrack": ({ bridge }) => safeTrack(bridge.player.getCurrentTrack()),
  "player.getQueue": ({ bridge }) => bridge.player.getQueue().map(safeTrack),
  "player.play": ({ bridge }) => {
    bridge.player.play();
  },
  "player.pause": ({ bridge }) => {
    bridge.player.pause();
  },
  "player.next": ({ bridge }) => {
    bridge.player.next();
  },
  "player.prev": ({ bridge }) => {
    bridge.player.prev();
  },
  "player.seek": ({ bridge }, args) => {
    bridge.player.seek(num(arg(args).sec, "sec"));
  },
  "player.setVolume": ({ bridge }, args) => {
    bridge.player.setVolume(num(arg(args).v, "v"));
  },
  "player.setRate": ({ bridge }, args) => {
    bridge.player.setRate(num(arg(args).r, "r"));
  },
  "player.enqueue": async ({ bridge }, args) => {
    const a = arg(args);
    const ids = strArr(a.trackIds, "trackIds");
    const pos = a.pos === undefined ? undefined : num(a.pos, "pos");
    const tracks = (await Promise.all(ids.map((id) => bridge.resolveTrack(id)))).filter((t): t is NonNullable<typeof t> => !!t);
    bridge.player.enqueue(tracks, pos);
  },
  "player.removeFromQueue": ({ bridge }, args) => {
    bridge.player.removeFromQueueAt(num(arg(args).pos, "pos"));
  },
  "player.reorderQueue": ({ bridge }, args) => {
    const a = arg(args);
    bridge.player.reorderQueue(num(a.from, "from"), num(a.to, "to"));
  },
  "player.clearQueue": ({ bridge }) => {
    bridge.player.clearQueue();
  },
  "player.playTrack": async ({ bridge }, args) => {
    const id = arg(args).trackId;
    if (typeof id !== "string") throw new Error("bad_args: trackId — строка");
    const t = await bridge.resolveTrack(id);
    if (!t) throw new Error("bad_args: трек не найден или недоступен");
    bridge.player.playTrack(t);
  },
};
