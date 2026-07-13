import type { GroupedSearchResult, Track, VariantType } from "@muza/api-client";

/** T37: человекочитаемые подписи категорий версий (сервер T36 —
 *  variant-parser.ts, 12 типов ru+en декораций тайтла). Только текст для UI
 *  карточки-группы — сам словарь распознавания живёт на сервере. Значения
 *  ЗЕРКАЛЯТ apps/web/src/variantLabels.ts (T41) — единый UX-словарь между
 *  вебом и десктопом (сравнивалось живьём, см. task-T37-report.md); дублируем
 *  вместо импорта, потому что apps/web и apps/desktop — разные приложения
 *  без общего рантайм-пакета для такой мелочи. */
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

/** Склонение «версия» под число — бейдж карточки-группы («1 версия» /
 *  «2 версии» / «5 версий»). */
export function pluralVersions(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "версий";
  const mod10 = n % 10;
  if (mod10 === 1) return "версия";
  if (mod10 >= 2 && mod10 <= 4) return "версии";
  return "версий";
}

/** Плоский список Track'ов из группированной выдачи, в порядке отображения
 *  (канон, затем варианты, затем singles) — очередь воспроизведения для
 *  "играть весь список", как в веб-аналоге (T41 GroupedTrackList). */
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

/** Лестница limit для «Загрузить ещё» в grouped-режиме (T36 сервера:
 *  group=1 поддерживает только offset=0 — «ещё» растит limit целиком
 *  пересобирая группировку, а не наращивает offset). Потолок 90 — Max()
 *  в SearchQueryDto сервера. */
export const GROUP_LIMIT_STEPS = [30, 60, 90] as const;

/** Следующая ступень лестницы; null — уже на максимуме (90, дальше некуда). */
export function nextGroupLimit(current: number): number | null {
  const idx = GROUP_LIMIT_STEPS.indexOf(current as (typeof GROUP_LIMIT_STEPS)[number]);
  if (idx === -1 || idx === GROUP_LIMIT_STEPS.length - 1) return null;
  return GROUP_LIMIT_STEPS[idx + 1];
}
