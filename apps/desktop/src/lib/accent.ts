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
    "--accent-slider": roles.slider,
    "--accent-active-text": mixTo(hexToRgb(roles.active), target, light ? 0.32 : 0.4),
  };
}
