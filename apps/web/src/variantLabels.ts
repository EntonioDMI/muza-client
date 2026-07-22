import type { VariantType } from "@muza/api-client";
import { DEFAULT_LANG, translate, type Lang, type TranslationKey } from "@muza/app";

/** T41: человекочитаемые подписи категорий версий (сервер T36 —
 *  variant-parser.ts, 12 типов ru+en декораций тайтла). Только текст для UI
 *  карточки-группы — сам словарь распознавания живёт на сервере.
 *
 *  И5-веб (2026-07-22): подписи переехали в общий словарь `@muza/app` —
 *  `media.search.variants.*` (ключи буквально повторяют VariantType, включая
 *  snake_case и "8d"). Функции — точное зеркало
 *  `apps/desktop/src/lib/searchGrouping.ts::variantLabel/pluralVersions`
 *  (дублируем логику, а не импортируем: apps/web и apps/desktop — разные
 *  приложения без общего рантайм-пакета для такой мелочи). */
export function variantLabel(type: VariantType | null, lang: Lang = DEFAULT_LANG): string | null {
  return type ? translate(lang, `media.search.variants.${type}` as TranslationKey) : null;
}

/** Склонение «версия» под число («1 версия» / «2 версии» / «5 версий»; EN —
 *  простое singular/plural), см. media.search.versions.{one,few,many}. */
export function pluralVersions(n: number, lang: Lang = DEFAULT_LANG): string {
  if (lang !== "ru") return translate(lang, n === 1 ? "media.search.versions.one" : "media.search.versions.many");
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return translate(lang, "media.search.versions.many");
  const mod10 = n % 10;
  if (mod10 === 1) return translate(lang, "media.search.versions.one");
  if (mod10 >= 2 && mod10 <= 4) return translate(lang, "media.search.versions.few");
  return translate(lang, "media.search.versions.many");
}
