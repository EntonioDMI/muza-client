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
  /** Остальные ключи облика, если пресет меняет не только цвет и углы.
   *  Нужен ровно «Классике»: она возвращает ГЕОМЕТРИЮ до редизайна 04.08,
   *  а не только форму углов. Пресеты без него ведут себя как раньше. */
  extra?: Partial<Prefs>;
}

/** РАСКЛАДКИ ОКНА — отдельная ось от обликов (решение владельца 04.08 ночью:
 *  «не стоило добавлять воздух и классику в тему, это совсем не подходит»).
 *  Облик — это цвет и углы; раскладка — геометрия окна. Смешивать их в одном
 *  ряду плиток было ошибкой ещё и механикой: пресет менял ЧАСТЬ геометрии, и
 *  щелчок «Классика» + тумблер плоского давали кентавра — плавающий плеер при
 *  прижатых зонах, у которого «полоска прогресса вылазит за плеер».
 *  Каждая раскладка задаёт ось ЦЕЛИКОМ — смешанных состояний не существует.
 *
 *  air — дефолт (выбор сооснователя), flat — набросок владельца («кому надо —
 *  тот включит»), classic — вид до редизайна 04.08, число в число (обещание:
 *  смена дефолта никого не грабит). */
export type WindowLayout = "air" | "flat" | "classic";

export const WINDOW_LAYOUTS: Record<WindowLayout, Partial<Prefs>> = {
  air: {
    zonesDocked: false,
    playerDocked: true,
    gapZone: 8,
    wSidebar: 240,
    hPlayerBar: 72,
    coverBarSize: 48,
    radius: "soft",
  },
  flat: {
    zonesDocked: true,
    playerDocked: true,
    gapZone: 0,
    wSidebar: 240,
    hPlayerBar: 72,
    coverBarSize: 48,
    radius: "soft",
  },
  classic: {
    zonesDocked: false,
    playerDocked: false,
    gapZone: 12,
    wSidebar: 280,
    hPlayerBar: 92,
    coverBarSize: 60,
    density: 50,
    radius: "round",
  },
};

/** Какая раскладка стоит сейчас — по двум решающим булям; остальные числа
 *  человек мог крутить сам, и это не делает раскладку «никакой». */
export function currentWindowLayout(prefs: Prefs): WindowLayout {
  if (prefs.zonesDocked) return "flat";
  return prefs.playerDocked ? "air" : "classic";
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
