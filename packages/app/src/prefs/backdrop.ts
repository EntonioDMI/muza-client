/** МОДЕЛЬ ФОНА: из Prefs — в то, что рисует shell/AnimatedBackdrop.
 *
 *  ЗАЧЕМ ОТДЕЛЬНЫЙ СЛОЙ (2026-08-03). Фонов стало два — за интерфейсом и в
 *  караоке, — и у них РАЗНЫЕ поля Prefs (bg* и karaokeBg*). Если бы про эту
 *  развилку знал сам компонент, он читал бы Prefs целиком и обзавёлся бы
 *  вторым набором пропов «а для караоке возьми вон те поля». Здесь развилка
 *  кончается: наружу выходит один плоский BackdropView, и рисовалка про
 *  настройки уже ничего не знает.
 *
 *  ⚠️ ВСЁ, ЧТО ВХОДИТ СЮДА, — ВРАЖДЕБНЫЙ ВВОД. Профиль переносимый (шапка
 *  prefs/load.ts), тема приезжает из буфера и с витрины, и оба фильтра сверяют
 *  ТОЛЬКО вид значения: строка `bgAnimSpin: "; drop"` и число
 *  `karaokeBgAnimScale: 1e9` проходят их насквозь. Поэтому нормализация здесь
 *  не «на всякий случай», а единственное место, где такое значение перестаёт
 *  быть опасным: чужой перекос уезжает к дефолту, а не в CSS. */

import {
  DEFAULT_PREFS,
  type BgAnimDiscs,
  type BgAnimSpin,
  type BgType,
  type Prefs,
} from "./types";

/** Где рисуется фон. Разница НЕ косметическая: подложка под интерфейсом обязана
 *  быть тише самого интерфейса (снимок приглушён до 22 %), а сцена караоке —
 *  это и есть картинка, поверх неё ложится своя затемняющая плёнка. */
export type BackdropZone = "app" | "scene";

/** Плоское описание одного фона — всё, что нужно рисовалке, и ничего больше. */
export interface BackdropView {
  zone: BackdropZone;
  type: BgType;
  color: string;
  color2: string;
  imageUrl: string;
  animSpeedSec: number;
  animOpacity: number;
  animScale: number;
  animEdge: number;
  animDiscs: BgAnimDiscs;
  animSpin: BgAnimSpin;
  /** Размытие снимка, px (prefs.blurScenery). Нужно ОДНИМ вопросом: ставить ли
   *  filter вообще. На нуле фильтр не ставится — blur(0px) не размывает, но
   *  заводит слой композитора на весь экран впустую. */
  sceneryBlurPx: number;
}

const BG_TYPES: readonly BgType[] = ["none", "cover", "color", "gradient", "image", "animated"];
const DISCS: readonly BgAnimDiscs[] = ["one", "two"];
const SPINS: readonly BgAnimSpin[] = ["inward", "outward", "cw", "ccw"];

/** Направления пары кругов: [левый, правый].
 *
 *  Геометрия «навстречу»: левый круг по часовой везёт свой ВЕРХНИЙ край вправо,
 *  правый против часовой — влево, то есть сверху они сходятся к центру. Это и
 *  был единственный вид фона до 2026-08-03. Одна обложка берёт левый элемент
 *  пары — тогда «навстречу» превращается в честное «по часовой». */
export const SPIN_PAIRS: Record<BgAnimSpin, readonly ["cw" | "ccw", "cw" | "ccw"]> = {
  inward: ["cw", "ccw"],
  outward: ["ccw", "cw"],
  cw: ["cw", "cw"],
  ccw: ["ccw", "ccw"],
};

function pick<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

export const normalizeBgType = (v: unknown, fallback: BgType): BgType => pick(BG_TYPES, v, fallback);
export const normalizeDiscs = (v: unknown): BgAnimDiscs => pick(DISCS, v, "two");
export const normalizeSpin = (v: unknown): BgAnimSpin => pick(SPINS, v, "inward");

