/** Компоновка плеер-бара: нормализация prefs.barButtons + подписи для
 *  настроек (паттерн — statsBlocks). Порядок массива = порядок в баре. */

import { BAR_BUTTON_KEYS, type BarButtonKey } from "../types";

export interface BarButtonPref {
  key: BarButtonKey;
  on: boolean;
}

/** Сохранённый список → полный: чужие ключи выбрасываются, отсутствующие
 *  (новые кнопки будущих версий) дописываются в конец включёнными. */
export function normalizeBarButtons(saved: BarButtonPref[]): BarButtonPref[] {
  const known = new Set<string>(BAR_BUTTON_KEYS);
  const seen = new Set<string>();
  const out: BarButtonPref[] = [];
  for (const b of saved ?? []) {
    if (!known.has(b.key) || seen.has(b.key)) continue;
    seen.add(b.key);
    out.push({ key: b.key, on: b.on });
  }
  for (const key of BAR_BUTTON_KEYS) {
    if (!seen.has(key)) out.push({ key, on: true });
  }
  return out;
}

export const BAR_BUTTON_META: Record<BarButtonKey, { label: string; hint: string }> = {
  shuffle: { label: "Перемешать", hint: "Слева от транспорта" },
  repeat: { label: "Повтор", hint: "Справа от транспорта" },
  sleep: { label: "Таймер сна", hint: "Луна: выкл → пресеты → конец трека" },
  speed: { label: "Скорость", hint: "Кнопка «1×», циклит шаги из настроек" },
  equalizer: { label: "Эквалайзер", hint: "Открывает под-экран EQ" },
  lyrics: { label: "Текст", hint: "Панель «Сейчас играет»" },
  jam: { label: "Jam", hint: "Слушать вместе" },
  volume: { label: "Громкость", hint: "Кнопка-mute и слайдер" },
  queue: { label: "Очередь", hint: "Панель очереди" },
  fullscreen: { label: "Во весь экран", hint: "Режим прослушивания" },
};
