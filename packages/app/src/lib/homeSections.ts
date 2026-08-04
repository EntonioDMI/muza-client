/** Порядок полок Главной: канон и сохранённая перестановка (prefs.homeSections).
 *
 *  Заявка владельца 04.08: «на главном экране можно было бы изменить
 *  расположение — вывести вверх „В тренде“, а новые каталоги вниз… или поднять
 *  вверх все рекомендации». До этого порядок был зашит константой SECTION_RANK
 *  прямо во вью и не настраивался ничем.
 *
 *  ⚠️ ЛЕНТУ СОБИРАЕТ СЕРВЕР, И ЕЁ СОСТАВ МЕНЯЕТСЯ. Полки «Потому что ты
 *  любишь X» появляются и исчезают вместе с сигналом, а завтра сервер может
 *  прислать ключ, которого клиент вообще не знает. Поэтому сохранённый список
 *  — НЕ фильтр, а только порядок: незнакомая полка не выбрасывается, она встаёт
 *  по канону ПОСЛЕ всех переставленных. Лента, собранная целиком из незнакомых
 *  ключей, выглядит ровно как до появления настройки. */

/** Канон (решение владельца): витрины сверху, «Для тебя» списком ниже,
 *  «Потому что…» после него, всё остальное — в конец. */
const SECTION_RANK: Record<string, number> = { trending: 0, new: 1, for_you: 2 };

export function homeSectionRank(key: string): number {
  return SECTION_RANK[key] ?? (key.startsWith("because") ? 3 : 4);
}

/** Сколько ключей помним. Полки «Потому что…» именуются по артисту, и без
 *  потолка список рос бы вместе со вкусами — годами и без единого читателя. */
const MAX_SAVED = 32;

/** Сохранённое → чистый список ключей: не-строки и повторы выбрасываются,
 *  хвост за потолком отрезается. Профиль настроек переносимый (prefs/load.ts),
 *  поэтому вход не обязан быть даже массивом. */
export function normalizeHomeSections(saved: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of Array.isArray(saved) ? saved : []) {
    if (typeof key !== "string" || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_SAVED) break;
  }
  return out;
}

/** Разложить полки сервера по сохранённому порядку. Переставленные идут
 *  первыми в своём порядке, остальные — за ними по канону. Сортировка
 *  устойчивая: внутри одной ступени сохраняется порядок сервера. */
export function orderHomeSections<T extends { key: string }>(
  sections: readonly T[],
  saved: readonly string[],
): T[] {
  const pos = new Map(saved.map((key, i) => [key, i]));
  return [...sections].sort((a, b) => {
    const pa = pos.get(a.key);
    const pb = pos.get(b.key);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return homeSectionRank(a.key) - homeSectionRank(b.key);
  });
}
