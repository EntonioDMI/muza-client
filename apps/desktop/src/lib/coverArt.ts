/** Обложки без полей (правка владельца): YouTube-тумбнейлы (i.ytimg.com) — это
 *  КАДР ВИДЕО, а не обложка. Квадратный арт вписан в 16:9 полями по бокам, а
 *  4:3-варианты — тот же 16:9-кадр, доложенный полосами сверху и снизу.
 *  Детектим поля канвой (ytimg отдаёт CORS), вырезаем центральный квадрат
 *  контента и подменяем src на dataURL. Результат кэшируется на сессию.
 *
 *  Кроп не удался — отдаём ИСХОДНЫЙ src: геометрию доберёт CSS в <Cover>
 *  (@muza/ui), который и так лечит все списки без канвы. См. `useCoverArt`. */

import { useEffect, useState } from "react";

const cache = new Map<string, string>();

/** Допуск на канал при сравнении с цветом угла. Поле сплошное (проверено на
 *  живых тумбах: RGB не «плывёт» вообще), но JPEG звенит на границе с артом,
 *  поэтому не 0. Выше ~16 начинаются ложные срабатывания на реальных кадрах:
 *  на выборке из 30 тумбов tol=20 резал ночные планы, tol=12 — нет. */
const BAR_TOLERANCE = 12;
/** Доля совпавших пикселей, чтобы строка/столбец считались полем. */
const BAR_FRACTION = 0.96;
/** Шаг сэмплирования вдоль строки/столбца (каждый 4-й пиксель). */
const SAMPLE_STEP = 4;
/** Глубже трети размера с каждой стороны не режем ни при каких раскладах. */
const MAX_BAR_SHARE = 3;

