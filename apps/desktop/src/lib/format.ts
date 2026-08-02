/** Форматирование для списков и плеера.
 *
 *  Тайм-код `fmtTime` ПЕРЕЕХАЛ в @muza/app (Э3 веб-паритета, 2026-08-02):
 *  его показывает общая полоса плеера, и время в обеих программах обязано
 *  считаться одинаково (веб считал по-своему и расходился на секунду).
 *  Здесь он ре-экспортируется, чтобы полтора десятка потребителей
 *  `from "../lib/format"` не получили дифф. Новый код берёт его из
 *  "@muza/app/lib/format".
 *
 *  Имена источников остались тут: их потребители (поиск, диалог версий,
 *  «Заменить версию») в общий пакет ещё не переезжали, а тянуть за собой
 *  словарь провайдеров без нужды незачем. */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";

export { fmtTime } from "@muza/app/lib/format";

/** Провайдер-источник → человекочитаемое имя. Единый источник истины: бейдж
 *  источника в поиске и диалог «Версии и источники» берут имена отсюда.
 *  Бренды не переводятся; «local» зависит от языка (i18n W5) — потому опц.
 *  `lang` по образцу остальных lib/*-хелперов (дефолт EN = DEFAULT_LANG). */
const PROVIDER_LABEL: Record<string, string> = {
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
};

export function providerLabel(provider: string, lang: Lang = DEFAULT_LANG): string {
  if (provider === "local") return translate(lang, "dialogs.versions.localFile");
  return PROVIDER_LABEL[provider] ?? provider;
}

/** Ярлык основного (высший приоритет) источника трека для компактного бейджа.
 *  Сервер отдаёт sources по убыванию приоритета — [0] и есть тот, что играет;
 *  пустой список → undefined (бейдж не показываем). */
export function primarySourceLabel(sources: string[], lang: Lang = DEFAULT_LANG): string | undefined {
  const primary = sources[0];
  return primary ? providerLabel(primary, lang) : undefined;
}
