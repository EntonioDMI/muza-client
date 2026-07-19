/** Сезон Wrapped «Итоги года»: баннер на главной живёт с 1 декабря
 *  (итоги текущего года) по 31 января (итоги прошлого). Вне сезона
 *  вход остаётся на странице статистики. */

/** Мастер-выключатель фичи (2026-07-17, решение владельца): false — «Итоги
 *  года» полностью спрятаны (баннера нет ни сезонно, ни в превью; оверлей
 *  ничем не открывается, но весь код цел). Флипнуть в true, когда решим
 *  катить в прод — вернётся поведение по флагам ниже. */
export const WRAPPED_ENABLED = false;

/** При включённой фиче: true — баннер виден всегда (владелец смотрит результат
 *  в разработке). Перед релизом флипнуть в false — останется сезонное поведение. */
export const WRAPPED_BANNER_PREVIEW = true;

export function wrappedSeason(now = new Date()): { inSeason: boolean; year: number } {
  const month = now.getMonth();
  if (month === 11) return { inSeason: true, year: now.getFullYear() };
  if (month === 0) return { inSeason: true, year: now.getFullYear() - 1 };
  return { inSeason: false, year: now.getFullYear() };
}
