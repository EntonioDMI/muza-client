/** Три готовых облика («Муза», «Пламя», «Графит») и текущий цвет акцента.
 *
 *  Живёт отдельным файлом, потому что этим пользуются ДВА экрана: плитки
 *  облика рисует раздел «Внешний вид», а тем же цветом акцента под-экран
 *  «Кастомизация» засевает роли акцента при их включении. Две копии этих
 *  шести чисел разъехались бы на первой же смене фирменного синего. */

import type { Prefs } from "../../prefs/types";
import type { TranslationKey, TParams } from "../../i18n";

/** Функция перевода — та же, что отдаёт useT().t. */
type T = (key: TranslationKey, params?: TParams) => string;

export interface AppearancePreset {
  key: string;
  name: string;
  hint: string;
  accent: Prefs["accent"];
  accentColor: string;
  /** Те же три значения, что у настройки «Углы». */
  radius: "mild" | "soft" | "round";
}

export function appearancePresets(t: T): AppearancePreset[] {
  return [
    {
      key: "muza",
      name: t("settings.appearance.presets.muza.name"),
      hint: t("settings.appearance.presets.muza.hint"),
      accent: "blue",
      accentColor: "#3b82f6",
      radius: "soft",
    },
    {
      key: "flame",
      name: t("settings.appearance.presets.flame.name"),
      hint: t("settings.appearance.presets.flame.hint"),
      accent: "red",
      accentColor: "#f76967",
      radius: "round",
    },
    {
      key: "graphite",
      name: t("settings.appearance.presets.graphite.name"),
      hint: t("settings.appearance.presets.graphite.hint"),
      accent: "bolt",
      accentColor: "#327ad9",
      radius: "mild",
    },
  ];
}

/** Текущий цвет акцента в hex: свой — как выбран, именной — из списка выше.
 *  Им сеются роли акцента при включении, чтобы ничего не мигало. */
export function currentAccentHex(prefs: Prefs, t: T): string {
  if (prefs.accent === "custom") return prefs.customAccent;
  return appearancePresets(t).find((p) => p.accent === prefs.accent)?.accentColor ?? "#3b82f6";
}
