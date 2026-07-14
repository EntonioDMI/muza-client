/** Хост-мост плагинов уровня 1 (эпик W8, T44): реестр фреймов, диспетчер
 *  req→право→handler→res/error, широковещание событий по подпискам, таймауты
 *  и watchdog (ping/pong + дедлайн ready), тердаун зависшего фрейма.
 *
 *  Единый глобальный слушатель message; доверие к фрейму — по
 *  event.source === frame.contentWindow (origin фрейма opaque, сравнивать
 *  origin бессмысленно) + Zod-валидация конверта (@muza/core parseEnvelope).
 *  Код плагина в хост-realm НЕ попадает — только структурные вызовы через API.
 *  См. docs/notes/2026-07-13-плагины-архитектура.md §2.2, §3. */

import { METHOD_PERMISSIONS, type PluginPermission } from "@muza/core";
import {
  makeErrorRes,
  makeEvent,
  makeReq,
  makeRes,
  nextMessageId,
  parseEnvelope,
  type EnvelopeCode,
} from "@muza/core";
import { playerApi } from "./api/player";
import { libraryApi } from "./api/library";
import { uiApi } from "./api/ui";
import { storageApi } from "./api/storage";
import { netApi } from "./api/net";
import { allowedEventTypes } from "./api/events";
import type { PluginApiContext, PluginApiModule, PluginBridge, PluginRuntimeInfo } from "./types";

const REQ_DEADLINE_MS = 5000;
const READY_DEADLINE_MS = 3000;
const PING_INTERVAL_MS = 4000;
const PING_TIMEOUT_MS = 3000;
const MAX_MISSED_PINGS = 2;

/** strings.* зарезервированы (право + API), но реализация — после эпика i18n
 *  (§3.5 дока): пока честный not_yet, чтобы плагины уже могли объявлять право
 *  и вызывать метод, получая предсказуемый отказ, а не «метод не найден». */
const stringsApi: PluginApiModule = {
  "strings.override": () => {
    throw new Error("not_yet: Strings.override появится после эпика i18n");
  },
  "strings.reset": () => {
    throw new Error("not_yet: Strings.reset появится после эпика i18n");
  },
};

const API: PluginApiModule = {
  ...playerApi,
  ...libraryApi,
  ...uiApi,
  ...storageApi,
  ...netApi,
  ...stringsApi,
};

interface FrameReg {
  pluginId: string;
  win: Window;
  granted: PluginPermission[];
  status: PluginRuntimeInfo["status"];
  barButtonState: Record<string, { icon?: string; active?: boolean }>;
  badges: Record<string, string>;
  readyTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  pendingPing: { id: string; timer: ReturnType<typeof setTimeout> } | null;
  missedPings: number;
}

/** Причина строкой с префиксом кода → EnvelopeCode + чистое сообщение. */
function parseErr(e: unknown): { code: EnvelopeCode; message: string } {
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/^(denied|bad_args|timeout|quota|internal|not_yet):\s*(.*)$/s);
  if (m) return { code: m[1] as EnvelopeCode, message: m[2] || raw };
  return { code: "internal", message: raw };
}

class PluginHost {
  private frames = new Map<string, FrameReg>();
  /** win → pluginId, для сопоставления входящего message его фрейму. */
  private byWindow = new WeakMap<Window, string>();
  private bridge: PluginBridge | null = null;
  private injectedCss = new Map<string, string>();
  private listeners = new Set<() => void>();
  private started = false;
  /** Плагины, помеченные "зависшими" watchdog'ом (T44-fix: security review —
   *  раньше жила только в FrameReg.status, а unregisterFrame при размонтаже
   *  <iframe> стирал саму запись, из-за чего PluginFrames не имела, по чему
   *  фильтровать, и снятый фрейм оставался смонтированным). Живёт ОТДЕЛЬНО
   *  от frames — переживает unregisterFrame, иначе фильтр в PluginFrames
   *  размонтирует фрейм и тут же перемонтирует его на следующем рендере
   *  (crash-loop). Сбрасывается явно — clearCrashed (usePlugins.refresh,
   *  когда плагин выключили/удалили: следующее включение — новая попытка). */
  private crashedIds = new Set<string>();
  /** Монотонный счётчик состояния для useSyncExternalStore (getSnapshot). */
  private version = 0;

  /** Приложение задаёт бридж один раз (App.tsx). До этого req отвечают internal. */
  setBridge(bridge: PluginBridge): void {
    this.bridge = bridge;
  }

