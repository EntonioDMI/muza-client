/** JS-мост к Rust-движку добычи (Stage 3, src-tauri/src/engine.rs).
 *  В браузере (vite без Tauri) движка нет — engineAvailable() возвращает false,
 *  UI честно говорит «только в приложении». */

import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type { MuzaApi, TrackSource } from "@muza/api-client";
import { localResolve } from "./localFiles";

export function engineAvailable(): boolean {
  return isTauri();
}

/** Подтянуть горячий рецепт с сервера и применить (Rust проверяет Ed25519).
 *  Любой сбой не фатален: движок живёт на оффлайн-кэше или bundled-дефолте. */
export async function applyRecipe(api: MuzaApi): Promise<void> {
  if (!isTauri()) return;
  try {
    const envelope = await api.getRecipe();
    // stringify распарсенного объекта побайтово равен подписанному JSON сервера
    // (порядок ключей сохраняется, числа канонические)
    await invoke("recipe_apply", {
      recipeJson: JSON.stringify(envelope.recipe),
      sigB64: envelope.sig,
    });
  } catch {
    /* оффлайн или аноним — не страшно */
  }
}

export interface ResolveResult {
  /** URL для <audio> (asset-протокол поверх файла кэша). */
  url: string;
  fromCache: boolean;
  provider: string | null;
}

/** Качество добычи: auto — лестница форматов рецепта, econom — движок ставит
 *  низкобитрейтные форматы в голову лестницы (меньше трафика/диска). Кэш
 *  ключуется track_id: уже добытый HQ-файл играет и в эконом-режиме. */
export type StreamQuality = "auto" | "econom";

/** Минимальная типизированная форма, которой renderer может снабдить нативный
 * движок. YouTube URL всегда строит Rust; URL остальных разрешённых
 * провайдеров проходит строгую каноническую проверку на нативной границе. */
export type NativeSourceRef =
  | { provider: "youtube"; sourceId: string }
  | {
      provider: "soundcloud" | "bandcamp";
      sourceId: string;
      canonicalUrl: string;
    };

/** Отбрасывает local/неизвестные источники и не переносит произвольные поля
 * TrackSource через IPC. Порядок сервера сохраняется как порядок попыток. */
export function toNativeSourceRefs(sources: readonly TrackSource[]): NativeSourceRef[] {
  return sources.flatMap<NativeSourceRef>((source) => {
    if (source.provider === "youtube") {
      return [{ provider: "youtube", sourceId: source.sourceId }];
    }
    if (source.provider === "soundcloud" || source.provider === "bandcamp") {
      return [
        {
          provider: source.provider,
          sourceId: source.sourceId,
          canonicalUrl: source.url,
        },
      ];
    }
    return [];
  });
}

/** Добыть трек: LRU-кэш → yt-dlp по лестнице «источники × клиенты рецепта».
 *  sources — с сервера (getTrackSources), уже по убыванию priority. */
export async function resolveTrack(
  trackId: string,
  sources: TrackSource[],
  quality: StreamQuality = "auto",
): Promise<ResolveResult> {
  const out = await invoke<{ path: string; from_cache: boolean; provider: string | null }>(
    "engine_resolve",
    {
      trackId,
      sources: toNativeSourceRefs(sources),
      quality,
    },
  );
  return { url: convertFileSrc(out.path), fromCache: out.from_cache, provider: out.provider };
}

/** Резолв с учётом локальных источников (Stage 4): source provider=local —
 *  это файл на устройстве (sourceId = sha256), в yt-dlp ему нельзя.
 *  Локальный, стоящий первым (выбор пользователя или единственный источник),
 *  пробуем с диска; нет файла и есть стриминговые — падаем на них. */
export async function resolvePlayable(
  trackId: string,
  sources: TrackSource[],
  quality: StreamQuality = "auto",
): Promise<ResolveResult> {
  const locals = sources.filter((s) => s.provider === "local");
  const remotes = sources.filter((s) => s.provider !== "local");
  if (locals.length > 0 && (sources[0]?.provider === "local" || remotes.length === 0)) {
    const path = await localResolve(locals[0].sourceId);
    if (path) return { url: convertFileSrc(path), fromCache: true, provider: "local" };
    if (remotes.length === 0) {
      throw new Error("Локальный трек: файла нет на этом устройстве");
    }
  }
  // пустая лестница тоже осмысленна: Rust сперва смотрит кэш добычи (оффлайн)
  return resolveTrack(trackId, remotes, quality);
}

export interface CacheStats {
  bytes: number;
  files: number;
  limitBytes: number;
  /** Из них закреплено оффлайн (Stage 4). */
  pinnedBytes: number;
  pinnedFiles: number;
}

export async function cacheStats(): Promise<CacheStats> {
  const out = await invoke<{
    bytes: number;
    files: number;
    limit_bytes: number;
    pinned_bytes: number;
    pinned_files: number;
  }>("engine_cache_stats");
  return {
    bytes: out.bytes,
    files: out.files,
    limitBytes: out.limit_bytes,
    pinnedBytes: out.pinned_bytes,
    pinnedFiles: out.pinned_files,
  };
}

// ── Оффлайн-пины (Stage 4) ──────────────────────────────────────────

/** Закрепить/открепить трек оффлайн (файл кэша перестаёт эвиктиться). */
export async function enginePin(trackId: string, pinned: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("engine_pin", { trackId, pinned });
}

export interface PinInfo {
  track_id: string;
  cached: boolean;
}

/** Все оффлайн-пины со статусом «уже скачан». */
export async function enginePins(): Promise<PinInfo[]> {
  if (!isTauri()) return [];
  return invoke<PinInfo[]>("engine_pins");
}

export async function cacheClear(): Promise<void> {
  await invoke("engine_cache_clear");
}

/** Выбить один трек из кэша: пользователь выбрал другую версию —
 *  следующий play обязан добыть заново, а не отдать старый файл. */
export async function cacheRemove(trackId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("engine_cache_remove", { trackId });
}

/** Лимит кэша из Prefs (звать на старте и при движении слайдера). */
export async function setCacheLimit(gb: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("engine_set_cache_limit", { gb });
}

/** Счётчики добычи для анонимной аналитики: снять и обнулить. */
export interface EngineStats {
  resolve_ok: number;
  resolve_fail: number;
  attempts: number;
  cache_hits: number;
  fail_403: number;
  fail_bot: number;
  fail_format: number;
  fail_other: number;
}

export async function engineStatsTake(): Promise<EngineStats> {
  return invoke<EngineStats>("engine_stats_take");
}

export interface EngineDoctor {
  ytdlp: string | null;
  deno: string | null;
}

/** Диагностика окружения добычи (вкладка «Система»). */
export async function engineDoctor(): Promise<EngineDoctor> {
  return invoke<EngineDoctor>("engine_doctor");
}
