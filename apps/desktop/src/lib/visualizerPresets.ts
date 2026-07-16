/** Пресеты визуализатора (T50) — по конвенции «пресеты → ползунки»
 *  (decisions 2026-07-13): пресет НЕ хранится в Prefs, чип просто записывает
 *  числа в обычные числовые префы, а подсветка активного чипа вычисляется
 *  обратным сравнением (activeVisPreset). Крутнул любой ползунок — подсветка
 *  честно гаснет («Свой»), само значение при этом никуда не переезжает.
 *
 *  Первый пресет каждого вида — в точности DEFAULT_PREFS: он же кнопка
 *  «вернуть как было», отдельный reset не нужен. Диапазоны значений держит
 *  тест через VIS_LIMITS. Насыщенность (opacity) пресеты сознательно не
 *  трогают — она общая для баров и волны, и пресет одного вида не должен
 *  перекрашивать другой. */
import type { Prefs } from "../types";

/** Ключи — литеральный юнион, а не string: подписи чипов берутся шаблоном
 *  t(`settings.extensions.visualizerStyle.${key}`), и юнион даёт типизации
 *  i18n проверить, что каждый ключ есть в словаре. */
export type VisPresetKey = "waveSoft" | "waveRibbon" | "waveThin" | "waveLive" | "barsClassic" | "barsDense" | "barsAiry";

export interface VisPreset {
  key: VisPresetKey;
  set: Partial<Prefs>;
}

export const WAVE_PRESETS: VisPreset[] = [
  // Дефолт: толстая, плавная, с телом — ответ на жалобу «резкая, тонкая,
  // дёргается» самим дефолтом (прецедент — bassShakeStrength 150).
  {
    key: "waveSoft",
    set: { visualizerWaveThick: 45, visualizerWaveFill: 45, visualizerWaveSmooth: 60, visualizerWaveCalm: 60, visualizerWaveAmp: 100 },
  },
  // Максимально телесная: почти сплошная лента с сильной инерцией.
  {
    key: "waveRibbon",
    set: { visualizerWaveThick: 78, visualizerWaveFill: 80, visualizerWaveSmooth: 75, visualizerWaveCalm: 72, visualizerWaveAmp: 88 },
  },
  // Тонкий штрих — прежний характер, но без межкадрового дребезга.
  {
    key: "waveThin",
    set: { visualizerWaveThick: 10, visualizerWaveFill: 12, visualizerWaveSmooth: 55, visualizerWaveCalm: 50, visualizerWaveAmp: 108 },
  },
  // Резвая: минимум инерции, размах больше — для тех, кому «мягко» скучно.
  {
    key: "waveLive",
    set: { visualizerWaveThick: 38, visualizerWaveFill: 28, visualizerWaveSmooth: 38, visualizerWaveCalm: 24, visualizerWaveAmp: 122 },
  },
];

export const BAR_PRESETS: VisPreset[] = [
  // Дефолт: прежние пилюли + лёгкий плавный спад.
  {
    key: "barsClassic",
    set: { visualizerBars: 56, visualizerBarFill: 84, visualizerBarRound: 100, visualizerBarCalm: 30 },
  },
  // Частокол: много узких почти прямоугольных баров, плотная стена звука.
  {
    key: "barsDense",
    set: { visualizerBars: 88, visualizerBarFill: 94, visualizerBarRound: 35, visualizerBarCalm: 22 },
  },
  // Воздушные: редкие широкие пилюли с тягучим спадом, спокойная сцена.
  {
    key: "barsAiry",
    set: { visualizerBars: 32, visualizerBarFill: 62, visualizerBarRound: 100, visualizerBarCalm: 45 },
  },
];

/** Ключ пресета, все значения которого совпадают с текущими prefs, или null
 *  («Свой»). Сравнение строгое: пресеты пишут целые, ползунки тоже. */
export function activeVisPreset(presets: VisPreset[], prefs: Prefs): VisPresetKey | null {
  for (const p of presets) {
    let match = true;
    for (const [key, value] of Object.entries(p.set)) {
      if (prefs[key as keyof Prefs] !== value) {
        match = false;
        break;
      }
    }
    if (match) return p.key;
  }
  return null;
}
