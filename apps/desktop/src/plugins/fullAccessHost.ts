/** Хост-реестр «полного доступа» (эпик W8, T44b): запуск app:full-access-
 *  плагинов В ХОСТ-КОНТЕКСТЕ через Rust-команду `run_full_access_plugin`
 *  (WebviewWindow::eval — WebView2 ExecuteScript, минует CSP страницы, см.
 *  apps/desktop/src-tauri/src/plugins.rs) + реестр ошибок из try/catch
 *  IIFE, который Rust оборачивает вокруг entry (репортятся сюда через
 *  window.__MUZA_FULL_ACCESS__.reportError — единственный канал из
 *  хост-realm обратно в этот модуль, т.к. код плагина исполняется В ТОМ ЖЕ
 *  окне, что и это приложение).
 *
 *  Идемпотентность: `startedIds` здесь (per-сессия, экономит лишние invoke)
 *  ДУБЛИРУЕТ маркер `window.__MUZA__[<id>]`, который ставит сам обёрнутый
 *  скрипт (plugins.rs::build_full_access_script) — тот и есть настоящая
 *  защита от двойного исполнения entry (realm нельзя выгрузить без
 *  рестарта, §5.3 дока), этот Set — просто чтобы не дёргать invoke() зря
 *  на каждый лишний рендер usePlugins.
 *
 *  См. docs/notes/2026-07-13-плагины-архитектура.md §5.2-5.3. */

import { invoke, isTauri } from "@tauri-apps/api/core";

export interface FullAccessError {
  pluginId: string;
  message: string;
  at: number;
}

const MAX_ERRORS = 50;

declare global {
  interface Window {
    __MUZA_FULL_ACCESS__?: {
      reportError: (pluginId: string, message: string) => void;
    };
  }
}

class FullAccessHost {
  private startedIds = new Set<string>();
  private errors: FullAccessError[] = [];
  private listeners = new Set<() => void>();
  private version = 0;

  /** Регистрирует window.__MUZA_FULL_ACCESS__.reportError — вызывается один
   *  раз при загрузке модуля (см. низ файла), т.е. синхронно при импорте,
   *  задолго до первого run(): любой плагин, запущенный позже, застаёт канал
   *  уже готовым. */
  install(): void {
    window.__MUZA_FULL_ACCESS__ = {
      reportError: (pluginId, message) => this.reportError(pluginId, message),
    };
  }

  private reportError(pluginId: string, message: string): void {
    this.errors = [{ pluginId, message, at: Date.now() }, ...this.errors].slice(0, MAX_ERRORS);
    this.notify();
  }

  getErrors(): FullAccessError[] {
    return this.errors;
  }

  clearErrors(pluginId?: string): void {
    this.errors = pluginId ? this.errors.filter((e) => e.pluginId !== pluginId) : [];
    this.notify();
  }

  /** Запускает full-access-плагин в хост-контексте — один раз за жизнь окна
   *  на id (см. class-doc). Вызывается usePlugins для каждого установленного
   *  и ВКЛЮЧЁННОГО full-access-плагина: и при старте приложения (первый
   *  список installed.json на маунте App), и при включении (тот же список
   *  меняется после togglePlugin) — единый путь для обоих случаев из §5.2
   *  дока, разделять их не пришлось. Ошибка invoke (напр. Rust отказал без
   *  granted) репортится в тот же реестр, что и ошибка внутри entry — единая
   *  витрина проблем в Settings. */
  async run(pluginId: string): Promise<void> {
    if (!isTauri()) return;
    if (this.startedIds.has(pluginId)) return;
    this.startedIds.add(pluginId);
    try {
      await invoke("run_full_access_plugin", { id: pluginId });
    } catch (e) {
      this.reportError(pluginId, e instanceof Error ? e.message : String(e));
    }
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
}

/** Единственный экземпляр на окно приложения (как pluginHost). */
export const fullAccessHost = new FullAccessHost();
fullAccessHost.install();
