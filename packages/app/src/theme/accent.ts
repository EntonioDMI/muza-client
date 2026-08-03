/** Кастомный акцент: из одного hex выводим все акцент-токены дизайн-системы.
 *  Готовые темы (blue/red/bolt) задают их в themes.css; свой цвет — inline на корне. */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Смешение к цели (белый на тёмной теме, чёрный на светлой) на долю t. */
function mixTo(rgb: [number, number, number], target: number, t: number): string {
  const [r, g, b] = rgb.map((c) => Math.round(c + (target - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

/** WCAG relative luminance (0 — чёрный, 1 — белый). */
function relLuminance(rgb: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** Контраст-гард: белый на акценте читается не всегда — тогда берём тёмный.
 *
 *  Порог 4.5, а не 3, потому что на акценте лежит не только глиф кнопки, но и
 *  ПОДПИСЬ основной кнопки (15px полужирный), а для обычного текста норма 4.5:1;
 *  3:1 — норма для крупного текста и графики. Со старым порогом свой синий
 *  #3b82f6 получал белую подпись при 3.68:1 — формально проходило гард, на деле
 *  ниже нормы. Замер 03.08: у пресетов ДС белый не добирал вообще нигде
 *  (синий 3.68, красный 2.93, наведённые 2.93 и 2.49), поэтому в тёмной теме
 *  --text-on-accent теперь тёмный токеном; здесь та же логика для СВОЕГО цвета,
 *  чтобы своя кнопка не читалась хуже пресетной. */
export function textOnAccent(hex: string): string {
  const contrastWithWhite = 1.05 / (relLuminance(hexToRgb(hex)) + 0.05);
  return contrastWithWhite >= 4.5 ? "#ffffff" : "#121110";
}

/** Кастомный акцент → токены. На светлой теме hover/text ЗАТЕМНЯЮТСЯ (читаемость
 *  на светлом фоне), на тёмной — осветляются, как было. */
export function customAccentVars(hex: string, light = false): Record<string, string> {
  const rgb = hexToRgb(hex);
  const target = light ? 0 : 255;
  return {
    "--accent": hex,
    "--accent-hover": mixTo(rgb, target, 0.15),
    "--accent-text": mixTo(rgb, target, light ? 0.32 : 0.4),
    "--accent-soft": `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${light ? 0.14 : 0.16})`,
    // контент ПОВЕРХ акцента (иконка Play, текст primary-кнопок): не константа-белый,
    // а по яркости выбранного цвета — иначе светлый акцент = «белое на белом»
    "--text-on-accent": textOnAccent(hex),
  };
}

/** Роли акцента: отдельные цвета для play-кнопок, слайдеров и активного трека.
 *  Компоненты ДС читают ролевые переменные с фолбэком на общий --accent
 *  (var(--accent-play, var(--accent)) и т.п.) — без ролей ничего не меняется.
 *  Для активного трека выводится text-вариант (та же коррекция читаемости,
 *  что у customAccentVars). */
export function accentRoleVars(
  roles: { play: string; slider: string; active: string },
  light = false,
): Record<string, string> {
  const target = light ? 0 : 255;
  return {
    "--accent-play": roles.play,
    "--accent-play-hover": mixTo(hexToRgb(roles.play), target, 0.15),
    // иконка на play-кнопке — от яркости ЕЁ фона (роль может отличаться от --accent);
    // фолбэк-цепочка в IconButton: var(--text-on-accent-play, var(--text-on-accent))
    "--text-on-accent-play": textOnAccent(roles.play),
    "--accent-slider": roles.slider,
    "--accent-active-text": mixTo(hexToRgb(roles.active), target, light ? 0.32 : 0.4),
  };
}
