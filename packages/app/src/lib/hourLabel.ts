/** Подпись любимого часа прослушивания («полуночник», «ранняя пташка»…) —
 *  общая для Wrapped-слайдов и блока «Ритм дня» статистики.
 *
 *  `lang` необязателен (дефолт EN) — так подпись зовут и общий экран
 *  статистики (views/StatsView.tsx, оба клиента), и «Итоги года» приложения.
 *  Переехала в @muza/app 2026-08-02 вместе с экраном статистики; на старом
 *  месте (apps/desktop/src/lib/hourLabel.ts) остался пенёк-ре-экспорт. */

import { DEFAULT_LANG, translate, type Lang, type TranslationKey } from "../i18n";

const HOURS_LABEL_KEY: Record<number, TranslationKey> = {
  0: "media.hour.midnighty",
  5: "media.hour.earlyBird",
  11: "media.hour.daytime",
  17: "media.hour.eveningListener",
  22: "media.hour.midnighty",
};

export function hourLabel(hour: number, lang: Lang = DEFAULT_LANG): string {
  const keys = Object.keys(HOURS_LABEL_KEY)
    .map(Number)
    .sort((a, b) => a - b);
  let key = HOURS_LABEL_KEY[0];
  for (const k of keys) if (hour >= k) key = HOURS_LABEL_KEY[k];
  return translate(lang, key);
}