/** ЗЕРКАЛО СТАРОГО ПОЛЯ bgAnimatedInvert (временное, см. Prefs.bgAnimatedInvert).
 *
 *  Старый тумблер умел ровно две позиции из четырёх новых. «В разные стороны» —
 *  буквально он и есть; «оба против часовой» старая рисовалка выразить не может
 *  и показывает ближайшее к нему (правый круг против часовой). Это осознанная
 *  потеря на время, пока фон приложения рисует App.tsx: без зеркала человек
 *  крутил бы новый выбор и НИЧЕГО не видел. */
export function legacyInvertFromSpin(spin: BgAnimSpin): boolean {
  return spin === "outward" || spin === "ccw";
}

/** Обратный перевод для миграции: старый профиль/тема → новое поле. */
export function spinFromLegacyInvert(invert: boolean): BgAnimSpin {
  return invert ? "outward" : "inward";
}

/** Собрать вид фона для зоны. "scene" с karaokeBgType="same" честно берёт
 *  ВСЕ настройки основного фона — этого владелец и ждал, когда ставил гифку. */
export function backdropViewFromPrefs(prefs: Prefs, zone: BackdropZone): BackdropView {
  const sceneryBlurPx = num(prefs.blurScenery, 0, 80, DEFAULT_PREFS.blurScenery);
  if (zone === "app" || prefs.karaokeBgType === "same") {
    return {
      zone,
      type: normalizeBgType(prefs.bgType, DEFAULT_PREFS.bgType),
      color: str(prefs.bgColor, DEFAULT_PREFS.bgColor),
      color2: str(prefs.bgColor2, DEFAULT_PREFS.bgColor2),
      imageUrl: str(prefs.bgImageUrl, ""),
      animSpeedSec: num(prefs.bgAnimSpeedSec, 16, 180, DEFAULT_PREFS.bgAnimSpeedSec),
      animOpacity: num(prefs.bgAnimOpacity, 5, 60, DEFAULT_PREFS.bgAnimOpacity),
      animScale: num(prefs.bgAnimScale, 100, 200, DEFAULT_PREFS.bgAnimScale),
      animEdge: num(prefs.bgAnimEdge, 0, 40, DEFAULT_PREFS.bgAnimEdge),
      animDiscs: normalizeDiscs(prefs.bgAnimDiscs),
      animSpin: normalizeSpin(prefs.bgAnimSpin),
      sceneryBlurPx,
    };
  }
  return {
    zone,
    // Фолбэк караоке — "cover", а не "none": незнакомое значение не должно
    // ГАСИТЬ картину, которую человек видел всегда.
    type: normalizeBgType(prefs.karaokeBgType, "cover"),
    color: str(prefs.karaokeBgColor, DEFAULT_PREFS.karaokeBgColor),
    color2: str(prefs.karaokeBgColor2, DEFAULT_PREFS.karaokeBgColor2),
    imageUrl: str(prefs.karaokeBgImageUrl, ""),
    animSpeedSec: num(prefs.karaokeBgAnimSpeedSec, 16, 180, DEFAULT_PREFS.karaokeBgAnimSpeedSec),
    animOpacity: num(prefs.karaokeBgAnimOpacity, 5, 60, DEFAULT_PREFS.karaokeBgAnimOpacity),
    animScale: num(prefs.karaokeBgAnimScale, 100, 200, DEFAULT_PREFS.karaokeBgAnimScale),
    animEdge: num(prefs.karaokeBgAnimEdge, 0, 40, DEFAULT_PREFS.karaokeBgAnimEdge),
    animDiscs: normalizeDiscs(prefs.karaokeBgAnimDiscs),
    animSpin: normalizeSpin(prefs.karaokeBgAnimSpin),
    sceneryBlurPx,
  };
}

/** Вид сцены караоке по умолчанию — прежняя размытая обложка трека.
 *  Им пользуется ListeningMode, когда площадка ещё не передала свой (веб и
 *  приложение подключаются к настройке по очереди — см. шапку AnimatedBackdrop). */
export const DEFAULT_SCENE_BACKDROP: BackdropView = backdropViewFromPrefs(DEFAULT_PREFS, "scene");
