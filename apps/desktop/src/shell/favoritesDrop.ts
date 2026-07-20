/** Решение при броске трека на «Любимое» (2026-07-20, жалоба владельца).
 *
 *  Отдельно от toggleLike намеренно: тот ПЕРЕКЛЮЧАЕТ, а перенос — жест
 *  «положить сюда». Бросок уже любимого трека обязан быть безобидным, иначе
 *  трек исчезал бы из «Любимого» ровно тем движением, которым его туда кладут.
 */
export function favoritesDropAction(trackId: string, likes: readonly string[]): "add" | "already" {
  return likes.includes(trackId) ? "already" : "add";
}
