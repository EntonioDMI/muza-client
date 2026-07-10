/** Системная интеграция (настройки → Система): автозапуск с Windows и трей.
 *  В браузере (vite без Tauri) — no-op: UI дизейблит переключатели. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Привести автозапуск ОС к значению prefs.autostart (идемпотентно). */
export async function syncAutostart(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    if (on === (await isEnabled())) return;
    await (on ? enable() : disable());
  } catch {
    /* реестр недоступен — настройка просто не применится */
  }
}

/** Реальное состояние автозапуска в ОС (null вне Tauri). */
export async function autostartEnabled(): Promise<boolean | null> {
  if (!isTauri()) return null;
  try {
    return await isEnabled();
  } catch {
    return null;
  }
}

/** Показ иконки трея + поведение закрытия окна (prefs.tray / prefs.closeToTray).
 *  closeToTray действует только при видимой иконке — иначе окно не вернуть. */
export async function trayConfigure(visible: boolean, closeToTray: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("tray_configure", { visible, closeToTray: visible && closeToTray }).catch(
    () => undefined,
  );
}

/** Открыть https-ссылку в системном браузере (Last.fm-авторизация и т.п.).
 *  Вне Tauri (vite в браузере) — новая вкладка. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}
