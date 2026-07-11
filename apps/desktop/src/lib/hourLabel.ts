/** Подпись любимого часа прослушивания («полуночник», «ранняя пташка»…) —
 *  общая для Wrapped-слайдов и блока «Ритм дня» статистики. */

const HOURS_LABEL: Record<number, string> = {
  0: "полуночник",
  5: "ранняя пташка",
  11: "дневной ритм",
  17: "вечерний слушатель",
  22: "полуночник",
};

export function hourLabel(hour: number): string {
  const keys = Object.keys(HOURS_LABEL)
    .map(Number)
    .sort((a, b) => a - b);
  let label = HOURS_LABEL[0];
  for (const k of keys) if (hour >= k) label = HOURS_LABEL[k];
  return label;
}
