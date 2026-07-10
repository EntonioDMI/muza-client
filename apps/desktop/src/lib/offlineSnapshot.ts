/** Оффлайн-снапшот метаданных (Stage 4): последние удачные ответы сервера
 *  (лайки, плейлисты, их содержимое) живут в localStorage — без сети
 *  библиотека читается, а закреплённые оффлайн треки играют из кэша добычи.
 *  Это снапшот, не синхронизация: изменения оффлайн не буферизуются. */

const PREFIX = "muza.snapshot.v1:";

function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
  } catch {
    /* квота/приватный режим — снапшот просто не обновится */
  }
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

/** Обёртка «сервер, а если он лёг — снапшот»: удачный ответ запоминается,
 *  сбой отдаёт последнее известное (и помечает, что это оффлайн-данные). */
export async function withSnapshot<T>(
  key: string,
  request: () => Promise<T>,
): Promise<{ data: T; offline: boolean }> {
  try {
    const data = await request();
    save(key, data);
    return { data, offline: false };
  } catch (e) {
    const cached = load<T>(key);
    if (cached !== null) return { data: cached, offline: true };
    throw e;
  }
}
