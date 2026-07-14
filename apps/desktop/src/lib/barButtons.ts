/** Компоновка плеер-бара: нормализация prefs.barButtons + подписи для
 *  настроек (паттерн — statsBlocks). Порядок массива = порядок в баре.
 *  T44: плагинные кнопки живут тут же под ключами `plugin:<id>:<slot>`. */

import { BAR_BUTTON_KEYS, type BarButtonKey } from "../types";
import { isPluginKey } from "./pluginSlots";

/** Ключ кнопки — родной BarButtonKey либо плагинный `plugin:<id>:<slot>`. */
export type BarButtonSlotKey = BarButtonKey | string;

export interface BarButtonPref {
  key: BarButtonSlotKey;
  on: boolean;
}

/** Сохранённый список → полный: неизвестные ключи выбрасываются, отсутствующие
 *  родные (новые кнопки будущих версий) дописываются в конец включёнными.
 *  T44: `pluginKeys` — множество валидных плагинных ключей (плагин установлен
 *  и включён); плагинный ключ вне этого множества (плагин снят/выключен)
 *  выбрасывается, отсутствующий валидный плагинный — дописывается в конец. */
export function normalizeBarButtons(saved: BarButtonPref[], pluginKeys: readonly string[] = []): BarButtonPref[] {
  const knownNative = new Set<string>(BAR_BUTTON_KEYS);
  const validPlugin = new Set<string>(pluginKeys);
  const seen = new Set<string>();
  const out: BarButtonPref[] = [];
  for (const b of saved ?? []) {
    const ok = isPluginKey(b.key) ? validPlugin.has(b.key) : knownNative.has(b.key);
    if (!ok || seen.has(b.key)) continue;
    seen.add(b.key);
    out.push({ key: b.key, on: b.on });
  }
  for (const key of BAR_BUTTON_KEYS) {
    if (!seen.has(key)) out.push({ key, on: true });
  }
  for (const key of validPlugin) {
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
