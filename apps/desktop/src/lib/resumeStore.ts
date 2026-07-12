/** Позиции треков для «продолжить с места остановки» (prefs.resumePosition).
 *  Карта trackId → секунды в localStorage. Запись троттлится (onTime тикает
 *  ~4 Гц — нельзя писать в localStorage на каждый тик). LRU-ограничение по
 *  числу треков, чтобы карта не росла бесконечно. */

const KEY = "muza.resume.v1";
const MAX_ENTRIES = 300;
const FLUSH_MS = 4000;

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
};
