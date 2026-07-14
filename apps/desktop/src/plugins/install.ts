/** Установка плагина из файла (эпик W8, T44): стейджинг (Rust) → Zod-валидация
 *  манифеста + AST/CSS-скан (@muza/core) → согласие на права (UI в SettingsView)
 *  → финализация (Rust). Плюс тонкие обёртки list/enable/uninstall над
 *  командами plugins.rs. См. §6.1 дизайн-дока. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { parsePluginManifest, type PluginManifest } from "@muza/core";
import { scanPluginCss, scanPluginScript } from "@muza/core";
import type { InstalledPluginInfo } from "./types";

interface StagedRaw {
  stagedDir: string;
  manifestJson: string;
  entryCode: string;
  cssCode: string | null;
  stringsJson: string | null;
}

/** Прошедший валидацию и скан стейджинг, готовый к согласию/финализации. */
export interface StagedPlugin {
  stagedDir: string;
  manifest: PluginManifest;
  css: string | null;
}

export async function listInstalled(): Promise<InstalledPluginInfo[]> {
  if (!isTauri()) return [];
  return invoke<InstalledPluginInfo[]>("list_installed");
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  await invoke("set_plugin_enabled", { id, enabled });
}

export async function uninstallPlugin(id: string): Promise<void> {
  await invoke("uninstall_plugin", { id });
}

async function discardStaged(stagedDir: string): Promise<void> {
  try {
    await invoke("plugin_discard_staged", { stagedDir });
  } catch {
    /* стейджинг подчистится и сам при следующем старте — не критично */
  }
}

/** Открыть диалог, распаковать пакет, провалидировать манифест и просканировать
 *  entry/css. Бросает Error с человекочитаемой причиной (стейджинг подчищается).
 *  null — пользователь отменил выбор файла. */
export async function pickAndStagePlugin(): Promise<StagedPlugin | null> {
  if (!isTauri()) throw new Error("Установка из файла доступна только в приложении");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [{ name: "Плагин Muza", extensions: ["muzaplugin", "zip"] }],
    title: "Выбери .muzaplugin",
  });
  if (!picked || Array.isArray(picked)) return null;

  const staged = await invoke<StagedRaw>("plugin_stage_from_file", { path: picked });

  const parsed = parsePluginManifest(JSON.parse(staged.manifestJson));
  if (!parsed.ok) {
    await discardStaged(staged.stagedDir);
    throw new Error(`Манифест плагина отклонён: ${parsed.error}`);
  }
  const scriptBad = scanPluginScript(staged.entryCode);
  if (scriptBad) {
    await discardStaged(staged.stagedDir);
    throw new Error(`Код плагина отклонён: ${scriptBad}`);
  }
  if (staged.cssCode) {
    const cssBad = scanPluginCss(staged.cssCode);
    if (cssBad) {
      await discardStaged(staged.stagedDir);
      throw new Error(`CSS плагина отклонён: ${cssBad}`);
    }
  }
  return { stagedDir: staged.stagedDir, manifest: parsed.manifest, css: staged.cssCode };
}

/** Финализация после согласия: перенос стейджинга в постоянную папку +
 *  запись в installed.json. granted — права, на которые согласился пользователь
 *  (T44 — весь список манифеста; принимаем явно на будущее). */
export async function finalizeInstall(staged: StagedPlugin, granted: string[]): Promise<void> {
  await invoke("plugin_finalize_install", {
    stagedDir: staged.stagedDir,
    id: staged.manifest.id,
    version: staged.manifest.version,
    manifestJson: JSON.stringify(staged.manifest),
    granted,
    css: staged.css,
  });
}

export async function cancelInstall(staged: StagedPlugin): Promise<void> {
  await discardStaged(staged.stagedDir);
}

/** Установка ИЗ ДАННЫХ (маркетплейс, T45b) — payload = { manifest, code, css?,
 *  strings? } уже скачан целиком (api.installMarketPlugin), zip не нужен:
 *  Rust plugin_stage_from_data пишет их в staged-папку тем же конвертом, что
 *  и plugin_stage_from_file, дальше — ОДИН И ТОТ ЖЕ путь валидации/согласия/
 *  финализации (see pickAndStagePlugin выше), никакого дублирования UI.
 *  Бросает Error с человекочитаемой причиной (стейджинг подчищается). */
export async function stagePluginFromMarket(payload: {
  manifest: Record<string, unknown>;
  code: string;
  css?: string | null;
  strings?: Record<string, string> | null;
}): Promise<StagedPlugin> {
  if (!isTauri()) throw new Error("Установка плагина доступна только в приложении");

  const staged = await invoke<StagedRaw>("plugin_stage_from_data", {
    manifestJson: JSON.stringify(payload.manifest),
    entryCode: payload.code,
    cssCode: payload.css ?? null,
    stringsJson: payload.strings ? JSON.stringify(payload.strings) : null,
  });

  const parsed = parsePluginManifest(JSON.parse(staged.manifestJson));
  if (!parsed.ok) {
    await discardStaged(staged.stagedDir);
    throw new Error(`Манифест плагина отклонён: ${parsed.error}`);
  }
  const scriptBad = scanPluginScript(staged.entryCode);
  if (scriptBad) {
    await discardStaged(staged.stagedDir);
    throw new Error(`Код плагина отклонён: ${scriptBad}`);
  }
  if (staged.cssCode) {
    const cssBad = scanPluginCss(staged.cssCode);
    if (cssBad) {
      await discardStaged(staged.stagedDir);
      throw new Error(`CSS плагина отклонён: ${cssBad}`);
    }
  }
  return { stagedDir: staged.stagedDir, manifest: parsed.manifest, css: staged.cssCode };
}
