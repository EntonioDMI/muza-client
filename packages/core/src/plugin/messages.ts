/** Конверт postMessage-моста хост↔guest (эпик W8, T44) — Zod-схема, общая
 *  для host.ts (apps/desktop/src/plugins/host.ts) и guest-рантайма
 *  (Rust-ассет apps/desktop/src-tauri/src/plugin_guest_runtime.js — тот
 *  плейн-JS реализует тот же формат конверта вручную, т.к. исполняется
 *  внутри песочницы без доступа к npm-модулям; этот файл — источник
 *  истины для host-стороны и тестов).
 *  См. docs/notes/2026-07-13-плагины-архитектура.md §2.2. */

import { z } from "zod";

export const PLUGIN_PROTOCOL_VERSION = 1 as const;

export const EnvelopeKindSchema = z.enum(["ready", "req", "res", "event", "error"]);
export type EnvelopeKind = z.infer<typeof EnvelopeKindSchema>;

export const EnvelopeCodeSchema = z.enum(["denied", "bad_args", "timeout", "quota", "internal", "not_yet"]);
export type EnvelopeCode = z.infer<typeof EnvelopeCodeSchema>;

export const PluginEnvelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(64),
  kind: EnvelopeKindSchema,
  method: z.string().min(1).max(80).optional(),
  args: z.unknown().optional(),
  ok: z.boolean().optional(),
  result: z.unknown().optional(),
  code: EnvelopeCodeSchema.optional(),
  message: z.string().max(500).optional(),
});
export type PluginEnvelope = z.infer<typeof PluginEnvelopeSchema>;

let seq = 0;
/** id сообщения, уникальный в пределах реалма-отправителя (req/event несут
 *  свой id; ответ на req переиспользует тот же id — так host сопоставляет
 *  ответ ожидающему промису). */
export function nextMessageId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function makeReq(id: string, method: string, args?: unknown): PluginEnvelope {
  return { v: 1, id, kind: "req", method, args };
}
export function makeRes(id: string, result?: unknown): PluginEnvelope {
  return { v: 1, id, kind: "res", ok: true, result };
}
export function makeErrorRes(id: string, code: EnvelopeCode, message: string): PluginEnvelope {
  return { v: 1, id, kind: "error", ok: false, code, message };
}
export function makeEvent(id: string, method: string, args?: unknown): PluginEnvelope {
  return { v: 1, id, kind: "event", method, args };
}
export function makeReady(id: string): PluginEnvelope {
  return { v: 1, id, kind: "ready" };
}

/** Парс входящего сообщения от чужого окна: не наш конверт (или мусор от
 *  постороннего postMessage) → null, а не исключение — вызывающая сторона
 *  просто игнорирует. */
export function parseEnvelope(data: unknown): PluginEnvelope | null {
  const res = PluginEnvelopeSchema.safeParse(data);
  return res.success ? res.data : null;
}
