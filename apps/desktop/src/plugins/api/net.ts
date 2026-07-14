/** API-модуль Muza.Net (эпик W8, T44): fetch с allowlist. Настоящая проверка
 *  прав (net + net_allow host + https-only) — на Rust-стороне
 *  (plugins.rs::plugin_net_fetch), фронту не доверяем: даже если host.ts
 *  пропустит, Rust перепроверит granted и net_allow из installed.json. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PluginApiContext, PluginApiModule } from "../types";

function arg(args: unknown): Record<string, unknown> {
  return (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
}

interface NetInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function sanitizeInit(raw: unknown): NetInit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: NetInit = {};
  if (typeof r.method === "string") out.method = r.method;
  if (r.headers && typeof r.headers === "object") {
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
      if (typeof v === "string") h[k] = v;
    }
    out.headers = h;
  }
  if (typeof r.body === "string") out.body = r.body;
  return out;
}

export const netApi: PluginApiModule = {
  "net.fetch": ({ pluginId }: PluginApiContext, args) => {
    if (!isTauri()) throw new Error("internal: сеть плагина доступна только в приложении");
    const a = arg(args);
    const url = a.url;
    if (typeof url !== "string") throw new Error("bad_args: url — строка");
    return invoke("plugin_net_fetch", { id: pluginId, url, init: sanitizeInit(a.init) });
  },
};
