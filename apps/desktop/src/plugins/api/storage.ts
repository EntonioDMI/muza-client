/** API-модуль Muza.Storage (эпик W8, T44): KV на диске, неймспейс по id
 *  плагина, квота 1 МБ — всё на Rust-стороне (plugins.rs::plugin_storage_*).
 *  В браузере (vite без Tauri) хранилища нет — методы кидают internal. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PluginApiContext, PluginApiModule } from "../types";

function arg(args: unknown): Record<string, unknown> {
  return (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
}
function str(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`bad_args: ${name} — строка`);
  return v;
}

/** Rust возвращает ошибки строкой с префиксом кода (quota:/internal:/...);
 *  прокидываем как есть — host.ts распарсит префикс в EnvelopeCode. */
async function call<T>(cmd: string, payload: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("internal: хранилище доступно только в приложении");
  return invoke<T>(cmd, payload);
}

export const storageApi: PluginApiModule = {
  "storage.get": ({ pluginId }: PluginApiContext, args) =>
    call<string | null>("plugin_storage_get", { id: pluginId, key: str(arg(args).key, "key") }),
  "storage.set": ({ pluginId }, args) => {
    const a = arg(args);
    const value = a.value;
    if (typeof value !== "string") throw new Error("bad_args: value — строка (сериализуй JSON сам)");
    return call<void>("plugin_storage_set", { id: pluginId, key: str(a.key, "key"), value });
  },
  "storage.remove": ({ pluginId }, args) =>
    call<void>("plugin_storage_remove", { id: pluginId, key: str(arg(args).key, "key") }),
  "storage.keys": ({ pluginId }) => call<string[]>("plugin_storage_keys", { id: pluginId }),
};