export interface ContentBox {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

type Rgb = readonly [number, number, number];

function pixelAt(data: Uint8ClampedArray, w: number, x: number, y: number): Rgb {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

/** Цвета совпадают по каждому каналу (не по luma — поле бывает любого цвета,
 *  а не только чёрным; на живых тумбах оно тёмно-красное/оливковое, luma 37–65,
 *  то есть СИЛЬНО выше старого порога «чёрного» в 18). */
function rgbNear(a: Rgb, b: Rgb): boolean {
  return (
    Math.abs(a[0] - b[0]) <= BAR_TOLERANCE &&
    Math.abs(a[1] - b[1]) <= BAR_TOLERANCE &&
    Math.abs(a[2] - b[2]) <= BAR_TOLERANCE
  );
}

function pixelNear(data: Uint8ClampedArray, w: number, x: number, y: number, ref: Rgb): boolean {
  const i = (y * w + x) * 4;
  return (
    Math.abs(data[i] - ref[0]) <= BAR_TOLERANCE &&
    Math.abs(data[i + 1] - ref[1]) <= BAR_TOLERANCE &&
    Math.abs(data[i + 2] - ref[2]) <= BAR_TOLERANCE
  );
}

function rowIsBand(data: Uint8ClampedArray, w: number, y: number, ref: Rgb): boolean {
  let hit = 0;
  let total = 0;
  for (let x = 0; x < w; x += SAMPLE_STEP) {
    if (pixelNear(data, w, x, y, ref)) hit++;
    total++;
  }
  return hit / total >= BAR_FRACTION;
}

function colIsBand(data: Uint8ClampedArray, w: number, h: number, x: number, ref: Rgb): boolean {
  let hit = 0;
  let total = 0;
  for (let y = 0; y < h; y += SAMPLE_STEP) {
    if (pixelNear(data, w, x, y, ref)) hit++;
    total++;
  }
  return hit / total >= BAR_FRACTION;
}

/** Поля центрированы по построению (провайдер вписывает контент в кадр), значит
 *  противоположные поля равны. Односторонний однородный край — это КОНТЕНТ
 *  (тёмный угол кадра, стена, небо), и трогать его нельзя. */
function symmetric(a: number, b: number, dim: number): boolean {
  return Math.abs(a - b) <= Math.max(2, dim * 0.02);
}

/** Границы контента внутри кадра; null — полей нет либо доверять находке нельзя.
 *
 *  Полем считается однородная краевая строка/столбец ЛЮБОГО цвета (не «чёрная»:
 *  на живых тумбах поле тёмно-красное/оливковое). Эталон — цвет ближнего угла,
 *  совпадение по каналам с допуском; сравниваем с ФИКСИРОВАННЫМ углом, а не с
 *  соседней строкой, иначе плавный градиент утащил бы скан до самого упора.
 *
 *  Три предохранителя против ложных срабатываний, все три обязательны:
 *  1) углы одной оси одного цвета — иначе это градиент, а не заливка;
 *  2) противоположные поля равны по толщине — иначе это однородный край кадра;
 *  3) глубже ⅓ не режем, и если скан упёрся в ⅓ с обеих сторон — сдаёмся.
 *  Проверено на 30 живых тумбах (6 арт-треков + 6 обычных клипов × форматы):
 *  все арт-треки кропаются в точный квадрат арта, все обычные клипы — null.
 *
 *  Вынесено из `cropLetterbox` отдельной чистой функцией: в jsdom нет канвы,
 *  и только так логику можно накрыть тестами (см. coverArt.test.ts). */
export function findContentBox(data: Uint8ClampedArray, w: number, h: number): ContentBox | null {
  if (w < 2 || h < 2 || data.length < w * h * 4) return null;

  const topLeft = pixelAt(data, w, 0, 0);
  const topRight = pixelAt(data, w, w - 1, 0);
  const bottomLeft = pixelAt(data, w, 0, h - 1);
  const vLimit = Math.floor(h / MAX_BAR_SHARE);
  const hLimit = Math.floor(w / MAX_BAR_SHARE);

  let top = 0;
  while (top < vLimit && rowIsBand(data, w, top, topLeft)) top++;
  let bottom = h - 1;
  while (h - 1 - bottom < vLimit && rowIsBand(data, w, bottom, bottomLeft)) bottom--;
  let left = 0;
  while (left < hLimit && colIsBand(data, w, h, left, topLeft)) left++;
  let right = w - 1;
  while (w - 1 - right < hLimit && colIsBand(data, w, h, right, topRight)) right--;

  // Противоположные поля letterbox'а — ОДНОГО цвета (это одна заливка вокруг
  // контента). Углы разного цвета ⇒ края однородны «сами по себе»: так ведёт
  // себя градиент — каждая строка почти равна соседней, и скан уползает вглубь
  // на десятки строк. Ось с разноцветными углами отбрасываем целиком.
  if (!rgbNear(topLeft, bottomLeft)) {
    top = 0;
    bottom = h - 1;
  }
  if (!rgbNear(topLeft, topRight)) {
    left = 0;
    right = w - 1;
  }
  // Нашли поле только с одной стороны — это не letterbox, а однородный край
  // картинки (тёмный угол кадра, стена, небо). Ось отбрасываем.
  if (!symmetric(top, h - 1 - bottom, h)) {
    top = 0;
    bottom = h - 1;
  }
  if (!symmetric(left, w - 1 - right, w)) {
    left = 0;
    right = w - 1;
  }

  // Полей практически нет — оставляем оригинал (не пережимаем без нужды).
  if (top < 3 && left < 3 && h - 1 - bottom < 3 && w - 1 - right < 3) return null;
  // Скан упёрся в ⅓ с ОБЕИХ сторон: контент так и не нашёлся — картинка
  // однородна настолько, насколько мы смотрели. Кропать нечего и опасно.
  if (left >= hLimit && w - 1 - right >= hLimit) return null;
  if (top >= vLimit && h - 1 - bottom >= vLimit) return null;

  const cw = right - left + 1;
  const ch = bottom - top + 1;
  if (cw < 32 || ch < 32) return null; // почти целиком однородная картинка — не трогаем

  return { top, left, right, bottom };
}

/** Вырезать центральный квадрат контента; null — полей нет (кроп не нужен). */
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
  const box = findContentBox(ctx.getImageData(0, 0, w, h).data, w, h);
  if (!box) return null;

  // центральный квадрат контент-бокса (обложки квадратные по своей природе)
  const cw = box.right - box.left + 1;
  const ch = box.bottom - box.top + 1;
  const side = Math.min(cw, ch);
  const sx = box.left + (cw - side) / 2;
  const sy = box.top + (ch - side) / 2;
  const out = document.createElement("canvas");
  out.width = side;
  out.height = side;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.drawImage(img, sx, sy, side, side, 0, 0, side, side);
  return out.toDataURL("image/jpeg", 0.92);
}

/** Обложка с вырезанными полями (только для i.ytimg.com; остальные URL
 *  возвращаются как есть). null на входе — обложки нет (ничего не играет / у
 *  трека её нет), null и на выходе: плейсхолдер рисует ДС, а не подставная
 *  картинка. */
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
    // сперва пробуем maxresdefault (арт 720×720), у старых видео его нет → фолбэк
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
          // Кроп УДАЛСЯ → отдаём квадрат: на maxresdefault это честные 720×720
          // арта — ради этого разрешения кандидат и берётся.
          // Кроп НЕ удался → отдаём ИСХОДНЫЙ src, а НЕ candidates[i]. Почему:
          // maxresdefault оправдан только когда мы поля НАШЛИ И СРЕЗАЛИ. Иначе
          // мы бы вернули 16:9-кадр, чью геометрию не проверили, — ровно то, из
          // чего и родилась жалоба на поля. У src же геометрия известна, и
          // <Cover> чинит её чистой CSS-математикой (тем же приёмом, что и для
          // всех строк списков) — один путь вместо двух.
          result = cropLetterbox(img) ?? src;
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
