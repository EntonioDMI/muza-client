/**
 * @muza/core — манифест генеративных иконок плейлистов (T47).
 * Единый источник истины для десктопа и веба: 38 иконок pi-01..pi-38,
 * ассеты лежат в public/playlist-icons/pi-XX.png обоих клиентов
 * (одинаковый путь, поэтому playlistIconUrl не параметризуется по клиенту).
 */

/** Ширина нумерации id — "pi-01".."pi-38", 2 цифры с ведущим нулём.
 *  Должна совпадать с серверным паттерном PLAYLIST_ICON_RE (muza-server/src/me/dto.ts). */
const ICON_COUNT = 38;

function iconId(n: number): string {
  return `pi-${String(n).padStart(2, "0")}`;
}

/** Все 38 id по порядку: "pi-01", "pi-02", …, "pi-38". */
export const PLAYLIST_ICON_IDS: readonly string[] = Array.from({ length: ICON_COUNT }, (_, i) => iconId(i + 1));

/** Публичный путь к файлу иконки — одинаков в обоих клиентах
 *  (apps/desktop/public/playlist-icons/ и apps/web/public/playlist-icons/). */
export function playlistIconUrl(id: string): string {
  return `/playlist-icons/${id}.png`;
}

/** Случайная иконка, по возможности не повторяющая уже занятые (usedIds) —
 *  чтобы новосозданные плейлисты пользователя визуально не сливались.
 *  Если все 38 заняты (или usedIds покрывает весь манифест) — случайная
 *  иконка без ограничения (лучше повтор, чем ошибка/пустая иконка).
 *  rng — инъекция для детерминированных тестов (по умолчанию Math.random). */
export function pickRandomPlaylistIcon(usedIds: readonly string[], rng: () => number = Math.random): string {
  const used = new Set(usedIds);
  const available = PLAYLIST_ICON_IDS.filter((id) => !used.has(id));
  const pool = available.length > 0 ? available : PLAYLIST_ICON_IDS;
  const idx = Math.floor(rng() * pool.length);
  // rng() почти никогда не даёт ровно 1, но клэмп на всякий случай (иначе
  // индекс == pool.length вылетит за границы массива)
  return pool[Math.min(idx, pool.length - 1)];
}
