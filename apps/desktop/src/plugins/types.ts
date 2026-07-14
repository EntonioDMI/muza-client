/** Общие типы рантайма плагинов уровня 1 (эпик W8, T44). PluginBridge —
 *  адаптер приложения: App.tsx реализует его поверх usePlayback/api-client/
 *  локальных функций, host.ts дальше не знает о React — только зовёт методы
 *  бриджа. См. docs/notes/2026-07-13-плагины-архитектура.md §3. */

import type { PluginManifest, PluginPermission } from "@muza/core";
import type { PlayerTrack } from "../player/types";

export type { PluginManifest, PluginPermission };

/** Запись installed.json с Rust-стороны (plugins.rs::InstalledPlugin,
 *  camelCase на границе invoke). */
export interface InstalledPluginInfo {
  id: string;
  version: string;
  enabled: boolean;
  manifest: PluginManifest;
  granted: PluginPermission[];
  grantedAt: string;
  css?: string | null;
}

/** Статус реалма (фрейма) плагина; актуален только для enabled — выключенный
 *  вообще не монтируется. */
export type PluginRuntimeStatus = "loading" | "ready" | "crashed";

export interface PluginRuntimeInfo {
  status: PluginRuntimeStatus;
  /** UI.setBarButtonState — переопределения иконки/активности по slotId. */
  barButtonState: Record<string, { icon?: string; active?: boolean }>;
  /** UI.setBadge — текст бейджа по slotId. */
  badges: Record<string, string>;
}

export interface PlayerStateSnapshot {
  state: "idle" | "loading" | "playing" | "paused";
  position: number;
  volume: number;
  queue: PlayerTrack[];
}

export interface LibraryPlaylistInfo {
  id: string;
  name: string;
}

/** Адаптер приложения → рантайм плагинов. */
export interface PluginBridge {
  player: {
    getState(): PlayerStateSnapshot;
    getCurrentTrack(): PlayerTrack | null;
    getQueue(): PlayerTrack[];
    play(): void;
    pause(): void;
    next(): void;
    prev(): void;
    seek(sec: number): void;
    setVolume(v: number): void;
    setRate(r: number): void;
    enqueue(tracks: PlayerTrack[], pos?: number): void;
    removeFromQueueAt(pos: number): void;
    reorderQueue(from: number, to: number): void;
    clearQueue(): void;
    playTrack(track: PlayerTrack): void;
  };
  library: {
    getPlaylists(): Promise<LibraryPlaylistInfo[]>;
    getPlaylistTracks(id: string): Promise<PlayerTrack[]>;
    getFavorites(): Promise<PlayerTrack[]>;
    createPlaylist(name: string): Promise<LibraryPlaylistInfo>;
    addToPlaylist(id: string, trackIds: string[]): Promise<void>;
    removeFromPlaylist(id: string, trackIds: string[]): Promise<void>;
    like(trackId: string): Promise<void>;
    unlike(trackId: string): Promise<void>;
  };
  ui: {
    toast(text: string, kind?: string): void;
    openTab(pluginId: string, tabId: string): void;
    openPanel(pluginId: string): void;
    openOverlay(pluginId: string): void;
    closeSurface(): void;
  };
  /** id (каталожный) → трек; null — не нашёлся/недоступно (аноним/офлайн). */
  resolveTrack(id: string): Promise<PlayerTrack | null>;
}

/** Управление рантайм-состоянием плагина со стороны API-обработчиков
 *  (UI.setBadge/setBarButtonState/applyCss/removeCss). Реализуется в host.ts,
 *  дёргает React-подписчиков (usePlugins). */
export interface PluginHostControls {
  setBadge(pluginId: string, slotId: string, text: string): void;
  setBarButtonState(pluginId: string, slotId: string, state: { icon?: string; active?: boolean }): void;
  applyCss(pluginId: string, css: string): void;
  removeCss(pluginId: string): void;
}

/** Контекст обработчика API-метода: бридж приложения + id плагина (для
 *  неймспейса storage/net и логов) + управление рантаймом хоста. Передаётся
 *  в каждый handler api/*.ts. */
export interface PluginApiContext {
  pluginId: string;
  bridge: PluginBridge;
  host: PluginHostControls;
}

/** Обработчик одного метода: чистая функция (args уже провалидированы Zod
 *  на уровне конверта, но не по форме — каждый handler проверяет args сам
 *  и кидает строку-причину «bad_args: ...» при неверной форме). Возврат —
 *  результат для res-конверта. Ошибка = throw строки с префиксом кода
 *  (denied:/bad_args:/quota:/internal:/not_yet:). */
export type PluginApiHandler = (ctx: PluginApiContext, args: unknown) => unknown | Promise<unknown>;

export type PluginApiModule = Record<string, PluginApiHandler>;
