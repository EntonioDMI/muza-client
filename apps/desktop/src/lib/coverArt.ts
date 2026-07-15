/** Обложки без чёрных полос (правка владельца): YouTube-тумбнейлы (i.ytimg.com)
 *  — это кадры видео 4:3/16:9 с letterbox-полосами вокруг квадратного арта.
 *  Детектим полосы канвой (ytimg отдаёт CORS), вырезаем центральный квадрат
 *  контента и подменяем src на dataURL. Результат кэшируется на сессию. */

import { useEffect, useState } from "react";

const cache = new Map<string, string>();

/** Порог «чёрного» пикселя (тёмные полосы бывают не идеально #000). */
const LUMA_MAX = 18;
/** Доля тёмных пикселей, чтобы строка/столбец считались полосой. */
const BAR_FRACTION = 0.96;

function rowIsBlack(data: Uint8ClampedArray, w: number, y: number): boolean {
  let dark = 0;
  let total = 0;
  for (let x = 0; x < w; x += 4) {
    const i = (y * w + x) * 4;
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (luma <= LUMA_MAX) dark++;
    total++;
  }
  return dark / total >= BAR_FRACTION;
}

function colIsBlack(data: Uint8ClampedArray, w: number, h: number, x: number): boolean {
  let dark = 0;
  let total = 0;
  for (let y = 0; y < h; y += 4) {
    const i = (y * w + x) * 4;
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (luma <= LUMA_MAX) dark++;
    total++;
  }
  return dark / total >= BAR_FRACTION;
}

/** Вырезать центральный квадрат контента; null — полос нет (кроп не нужен). */
function cropLetterbox(img: HTMLImageElement): string | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  let top = 0;
  while (top < h / 3 && rowIsBlack(data, w, top)) top++;
  let bottom = h - 1;
  while (bottom > (2 * h) / 3 && rowIsBlack(data, w, bottom)) bottom--;
  let left = 0;
  while (left < w / 3 && colIsBlack(data, w, h, left)) left++;
  let right = w - 1;
  while (right > (2 * w) / 3 && colIsBlack(data, w, h, right)) right--;

  const cw = right - left + 1;
  const ch = bottom - top + 1;
  // полос почти нет — оставляем оригинал (не пережимаем без нужды)
  if (top < 3 && left < 3 && h - 1 - bottom < 3 && w - 1 - right < 3) return null;
  if (cw < 32 || ch < 32) return null; // почти целиком чёрная картинка — не трогаем

  // центральный квадрат контент-бокса (обложки квадратные по своей природе)
  const side = Math.min(cw, ch);
  const sx = left + (cw - side) / 2;
  const sy = top + (ch - side) / 2;
  const out = document.createElement("canvas");
  out.width = side;
  out.height = side;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.drawImage(img, sx, sy, side, side, 0, 0, side, side);
  return out.toDataURL("image/jpeg", 0.92);
}

/** Обложка с вырезанными letterbox-полосами (только для i.ytimg.com;
 *  остальные URL возвращаются как есть). null на входе — обложки нет
 *  (ничего не играет / у трека её нет), null и на выходе: плейсхолдер рисует
 *  ДС, а не подставная картинка. */
export function useCoverArt(src: string | null): string | null {
  const [out, setOut] = useState<string | null>(() => (src === null ? null : (cache.get(src) ?? src)));

  useEffect(() => {
    if (src === null) {
      setOut(null);
      return;
    }
    const cached = cache.get(src);
    if (cached) {
      setOut(cached);
      return;
    }
    setOut(src);
    if (!/i\.ytimg\.com/.test(src)) return;
    let alive = true;
    // hqdefault — 480×360 (квадрат контента выйдет ~270px); для больших панелей
    // сперва пробуем maxresdefault (720px), у старых видео его нет → фолбэк
    const candidates = [src.replace(/(hq|mq|sd)default/, "maxresdefault"), src].filter(
      (u, i, arr) => arr.indexOf(u) === i,
    );
    const tryLoad = (i: number) => {
      if (i >= candidates.length) {
        cache.set(src, src);
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous"; // ytimg отдаёт CORS — canvas не «портится»
      img.onload = () => {
        // maxres-заглушка YouTube — серая 120×90; пропускаем такую
        if (img.naturalWidth < 200) {
          tryLoad(i + 1);
          return;
        }
        let result = src;
        try {
          result = cropLetterbox(img) ?? candidates[i];
        } catch {
          /* CORS/декодер подвёл — оригинал */
        }
        cache.set(src, result);
        if (alive) setOut(result);
      };
      img.onerror = () => tryLoad(i + 1);
      img.src = candidates[i];
    };
    tryLoad(0);
    return () => {
      alive = false;
    };
  }, [src]);

  return out;
}
