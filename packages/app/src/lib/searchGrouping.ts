import type { GroupedSearchResult, Track, VariantType } from "@muza/api-client";
import { DEFAULT_LANG, translate, type Lang, type TranslationKey } from "../i18n";

/** T37: человекочитаемые подписи категорий версий (сервер T36 —
 *  variant-parser.ts, 12 типов ru+en декораций тайтла). Только текст для UI
 *  карточки-группы — сам словарь распознавания живёт на сервере.
 *
 *  До 2026-08-02 у веба была своя копия этих подписей (apps/web/src/
 *  variantLabels.ts, T41), которую держали «зеркалом» вручную — потому что
 *  общего рантайм-пакета для такой мелочи не было. Теперь он есть, копия
 *  удалена, зеркалить нечего.
 *
 *  i18n (эпик W5, T-media): подписи переехали в i18n/{en,ru}.media.ts под
 *  `media.search.variants.*` (ключи буквально повторяют VariantType, включая
 *  snake_case и "8d"). Потребитель (views/SearchGroupCard.tsx) вне зоны этой
 *  правки — variantLabel/pluralVersions принимают опциональный `lang`
 *  (дефолт EN), готовые для будущей правки потребителя.
 *
 *  ⚠️ ПЕРЕЕХАЛО В @muza/app (волна «экраны» веб-паритета, 2026-08-02) вместе
 *  с экраном поиска: теперь один и тот же поиск рисуют оба клиента. На старом
 *  месте (apps/desktop/src/lib/searchGrouping.ts) — пенёк-ре-экспорт. */
export function variantLabel(type: VariantType | null, lang: Lang = DEFAULT_LANG): string | null {
  return type ? translate(lang, `media.search.variants.${type}` as TranslationKey) : null;
}

/** Склонение «версия» под число — бейдж карточки-группы («1 версия» /
 *  «2 версии» / «5 версий»; EN — простое singular/plural). */
export function pluralVersions(n: number, lang: Lang = DEFAULT_LANG): string {
  if (lang !== "ru") return translate(lang, n === 1 ? "media.search.versions.one" : "media.search.versions.many");
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return translate(lang, "media.search.versions.many");
  const mod10 = n % 10;
  if (mod10 === 1) return translate(lang, "media.search.versions.one");
  if (mod10 >= 2 && mod10 <= 4) return translate(lang, "media.search.versions.few");
  return translate(lang, "media.search.versions.many");
}

/** Плоский список Track'ов из группированной выдачи, в порядке отображения
 *  (канон, затем варианты, затем singles) — очередь воспроизведения для
 *  «играть весь список». */
export function flattenGroupedResults(results: GroupedSearchResult[]): Track[] {
  const list: Track[] = [];
  for (const r of results) {
    if (r.kind === "single") list.push(r.track);
    else {
      list.push(r.canonical);
      for (const v of r.variants) list.push(v.track);
    }
  }
  return list;
}

/** Шаг «Загрузить ещё» в grouped-режиме (T36 сервера: group=1 поддерживает
 *  только offset=0 — «ещё» растит limit целиком, пересобирая группировку над
 *  бóльшим пулом, а не наращивает offset). */
export const GROUP_LIMIT_STEP = 30;

/** Потолок лестницы = @Max(limit) в SearchQueryDto сервера, он же дефолт
 *  SEARCH_MAX_POOL: глубже сервер всё равно клампит пул, и просить больше —
 *  значит получить 400 вместо выдачи.
 *
 *  ⚠️ Раньше потолком было 90, и лестница была жёстким списком [30, 60, 90].
 *  На широком запросе («фонк») это упирало выдачу в ~40 треков и НАВСЕГДА
 *  прятало кнопку — при том, что в источниках треков тысячи: обе youtube-ветки
 *  брали одну страницу InnerTube и не ходили за continuation-токеном (разбор и
 *  замеры — docs/notes/2026-07-15-поиск-потолок-пагинации.md). */
export const GROUP_LIMIT_MAX = 300;

/** Следующая ступень лестницы; null — дальше сервер не пустит (потолок). */
export function nextGroupLimit(current: number): number | null {
  const next = current + GROUP_LIMIT_STEP;
  return next <= GROUP_LIMIT_MAX ? next : null;
}

/** Идентичность результата в выдаче: группа — по канону, одиночка — по треку. */
function resultKey(r: GroupedSearchResult): string {
  return r.kind === "single" ? `s-${r.track.id}` : `g-${r.canonical.id}`;
}

/** Все track id, которые карточка показывает (канон + варианты | одиночка). */
function resultTrackIds(r: GroupedSearchResult): string[] {
  return r.kind === "single" ? [r.track.id] : [r.canonical.id, ...r.variants.map((v) => v.track.id)];
}

/** Стабильное слияние «Загрузить ещё»: сервер на рост limit пересобирает
 *  ранжирование/группировку над бОльшим пулом (offset всегда 0), и голая
 *  замена состояния перемешивала УЖЕ ПОКАЗАННЫЕ строки с новыми — владелец:
 *  «не понимаешь, что новое, а что старое». Правило: порядок показанного
 *  неприкосновенен, новое — строго В КОНЕЦ.
 *
 *  - карточка есть в обеих выдачах → СВЕЖИЕ данные (группа могла подрасти
 *    вариантами — это внутри карточки, список не дёргает) на СТАРОМ месте;
 *  - карточка только в prev → остаётся (пользователь её видел), кроме случая,
 *    когда её треки поглощены другой карточкой next (одиночка стала вариантом
 *    группы) — тогда убираем, чтобы трек не задвоился;
 *  - карточка только в next → в конец, во внутреннем порядке next. */
export function mergeGroupedResults(
  prev: GroupedSearchResult[],
  next: GroupedSearchResult[],
): GroupedSearchResult[] {
  const nextByKey = new Map(next.map((r) => [resultKey(r), r]));
  const nextCoverage = new Set(next.flatMap(resultTrackIds));
  const kept = new Set<string>();
  const merged: GroupedSearchResult[] = [];
  for (const p of prev) {
    const key = resultKey(p);
    const fresh = nextByKey.get(key);
    if (fresh) {
      merged.push(fresh);
      kept.add(key);
    } else if (!resultTrackIds(p).some((id) => nextCoverage.has(id))) {
      merged.push(p);
    }
  }
  for (const n of next) {
    if (!kept.has(resultKey(n))) merged.push(n);
  }
  return merged;
}

/** Куда идёт «Загрузить ещё» при настройке «Где искать» = `searchScope`.
 *
 *  Мгновенный ввод намеренно ищет по каталогу (`scope:"catalog"` — быстро, без
 *  провайдеров), и «Загрузить ещё» повторял ровно его: листал накопленный
 *  каталог и в источники за добавкой не ходил НИКОГДА. Для широкого запроса это
 *  тупик — по «фонк» каталог отдаёт 11 строк из 1968 (pg_trgm сравнивает
 *  короткий запрос с длинным search_text), прирост нулевой, кнопка исчезает.
 *  «Ещё» означает «дай ещё» — значит, идём в источники. Это by-demand: провайдеры
 *  дёргаются только по клику, живой ввод остаётся каталожным и быстрым.
 *
 *  Явный выбор «только каталог» уважаем — это настройка пользователя. */
export function loadMoreScope(searchScope: "all" | "catalog"): "catalog" | "full" {
  return searchScope === "catalog" ? "catalog" : "full";
}
