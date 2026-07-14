/** Подпись любимого часа прослушивания («полуночник», «ранняя пташка»…) —
 *  общая для Wrapped-слайдов и блока «Ритм дня» статистики.
 *
 *  i18n (эпик W5, T-media): потребители (views/WrappedOverlay.tsx,
 *  views/StatsView.tsx) вне зоны этой правки — `hourLabel` принимает
 *  опциональный `lang` (дефолт EN), готов для будущей правки потребителя. */

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
