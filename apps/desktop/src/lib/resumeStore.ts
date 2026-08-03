/** Позиции треков для «продолжить с места остановки» (prefs.resumePosition).
 *  Карта trackId → секунды в localStorage. Запись троттлится (onTime тикает
 *  ~4 Гц — нельзя писать в localStorage на каждый тик). LRU-ограничение по
 *  числу треков, чтобы карта не росла бесконечно.
 *
 *  Плюс — отдельный указатель «последний активный трек» (saveLast/getLast):
 *  без него после релонча (краш/dev-watcher/обновление) usePlayback стартовал
 *  с очереди-заглушки, а playing по умолчанию было true — из-за этого при
 *  каждом релонче плеер-бар, Discord RPC, mediaSession/SMTC и мини-плеер
 *  выглядели так, будто трек «сам заиграл» (T2: расследование crash-репорта
 *  владельца). Указатель пишется при каждом реальном старте трека
 *  (usePlayback.startAt) и НИКОГДА не запускает воспроизведение сам по себе —
 *  только материал для «трек готов, но на паузе» при следующем запуске.
 *  getLast валидирует запись по нынешней модели — см. комментарий там. */

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

/** Записать накопленное в localStorage прямо сейчас. Вынесено из таймера,
 *  потому что зовётся ещё и на закрытии окна (см. armUnloadFlush). */
function flushNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
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
}

/** Сброс на диск при уходе страницы. Без него закрытие окна съедало до
 *  FLUSH_MS позиции: троттлинг записи нужен, чтобы не писать на каждый тик
 *  (~4 Гц), но последний интервал перед закрытием так и оставался в памяти —
 *  человек ставил паузу и закрывал приложение, а «продолжить с места»
 *  возвращало его на несколько секунд назад (аудит 2026-08-03).
 *  pagehide — единственное событие, которое WebView2 гарантированно доводит
 *  до конца при закрытии окна; visibilitychange добавлен как более ранняя и
 *  более надёжная точка (сворачивание/переключение), beforeunload — страховка
 *  на случай, когда pagehide не пришёл. Слушатели вешаются лениво, с первой
 *  же записи: модуль импортируется и там, где localStorage не нужен вовсе. */
let unloadArmed = false;
function armUnloadFlush(): void {
  if (unloadArmed || typeof window === "undefined") return;
  unloadArmed = true;
  window.addEventListener("pagehide", flushNow);
  window.addEventListener("beforeunload", flushNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
}

function scheduleFlush(): void {
  armUnloadFlush();
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
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
      if (!t || typeof t.id !== "string") return null;
      // Сохранение пишет СТАРЫЙ клиент, читает НОВЫЙ — запись обязана пройти
      // проверку по нынешней модели, а не приниматься на веру (раньше kind
      // принимался любой строкой). Установки v0.1.1 держат тут демо-треки
      // Stage 1: без этой отбраковки макет пережил бы собственное удаление и
      // всплыл бы в баре после обновления.
      if (t.kind !== "catalog" && t.kind !== "local") return null;
      if (typeof t.title !== "string" || typeof t.artist !== "string" || typeof t.duration !== "number") return null;
      return { ...t, cover: sanitizeCover(t.cover) } as PlayerTrack;
    } catch {
      return null;
    }
  },
};

/** Обложке из старой записи верим только если это абсолютный URL. Прежний
 *  fromCatalog подставлял треку без coverUrl демо-ассет, а его путь у Vite
 *  хэширован — после удаления демо такая ссылка мертва и дала бы битую
 *  картинку. Не узнали схему — честный null, ДС нарисует плейсхолдер. */
function sanitizeCover(cover: unknown): string | null {
  if (typeof cover !== "string") return null;
  return /^(https?|data|blob|asset|tauri):/.test(cover) ? cover : null;
}
