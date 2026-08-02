/** Реакция фона на обложку: доминирующий цвет обложки текущего трека.
 *  Canvas-даунсэмпл (как letterbox-детект в coverArt) → грубые цветовые вёдра
 *  → побеждает самое «цветное» (вес = счётчик × насыщенность, почти-чёрное и
 *  почти-белое не участвуют — фон подкрашивается цветом, а не яркостью).
 *  App смешивает результат в --bg-0/1 (mixHex). Кэш на сессию. */

const cache = new Map<string, string | null>();

const SAMPLE = 32; // сторона канваса даунсэмпла

export function dominantColor(src: string): Promise<string | null> {
  const hit = cache.get(src);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // ytimg отдаёт CORS; data:/asset — same-origin
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
        const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
        // Вёдра по 4 бита на канал: копим сумму каналов и «цветной» вес
        const buckets = new Map<number, { r: number; g: number; b: number; n: number; w: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          if (max < 28 || min > 230) continue; // почти чёрное/белое — не цвет
          const sat = max === 0 ? 0 : (max - min) / max;
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const bkt = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, w: 0 };
          bkt.r += r; bkt.g += g; bkt.b += b; bkt.n += 1;
          bkt.w += 0.15 + sat; // и тускловатый цвет может победить массой
          buckets.set(key, bkt);
        }
        let best: { r: number; g: number; b: number; n: number; w: number } | null = null;
        for (const bkt of buckets.values()) {
          if (!best || bkt.w > best.w) best = bkt;
        }
        const hex = best
          ? "#" +
            [best.r, best.g, best.b]
              .map((c) => Math.round(c / best.n).toString(16).padStart(2, "0"))
              .join("")
          : null;
        cache.set(src, hex);
        resolve(hex);
      } catch {
        // tainted canvas / декодер — честно «нет цвета»
        cache.set(src, null);
        resolve(null);
      }
    };
    img.onerror = () => {
      cache.set(src, null);
      resolve(null);
    };
    img.src = src;
  });
}

/** Смешение двух hex-цветов жило здесь, а с 2026-08-02 живёт в общем движке
 *  темы (@muza/app/theme/themeVars): смешивает он — тонировка --bg-0/1
 *  обложкой теперь считается одним кодом для приложения и веба. Здесь остался
 *  реэкспорт, чтобы у прежних потребителей не было диффа. */
export { mixHex } from "@muza/app/theme/themeVars";