  /** Ленивая установка глобального слушателя (идемпотентно). */
  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener("message", this.onMessage);
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  runtimeVersion(): number {
    return this.version;
  }
  private notify(): void {
    this.version += 1;
    for (const cb of this.listeners) cb();
  }

  getRuntime(pluginId: string): PluginRuntimeInfo | null {
    const f = this.frames.get(pluginId);
    if (!f) return null;
    return { status: f.status, barButtonState: f.barButtonState, badges: f.badges };
  }
  getInjectedCss(): { pluginId: string; css: string }[] {
    return [...this.injectedCss.entries()].map(([pluginId, css]) => ({ pluginId, css }));
  }

  registerFrame(pluginId: string, iframe: HTMLIFrameElement, granted: PluginPermission[]): void {
    this.ensureStarted();
    const win = iframe.contentWindow;
    if (!win) return;
    this.unregisterFrame(pluginId); // повторный монтаж — старую регистрацию долой
    const reg: FrameReg = {
      pluginId,
      win,
      granted,
      status: "loading",
      barButtonState: {},
      badges: {},
      readyTimer: null,
      pingTimer: null,
      pendingPing: null,
      missedPings: 0,
    };
    reg.readyTimer = setTimeout(() => {
      if (reg.status === "loading") this.markCrashed(pluginId);
    }, READY_DEADLINE_MS);
    this.frames.set(pluginId, reg);
    this.byWindow.set(win, pluginId);
    this.notify();
  }

  unregisterFrame(pluginId: string): void {
    const f = this.frames.get(pluginId);
    if (!f) return;
    if (f.readyTimer) clearTimeout(f.readyTimer);
    if (f.pingTimer) clearInterval(f.pingTimer);
    if (f.pendingPing) clearTimeout(f.pendingPing.timer);
    this.frames.delete(pluginId);
    this.notify();
  }

  private markCrashed(pluginId: string): void {
    const f = this.frames.get(pluginId);
    if (!f || f.status === "crashed") return;
    if (f.readyTimer) clearTimeout(f.readyTimer);
    if (f.pingTimer) clearInterval(f.pingTimer);
    if (f.pendingPing) clearTimeout(f.pendingPing.timer);
    f.readyTimer = null;
    f.pingTimer = null;
    f.pendingPing = null;
    f.status = "crashed";
    this.crashedIds.add(pluginId);
    // Реальный тердаун JS-realm — снятие <iframe> из DOM; это делает React,
    // перерисовав слот по isCrashed() (PluginFrames фильтрует enabled по
    // pluginHost.isCrashed перед маунтом — см. usePlugins/PluginFrames).
    this.notify();
  }

  /** true — watchdog снял фрейм (зависший ready/ping); PluginFrames не должна
   *  монтировать <iframe> для такого id, пока явно не сброшено. */
  isCrashed(pluginId: string): boolean {
    return this.crashedIds.has(pluginId);
  }

  /** Сброс "зависшего" статуса — usePlugins вызывает, когда плагин выключили
   *  или удалили (следующее включение обязано быть новой честной попыткой
   *  монтажа, а не намертво заблокированным id до перезапуска приложения). */
  clearCrashed(pluginId: string): void {
    if (this.crashedIds.delete(pluginId)) this.notify();
  }

  private startWatchdog(reg: FrameReg): void {
    if (reg.pingTimer) return;
    reg.pingTimer = setInterval(() => {
      if (reg.pendingPing) return; // ещё ждём предыдущий pong
      const id = nextMessageId("ping");
      const timer = setTimeout(() => {
        reg.pendingPing = null;
        reg.missedPings += 1;
        if (reg.missedPings >= MAX_MISSED_PINGS) this.markCrashed(reg.pluginId);
      }, PING_TIMEOUT_MS);
      reg.pendingPing = { id, timer };
      try {
        reg.win.postMessage(makeReq(id, "__ping"), "*");
      } catch {
        clearTimeout(timer);
        reg.pendingPing = null;
      }
    }, PING_INTERVAL_MS);
  }

