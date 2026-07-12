/** Локальные файлы (Stage 4): JS-мост к Rust-реестру (src-tauri/src/local.rs).
 *  Файлы device-bound: на сервер уходят только теги + sha256 (идентичность
 *  файла между устройствами), байты остаются на диске пользователя.
 *  serverId локального трека помним в localStorage — чтобы играть его через
 *  общий каталожный путь и класть в синхронизируемые плейлисты. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { MuzaApi, Track } from "@muza/api-client";

export interface LocalEntry {
  hash: string;
  path: string;
  artist: string;
  title: string;
  duration_sec: number;
  available: boolean;
}

const SERVER_IDS_KEY = "muza.localServerIds.v1";

/** hash → серверный track_id (заполняется при регистрации на сервере). */
export function loadServerIds(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SERVER_IDS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function saveServerId(hash: string, trackId: string) {
  const map = loadServerIds();
  map[hash] = trackId;
  localStorage.setItem(SERVER_IDS_KEY, JSON.stringify(map));
}

export function localAvailable(): boolean {
  return isTauri();
}

/** Реестр устройства (для вкладки «Локальные»). */
export async function localList(): Promise<LocalEntry[]> {
  if (!isTauri()) return [];
  return invoke<LocalEntry[]>("local_list");
}

/** Путь к файлу по хэшу; null — файла на этом устройстве нет. */
export async function localResolve(hash: string): Promise<string | null> {
  if (!isTauri() || !hash) return null;
  return invoke<string | null>("local_resolve", { hash });
}

export async function localForget(hash: string): Promise<void> {
  await invoke("local_forget", { hash });
}

/** Скан готового списка путей (drag-and-drop файлов/папок из проводника —
 *  та же механика, что у диалога, но без диалога). */
export async function localScanPaths(paths: string[]): Promise<LocalEntry[]> {
  if (paths.length === 0) return [];
  return invoke<LocalEntry[]>("local_scan", { paths });
}

/** Диалог выбора аудиофайлов/папки → скан (теги, хэш, реестр, asset-scope).
 *  null — пользователь передумал. */
export async function localPickAndScan(kind: "files" | "folder"): Promise<LocalEntry[] | null> {
  const picked = await open(
    kind === "files"
      ? {
          multiple: true,
          title: "Выбери аудиофайлы",
          filters: [{ name: "Аудио", extensions: ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma", "aiff", "ape", "webm"] }],
        }
      : { directory: true, title: "Выбери папку с музыкой" },
  );
  if (!picked) return null;
  const paths = Array.isArray(picked) ? picked : [picked];
  if (paths.length === 0) return null;
  return invoke<LocalEntry[]>("local_scan", { paths });
}

/** Зарегистрировать локальные записи на сервере (теги + хэш) — треки становятся
 *  частью синхронизируемой библиотеки (плейлисты/лайки). Возвращает серверные
 *  треки по хэшу; сбои отдельных файлов не валят остальные. */
export async function registerLocalTracks(
  api: MuzaApi,
  entries: LocalEntry[],
): Promise<Map<string, Track>> {
  const out = new Map<string, Track>();
  for (const entry of entries) {
    try {
      const track = await api.addLocalTrack({
        artist: entry.artist,
        title: entry.title,
        durationSec: entry.duration_sec,
        hash: entry.hash,
      });
      saveServerId(entry.hash, track.id);
      out.set(entry.hash, track);
    } catch {
      /* один файл не зарегистрировался — остальные важнее */
    }
  }
  return out;
}
