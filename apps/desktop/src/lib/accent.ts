/** Кастомный акцент: из одного hex выводим все акцент-токены дизайн-системы.
 *  Готовые темы (blue/red/bolt) задают их в themes.css; свой цвет — inline на корне. */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Смешение с белым: hover/text-оттенки (текст светлее — читаемость на тёмном фоне). */
function mixWithWhite(rgb: [number, number, number], t: number): string {
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

export function customAccentVars(hex: string): Record<string, string> {
  const rgb = hexToRgb(hex);
  return {
    "--accent": hex,
    "--accent-hover": mixWithWhite(rgb, 0.15),
    "--accent-text": mixWithWhite(rgb, 0.4),
    "--accent-soft": `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.16)`,
  };
}
