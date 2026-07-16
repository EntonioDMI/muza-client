/** JS-мост к Rust-движку добычи (Stage 3, src-tauri/src/engine.rs).
 *  В браузере (vite без Tauri) движка нет — engineAvailable() возвращает false,
 *  UI честно говорит «только в приложении». */

import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { resolveApiBaseUrl, type MuzaApi, type TrackSource } from "@muza/api-client";
import { DEFAULT_LANG, translate, type Lang } from "../i18n";
import { localResolve } from "./localFiles";

export function engineAvailable(): boolean {
  return isTauri();
}

/** fnv1a-32 → 8 hex-символов. Не криптография — просто стабильный слаг. */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Неймспейс кэша добычи: хэш origin'а API-сервера. Баг «чужая песня»
 *  (2026-07-14): track_id уникален только внутри БД конкретного окружения;
 *  общий каталог по голому id отравлялся при смене dev localhost ↔ prod —
 *  клик по треку играл аудио одноимённого id из другой базы. Rust кладёт
 *  кэш и пины в audio-cache/<ns>/ (см. engine.rs::namespaced_cache_dir). */
export function cacheNamespace(): string {
  const base = resolveApiBaseUrl(
    import.meta.env.VITE_API_URL,
    import.meta.env.PROD ? "production" : "development",
    import.meta.env.DEV ? "http://localhost:8000/api" : undefined,
  );
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    origin = base;
  }
  return fnv1a32(origin);
}
const CACHE_NS = cacheNamespace();

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
  // Rust-команда объявлена как Result<_, String>, а Tauri реджектит Err(String)
  // ГОЛОЙ строкой, не Error. Без обёртки `e instanceof Error` у вызывающих
  // всегда false, и настоящая причина («у трека нет живых источников (youtube:
  // DNS lookup failed…)») молча заменяется на generic-тост — из-за этого баг
  // 2026-07-15 пришлось расследовать вслепую. Оборачиваем на границе IPC.
  const out = await invoke<{ path: string; from_cache: boolean; provider: string | null }>(
    "engine_resolve",
    {
      trackId,
      sources: toNativeSourceRefs(sources),
      quality,
      cacheNs: CACHE_NS,
    },
  ).catch((e: unknown) => {
    throw e instanceof Error ? e : new Error(typeof e === "string" ? e : String(e));
  });
  return { url: convertFileSrc(out.path), fromCache: out.from_cache, provider: out.provider };
}

export interface WarmResult {
  /** Живая warm-запись есть (уже была или только что добыта). */
  warm: boolean;
  /** Файл уже в кэше добычи — греть нечего. */
  cached: boolean;
}

/** Прогреть резолв трека (Фаза 1, спека 2026-07-16): yt-dlp --simulate
 *  разрешает метаданные (прямой CDN-URL + размер) за 0 байт трафика; клик по
 *  прогретому треку скачает файл одним GET вместо полного процесса yt-dlp
 *  (~4.5с → ~1.2с). Ошибка прогрева не фатальна по определению — трек
 *  добудется обычной лестницей; вызывающий (useWarmer) её глотает в кулдаун. */
export async function engineWarm(
  trackId: string,
  sources: TrackSource[],
  quality: StreamQuality = "auto",
): Promise<WarmResult> {
  const out = await invoke<{ warm: boolean; cached: boolean }>("engine_warm", {
    trackId,
    sources: toNativeSourceRefs(sources),
    quality,
    cacheNs: CACHE_NS,
  }).catch((e: unknown) => {
    // та же граница IPC, что у resolveTrack: Tauri реджектит голой строкой
    throw e instanceof Error ? e : new Error(typeof e === "string" ? e : String(e));
  });
  return out;
}

/** Резолв с учётом локальных источников (Stage 4): source provider=local —
 *  это файл на устройстве (sourceId = sha256), в yt-dlp ему нельзя.
 *  Локальный, стоящий первым (выбор пользователя или единственный источник),
 *  пробуем с диска; нет файла и есть стриминговые — падаем на них. */
export async function resolvePlayable(
  trackId: string,
  sources: TrackSource[],
  quality: StreamQuality = "auto",
  /** Язык тоста-ошибки (usePlayback.ts передаёт prefs.language); без него —
   *  EN (DEFAULT_LANG), см. шапку en.media.ts про non-React потребителей. */
  lang: Lang = DEFAULT_LANG,
): Promise<ResolveResult> {
  const locals = sources.filter((s) => s.provider === "local");
  const remotes = sources.filter((s) => s.provider !== "local");
  if (locals.length > 0 && (sources[0]?.provider === "local" || remotes.length === 0)) {
    const path = await localResolve(locals[0].sourceId);
    if (path) return { url: convertFileSrc(path), fromCache: true, provider: "local" };
    if (remotes.length === 0) {
      throw new Error(translate(lang, "media.engine.errors.localTrackMissing"));
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
  }>("engine_cache_stats", { cacheNs: CACHE_NS });
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
  await invoke("engine_pin", { trackId, pinned, cacheNs: CACHE_NS });
}

export interface PinInfo {
  track_id: string;
  cached: boolean;
}

/** Все оффлайн-пины со статусом «уже скачан». */
export async function enginePins(): Promise<PinInfo[]> {
  if (!isTauri()) return [];
  return invoke<PinInfo[]>("engine_pins", { cacheNs: CACHE_NS });
}

export async function cacheClear(): Promise<void> {
  await invoke("engine_cache_clear", { cacheNs: CACHE_NS });
}

/** Выбить один трек из кэша: пользователь выбрал другую версию —
 *  следующий play обязан добыть заново, а не отдать старый файл. */
export async function cacheRemove(trackId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("engine_cache_remove", { trackId, cacheNs: CACHE_NS });
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
