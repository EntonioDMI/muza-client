/** Захват ошибок, которые пользователи не репортят (админ-панель, кусок A):
 *  window.onerror + unhandledrejection + ErrorBoundary складывают в буфер с
 *  дедупом по stackHash; useErrorTelemetry шлёт батч раз в 10 минут под тем же
 *  согласием prefs.telemetry, что и обычная телеметрия. Стек НЕ уходит с
 *  клиента — только его хэш: сервер группирует одинаковые падения, не видя
 *  ни путей, ни кода (инвариант анонимности telemetry_stats/client_errors). */

export type ClientErrorKind = "error" | "unhandledrejection" | "react";

export interface ClientErrorItem {
  kind: ClientErrorKind;
  message: string;
  stackHash: string;
  count: number;
}

const MAX_MESSAGE = 2000; // потолок приёма ClientErrorsDto на сервере
const MAX_DISTINCT = 50; // разных ошибок в буфере; первые ценнее хвоста
const MAX_BATCH = 20; // ArrayMaxSize серверного DTO

/** FNV-1a 64 бита: детерминированный хэш без node:crypto — работает в webview. */
export function stackHashOf(message: string, stack = ""): string {
  let h = 0xcbf29ce484222325n;
  const s = `${message}\n${stack}`;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export interface ErrorReporter {
  /** Слушатели error/unhandledrejection; возвращает снятие. */
  install(target: Window): () => void;
  capture(kind: ClientErrorKind, message: string, stack?: string): void;
  /** Падение рендера (ErrorBoundary): buffered + немедленный флаш через onUrgent —
   *  юзер сейчас закроет приложение, следующего 10-минутного окна не будет. */
  reportReactError(error: unknown): void;
  onUrgent(cb: (() => void) | null): void;
  /** Дренаж до max записей; остаток ждёт следующего окна. */
  take(max?: number): ClientErrorItem[];
  clear(): void;
  size(): number;
}

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message || String(reason), stack: reason.stack };
  return { message: String(reason) };
}

export function createErrorReporter(opts: { maxDistinct?: number } = {}): ErrorReporter {
  const maxDistinct = opts.maxDistinct ?? MAX_DISTINCT;
  const buffer = new Map<string, ClientErrorItem>();
  let urgent: (() => void) | null = null;

  const capture = (kind: ClientErrorKind, message: string, stack?: string): void => {
    const msg = String(message ?? "").slice(0, MAX_MESSAGE);
    const key = stackHashOf(msg, stack ?? "");
    const known = buffer.get(key);
    if (known) {
      known.count += 1;
      return;
    }
    if (buffer.size >= maxDistinct) return;
    buffer.set(key, { kind, message: msg, stackHash: key, count: 1 });
  };

  return {
    install(target) {
      const onError = (ev: ErrorEvent) => capture("error", ev.message, (ev.error as Error | undefined)?.stack);
      const onRejection = (ev: Event) => {
        const { message, stack } = describe((ev as PromiseRejectionEvent).reason);
        capture("unhandledrejection", message, stack);
      };
      target.addEventListener("error", onError);
      target.addEventListener("unhandledrejection", onRejection);
      return () => {
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
      };
    },
    capture,
    reportReactError(error) {
      const { message, stack } = describe(error);
      capture("react", message, stack);
      urgent?.();
    },
    onUrgent(cb) {
      urgent = cb;
    },
    take(max = MAX_BATCH) {
      const out: ClientErrorItem[] = [];
      for (const [key, item] of buffer) {
        if (out.length >= max) break;
        out.push(item);
        buffer.delete(key);
      }
      return out;
    },
    clear() {
      buffer.clear();
    },
    size() {
      return buffer.size;
    },
  };
}

/** Синглтон приложения: main.tsx ставит слушатели ДО рендера — падение на
 *  старте тоже попадает в буфер и уйдёт, когда App поднимет useErrorTelemetry. */
export const errorReporter = createErrorReporter();
