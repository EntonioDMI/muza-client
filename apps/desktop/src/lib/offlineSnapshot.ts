/** Оффлайн-снапшот метаданных (Stage 4): последние удачные ответы сервера
 *  (лайки, плейлисты, их содержимое) живут в localStorage — без сети
 *  библиотека читается, а закреплённые оффлайн треки играют из кэша добычи.
 *  Это снапшот, не синхронизация: изменения оффлайн не буферизуются. */

const PREFIX = "muza.snapshot.v1:";

/** Снапшоты скопированы под конкретного пользователя: без этого смена
 *  аккаунта на одном устройстве показывала бы чужую библиотеку в оффлайне. */
let scope = "";

export function setSnapshotScope(userId: string): void {
  scope = userId;
  // ключи старого формата (без скоупа) — чужие по определению, выметаем
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX) && !key.slice(PREFIX.length).includes(":")) {
      localStorage.removeItem(key);
    }
  }
}

function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`${PREFIX}${scope}:${key}`, JSON.stringify(value));
  } catch {
    /* квота/приватный режим — снапшот просто не обновится */
  }
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${scope}:${key}`);
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
