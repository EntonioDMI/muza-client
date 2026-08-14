/** Тайм-код «3:24» — общий для приложения и веба (Э3 веб-паритета, 2026-08-02).
 *
 *  Почему переехало сюда: полосу плеера и панель очереди рисует теперь один
 *  общий компонент, а он обязан показывать время ОДИНАКОВО в обеих программах.
 *  До переезда клиенты считали по-разному: приложение округляло (`Math.round`),
 *  веб отбрасывал дробь (`Math.floor`) — на одном и том же треке подписи
 *  расходились на секунду. Здесь оставлено поведение ПРИЛОЖЕНИЯ: оно и есть
 *  образец, с которым веб приводят «один в один».
 *
 *  ⚠️ apps/web/src/format.ts НЕ пенёк: там живёт ещё и склонение «N треков»,
 *  и свой fmtTime, которым пользуются веб-списки. Его чистка — отдельный шаг,
 *  вне зоны переезда плеера.
 *
 *  Имена источников (providerLabel/primarySourceLabel) приехали следом (волна
 *  «экраны», 2026-08-02): бейдж «откуда возьмётся звук» показывает общий экран
 *  поиска, и в вебе он обязан подписываться теми же словами. На старом месте —
 *  ре-экспорт, чтобы полтора десятка `from "../lib/format"` не получили дифф. */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";

/** "3:24" из секунд (муз. тайм-код).
 *  Не-число (метаданные ещё не пришли: `NaN`, `Infinity`) → "0:00": в вебе
 *  длительность до загрузки метаданных приходит как NaN, и без этой отсечки
 *  в баре повисало бы «NaN:NaN». Для конечных чисел поведение прежнее,
 *  приложенческое. */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
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
  // 2026-08-14: Deezer звука не даёт (он каталог метаданных), но подписывает
  // плейлисты в выдаче — имя площадки берётся отсюда же, чтобы «Deezer» на
  // карточке и «Deezer» в любом другом месте писались одинаково
  deezer: "Deezer",
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
