/** Локальные файлы (Stage 4): JS-мост к Rust-реестру (src-tauri/src/local.rs).
 *  Файлы device-bound: на сервер уходят только теги + sha256 (идентичность
 *  файла между устройствами), байты остаются на диске пользователя.
 *  serverId локального трека помним в localStorage — чтобы играть его через
 *  общий каталожный путь и класть в синхронизируемые плейлисты. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { MuzaApi, Track } from "@muza/api-client";
import { DEFAULT_LANG, translate, type Lang } from "../i18n";

export interface LocalEntry {
  hash: string;
  path: string;
  artist: string;
  title: string;
  duration_sec: number;
  available: boolean;
}

/** Итог скана: не только удачи. Зеркало LocalScanOut из src-tauri/src/local.rs
 *  и LocalScanResult из @muza/app — три файла обязаны совпадать по полям. */
export interface LocalScanResult {
  entries: LocalEntry[];
  /** Файлов нашёл обход (до чтения тегов); больше entries.length = столько-то
   *  не открылись как аудио. */
  found: number;
  /** Обход упёрся в потолок — показанное не всё. */
  truncated: boolean;
}

/** Расширения для фильтра системного диалога.
 *
 *  ⚠️ ЗЕРКАЛО AUDIO_EXT из src-tauri/src/local.rs, а тот — зеркало фич
 *  symphonia в Cargo.toml. Разошлись — диалог покажет файл, который сканер
 *  потом отбросит (или того хуже: примет, а движок не сыграет). До 12.08 здесь
 *  стояли wma и ape, которых движок не декодирует вовсе. */
const AUDIO_EXTENSIONS = [
  "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "aiff", "aif", "webm", "mka",
];

const SERVER_IDS_KEY = "muza.localServerIds.v1";

/** hash → серверный track_id (заполняется при регистрации на сервере). */
export function loadServerIds(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SERVER_IDS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Запомнить серверный id файла. Экспортирован ради вилки площадки
 *  (src/platform/desktopAdapter.ts → порт localFiles): общий экран медиатеки
 *  регистрирует выбранные файлы сам, а КЛЮЧ хранилища обязан остаться в одном
 *  месте — иначе карта разъедется с loadServerIds. */
export function saveServerId(hash: string, trackId: string) {
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
export async function localScanPaths(paths: string[]): Promise<LocalScanResult> {
  if (paths.length === 0) return { entries: [], found: 0, truncated: false };
  return invoke<LocalScanResult>("local_scan", { paths });
}

/** Диалог выбора аудиофайлов/папки → скан (теги, хэш, реестр, asset-scope).
 *  null — пользователь передумал. `lang` — язык подписей диалога
 *  (потребитель, views/LibraryView.tsx, вне зоны этой правки — без lang
 *  дефолт EN, было RU). */
export async function localPickAndScan(kind: "files" | "folder", lang: Lang = DEFAULT_LANG): Promise<LocalScanResult | null> {
  const picked = await open(
    kind === "files"
      ? {
          multiple: true,
          title: translate(lang, "media.localFiles.pickFilesTitle"),
          filters: [{ name: translate(lang, "media.localFiles.audioFilterName"), extensions: AUDIO_EXTENSIONS }],
        }
      : { directory: true, title: translate(lang, "media.localFiles.pickFolderTitle") },
  );
  if (!picked) return null;
  const paths = Array.isArray(picked) ? picked : [picked];
  if (paths.length === 0) return null;
  return invoke<LocalScanResult>("local_scan", { paths });
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
