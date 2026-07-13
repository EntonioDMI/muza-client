/** Позиции треков для «продолжить с места остановки» (prefs.resumePosition).
 *  Карта trackId → секунды в localStorage. Запись троттлится (onTime тикает
 *  ~4 Гц — нельзя писать в localStorage на каждый тик). LRU-ограничение по
 *  числу треков, чтобы карта не росла бесконечно.
 *
 *  Плюс — отдельный указатель «последний активный трек» (saveLast/getLast):
 *  без него после релонча (краш/dev-watcher/обновление) usePlayback всегда
 *  стартовал с DEMO_QUEUE, а playing по умолчанию было true — из-за этого
 *  при каждом релонче плеер-бар, Discord RPC, mediaSession/SMTC и мини-плеер
 *  выглядели так, будто трек «сам заиграл» (T2: расследование crash-репорта
 *  владельца). Указатель пишется при каждом реальном старте трека
 *  (usePlayback.startAt) и НИКОГДА не запускает воспроизведение сам по себе —
 *  только материал для «трек готов, но на паузе» при следующем запуске. */

const KEY = "muza.resume.v1";
const LAST_KEY = "muza.resume.last.v1";
const MAX_ENTRIES = 300;
const FLUSH_MS = 4000;

import type { PlayerTrack } from "../player/types";

type Store = Record<string, number>;

let cache: Store | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    cache = {};
  }
  return cache;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!dirty || !cache) return;
    dirty = false;
    let entries = Object.entries(cache);
    if (entries.length > MAX_ENTRIES) {
      // грубый LRU: держим последние MAX (порядок вставки объекта сохраняется)
      entries = entries.slice(-MAX_ENTRIES);
      cache = Object.fromEntries(entries);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* квота — не критично */
    }
  }, FLUSH_MS);
}

export const resumeStore = {
  save(id: string, sec: number): void {
    const s = load();
    // перезаписываем позицию; переставляем ключ в конец для LRU
    delete s[id];
    s[id] = Math.floor(sec);
    dirty = true;
    scheduleFlush();
  },
  get(id: string): number {
    return load()[id] ?? 0;
  },
  clear(id: string): void {
    const s = load();
    if (id in s) {
      delete s[id];
      dirty = true;
      scheduleFlush();
    }
  },
  /** Последний активный трек — «что играло» до релонча/закрытия. Пишем сразу
   *  (не троттлим — вызывается редко, только на реальную смену трека). */
  saveLast(track: PlayerTrack): void {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(track));
    } catch {
      /* квота — не критично */
    }
  },
  getLast(): PlayerTrack | null {
    try {
      const raw = localStorage.getItem(LAST_KEY);
      if (!raw) return null;
      const t = JSON.parse(raw) as Partial<PlayerTrack>;
      if (!t || typeof t.id !== "string" || typeof t.kind !== "string") return null;
      return t as PlayerTrack;
    } catch {
      return null;
    }
  },
};
