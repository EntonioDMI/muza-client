import { DEFAULT_LANG, translate, type Lang } from "../i18n";

/** "3:24" из секунд (муз. тайм-код). */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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
