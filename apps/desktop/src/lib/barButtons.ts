/** Компоновка плеер-бара: нормализация prefs.barButtons + подписи для
 *  настроек (паттерн — statsBlocks). Порядок массива = порядок в баре.
 *  T44: плагинные кнопки живут тут же под ключами `plugin:<id>:<slot>`.
 *
 *  i18n (эпик W5, T-media): та же схема, что у NAV_ITEM_META (см.
 *  lib/navItems.ts) — потребитель (views/SettingsView.tsx) вне зоны этой
 *  правки, дефолты вычислены через `translate(DEFAULT_LANG, key)`. */

import { DEFAULT_LANG, translate, type Lang } from "../i18n";
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
  shuffle: { label: translate(DEFAULT_LANG, "media.barButtons.shuffle.label"), hint: translate(DEFAULT_LANG, "media.barButtons.shuffle.hint") },
  repeat: { label: translate(DEFAULT_LANG, "media.barButtons.repeat.label"), hint: translate(DEFAULT_LANG, "media.barButtons.repeat.hint") },
  sleep: { label: translate(DEFAULT_LANG, "media.barButtons.sleep.label"), hint: translate(DEFAULT_LANG, "media.barButtons.sleep.hint") },
  speed: { label: translate(DEFAULT_LANG, "media.barButtons.speed.label"), hint: translate(DEFAULT_LANG, "media.barButtons.speed.hint") },
  equalizer: { label: translate(DEFAULT_LANG, "media.barButtons.equalizer.label"), hint: translate(DEFAULT_LANG, "media.barButtons.equalizer.hint") },
  lyrics: { label: translate(DEFAULT_LANG, "media.barButtons.lyrics.label"), hint: translate(DEFAULT_LANG, "media.barButtons.lyrics.hint") },
  jam: { label: translate(DEFAULT_LANG, "media.barButtons.jam.label"), hint: translate(DEFAULT_LANG, "media.barButtons.jam.hint") },
  volume: { label: translate(DEFAULT_LANG, "media.barButtons.volume.label"), hint: translate(DEFAULT_LANG, "media.barButtons.volume.hint") },
  queue: { label: translate(DEFAULT_LANG, "media.barButtons.queue.label"), hint: translate(DEFAULT_LANG, "media.barButtons.queue.hint") },
  fullscreen: { label: translate(DEFAULT_LANG, "media.barButtons.fullscreen.label"), hint: translate(DEFAULT_LANG, "media.barButtons.fullscreen.hint") },
};

/** Локализованная метка/подсказка кнопки — для будущей правки потребителя
 *  (SettingsView.tsx, вне зоны этого набора файлов). */
export function barButtonLabel(key: BarButtonKey, lang: Lang): { label: string; hint: string } {
  return {
    label: translate(lang, `media.barButtons.${key}.label`),
    hint: translate(lang, `media.barButtons.${key}.hint`),
  };
}
