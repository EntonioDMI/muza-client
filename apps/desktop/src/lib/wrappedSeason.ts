/** Сезон Wrapped «Итоги года»: баннер на главной живёт с 1 декабря
 *  (итоги текущего года) по 31 января (итоги прошлого). Вне сезона
 *  вход остаётся на странице статистики. */

/** true — баннер виден всегда (владелец смотрит результат в разработке).
 *  Перед релизом флипнуть в false — останется сезонное поведение. */
export const WRAPPED_BANNER_PREVIEW = true;

export function wrappedSeason(now = new Date()): { inSeason: boolean; year: number } {
  const month = now.getMonth();
  if (month === 11) return { inSeason: true, year: now.getFullYear() };
  if (month === 0) return { inSeason: true, year: now.getFullYear() - 1 };
  return { inSeason: false, year: now.getFullYear() };
}
