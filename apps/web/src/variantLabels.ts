import type { VariantType } from "@muza/api-client";

/** T41: человекочитаемые подписи категорий версий (сервер T36 —
 *  variant-parser.ts, 12 типов ru+en декораций тайтла). Только текст для UI
 *  карточки-группы — сам словарь распознавания живёт на сервере, здесь
 *  подписи заведомо избыточны (лучше лишний тип на подпись, чем сорваться
 *  в "undefined" на новом значении словаря). */
export const VARIANT_TYPE_LABELS: Record<VariantType, string> = {
  remix: "Ремикс",
  sped_up: "Спидап",
  slowed: "Замедленная",
  mashup: "Мэшап",
  cover: "Кавер",
  live: "Live",
  acoustic: "Acoustic",
  instrumental: "Instrumental",
  karaoke: "Караоке",
  "8d": "8D Audio",
  bass_boosted: "Бас-буст",
  tiktok: "TikTok-версия",
};

export function variantLabel(type: VariantType | null): string | null {
  return type ? (VARIANT_TYPE_LABELS[type] ?? type) : null;
}