  private onMessage = (e: MessageEvent): void => {
    const pluginId = e.source ? this.byWindow.get(e.source as Window) : undefined;
    if (!pluginId) return;
    const reg = this.frames.get(pluginId);
    if (!reg || e.source !== reg.win) return;
    const env = parseEnvelope(e.data);
    if (!env) return;

    if (env.kind === "ready") {
      if (reg.readyTimer) clearTimeout(reg.readyTimer);
      reg.readyTimer = null;
      reg.status = "ready";
      reg.missedPings = 0;
      this.startWatchdog(reg);
      this.notify();
      return;
    }

    // pong: guest отвечает res на наш __ping тем же id
    if ((env.kind === "res" || env.kind === "error") && reg.pendingPing && env.id === reg.pendingPing.id) {
      clearTimeout(reg.pendingPing.timer);
      reg.pendingPing = null;
      reg.missedPings = 0;
      return;
    }

    if (env.kind === "req" && env.method) {
      void this.dispatch(reg, env.id, env.method, env.args);
    }
  };

  private async dispatch(reg: FrameReg, id: string, method: string, args: unknown): Promise<void> {
    const respond = (ok: boolean, payload: unknown, code?: EnvelopeCode, message?: string) => {
      try {
        reg.win.postMessage(
          ok ? makeRes(id, payload) : makeErrorRes(id, code ?? "internal", message ?? "error"),
          "*",
        );
      } catch {
        /* фрейм уже снят — ответ некому получить */
      }
    };

    const need = METHOD_PERMISSIONS[method];
    if (!need) {
      respond(false, null, "bad_args", `неизвестный метод ${method}`);
      return;
    }
    if (!reg.granted.includes(need)) {
      respond(false, null, "denied", `нет права ${need} для ${method}`);
      return;
    }
    const handler = API[method];
    if (!handler || !this.bridge) {
      respond(false, null, "internal", "метод недоступен");
      return;
    }
    const ctx: PluginApiContext = {
      pluginId: reg.pluginId,
      bridge: this.bridge,
      host: {
        setBadge: (pid, slot, text) => this.setBadge(pid, slot, text),
        setBarButtonState: (pid, slot, state) => this.setBarButtonState(pid, slot, state),
        applyCss: (pid, css) => this.applyCss(pid, css),
        removeCss: (pid) => this.removeCss(pid),
      },
    };

    try {
      const result = await Promise.race([
        Promise.resolve(handler(ctx, args)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout: обработчик завис")), REQ_DEADLINE_MS)),
      ]);
      respond(true, result ?? null);
    } catch (err) {
      const { code, message } = parseErr(err);
      respond(false, null, code, message);
    }
  }

  // ── Рантайм-состояние (UI.setBadge / setBarButtonState / applyCss) ──

  private setBadge(pluginId: string, slotId: string, text: string): void {
    const f = this.frames.get(pluginId);
    if (!f) return;
    f.badges = { ...f.badges, [slotId]: text };
    this.notify();
  }
  private setBarButtonState(pluginId: string, slotId: string, state: { icon?: string; active?: boolean }): void {
    const f = this.frames.get(pluginId);
    if (!f) return;
    f.barButtonState = { ...f.barButtonState, [slotId]: { ...f.barButtonState[slotId], ...state } };
    this.notify();
  }
  private applyCss(pluginId: string, css: string): void {
    this.injectedCss.set(pluginId, css);
    this.notify();
  }
  private removeCss(pluginId: string): void {
    if (this.injectedCss.delete(pluginId)) this.notify();
  }

  /** Клик/действие по СВОЕМУ слоту плагина (кнопка бара, пункт меню, nav) —
   *  доставляется этому плагину напрямую событием `slot:<kind>`, вне
   *  EVENT_PERMISSIONS (это его собственный объявленный слот, отдельное
   *  событийное право не требуется). Guest ловит через Muza.Events.on. */
  notifySlot(pluginId: string, slotId: string, kind: string, payload?: unknown): void {
    const reg = this.frames.get(pluginId);
    if (!reg || reg.status !== "ready") return;
    try {
      reg.win.postMessage(makeEvent(nextMessageId("slot"), `slot:${kind}`, { slotId, ...(payload ? { payload } : {}) }), "*");
    } catch {
      /* фрейм снят */
    }
  }

  /** Широковещание события всем фреймам, у кого есть право на этот тип. */
  emit(type: string, payload: unknown): void {
    for (const reg of this.frames.values()) {
      if (reg.status !== "ready") continue;
      if (!allowedEventTypes(reg.granted).includes(type as never)) continue;
      try {
        reg.win.postMessage(makeEvent(nextMessageId("evt"), type, payload), "*");
      } catch {
        /* фрейм снят */
      }
    }
  }
}

/** Единственный экземпляр на окно приложения. */
export const pluginHost = new PluginHost();
