import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { Cover } from "@muza/ui";
import { findContentBox } from "./coverArt";

afterEach(cleanup);

type Rgb = [number, number, number];

/** Синтетическая картинка: канва в jsdom не работает, поэтому пиксели
 *  собираются руками и скармливаются чистой findContentBox. */
function image(w: number, h: number, paint: (x: number, y: number) => Rgb): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** «Арт»: пёстрый контент, заведомо непохожий ни на одно поле из тестов ниже. */
const art = (x: number, y: number): Rgb => [(x * 7 + y * 3) % 256, (y * 11) % 256, 200];

describe("findContentBox — поля любого цвета", () => {
  it("ловит ЦВЕТНОЕ поле по бокам (maxresdefault арт-трека: 1280×720, поля 280px)", () => {
    // Реальный цвет поля с i.ytimg.com/vi/khnokW3Mw24/maxresdefault.jpg.
    // Старый детектор искал luma <= 18, а тут luma = 58 → поле не виделось.
    const bar: Rgb = [65, 58, 39];
    const data = image(1280, 720, (x, y) => (x < 280 || x >= 1000 ? bar : art(x, y)));
    expect(findContentBox(data, 1280, 720)).toEqual({ top: 0, left: 280, right: 999, bottom: 719 });
  });

  it("ловит СЕРОЕ поле — ровно та жалоба владельца (luma 128 ≫ старого порога 18)", () => {
    const grey: Rgb = [128, 128, 128];
    const data = image(1280, 720, (x, y) => (x < 280 || x >= 1000 ? grey : art(x, y)));
    const box = findContentBox(data, 1280, 720);
    expect(box).toEqual({ top: 0, left: 280, right: 999, bottom: 719 });
    // контент-бокс квадратный → кроп отдаст ровно арт
    expect(box!.right - box!.left + 1).toBe(720);
    expect(box!.bottom - box!.top + 1).toBe(720);
  });

  it("ловит БЕЛОЕ поле (обратный край диапазона)", () => {
    const white: Rgb = [255, 255, 255];
    const data = image(1280, 720, (x, y) => (x < 280 || x >= 1000 ? white : art(x, y)));
    expect(findContentBox(data, 1280, 720)).toEqual({ top: 0, left: 280, right: 999, bottom: 719 });
  });

  it("ловит чёрный letterbox сверху/снизу (hqdefault 480×360, поля 45px) — не сломали старое", () => {
    const black: Rgb = [0, 0, 0];
    const data = image(480, 360, (x, y) => (y < 45 || y >= 315 ? black : art(x, y)));
    const box = findContentBox(data, 480, 360);
    expect(box).toEqual({ top: 45, left: 0, right: 479, bottom: 314 });
    // контент 480×270 = 16:9 → центральный квадрат 270×270 и есть арт
    expect(box!.bottom - box!.top + 1).toBe(270);
  });

  it("терпит шум JPEG внутри поля (±допуск)", () => {
    const data = image(1280, 720, (x, y) =>
      x < 280 || x >= 1000 ? [65 + ((x + y) % 7), 58 - ((x * y) % 5), 39 + (y % 6)] : art(x, y),
    );
    expect(findContentBox(data, 1280, 720)).toEqual({ top: 0, left: 280, right: 999, bottom: 719 });
  });
});

describe("findContentBox — предохранители от ложных срабатываний", () => {
  it("обычный кадр без полей → null (не кропаем без нужды)", () => {
    expect(findContentBox(image(1280, 720, art), 1280, 720)).toBeNull();
  });

  it("однородный край С ОДНОЙ стороны → null (это контент, а не letterbox)", () => {
    // Ровно случай i.ytimg.com/vi/a5uQMwRMHcs/maxresdefault.jpg: тёмный правый
    // край кадра. Без проверки симметрии детектор срезал бы 312px и увёл кроп.
    const bar: Rgb = [12, 10, 14];
    const data = image(1280, 720, (x, y) => (x >= 968 ? bar : art(x, y)));
    expect(findContentBox(data, 1280, 720)).toBeNull();
  });

  it("вертикальный градиент → null (углы оси разного цвета)", () => {
    // Края градиента однородны построчно И симметричны — ловится только
    // проверкой «противоположные поля одного цвета».
    const data = image(1280, 720, (_x, y) => [0, 0, Math.floor((y / 720) * 255)]);
    expect(findContentBox(data, 1280, 720)).toBeNull();
  });

  it("однотонная картинка целиком → null (скан упёрся в ⅓ с обеих сторон)", () => {
    const data = image(1280, 720, () => [40, 40, 40]);
    expect(findContentBox(data, 1280, 720)).toBeNull();
  });

  it("поля глубже ⅓ → null, а не мусорный кроп", () => {
    const bar: Rgb = [65, 58, 39];
    const data = image(1280, 720, (x, y) => (x < 500 || x >= 780 ? bar : art(x, y)));
    expect(findContentBox(data, 1280, 720)).toBeNull();
  });

  it("мусор на входе → null, без исключений", () => {
    expect(findContentBox(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    expect(findContentBox(new Uint8ClampedArray(4), 1, 1)).toBeNull();
    expect(findContentBox(new Uint8ClampedArray(16), 100, 100)).toBeNull(); // короче заявленного
  });
});

/** Списки (TrackRow/Tile) канву не гоняют — геометрию правит CSS в <Cover>. */
describe("Cover — pillarbox-коррекция ytimg без канвы", () => {
  const transformOf = (src: string | null, fit?: "auto" | "cover" | "pillarbox") => {
    const { container } = render(createElement(Cover, { src, ...(fit ? { fit } : null) }));
    return container.querySelector("img")?.style.transform ?? null;
  };

  it("4:3-тумб (hqdefault) зумится на 4/3 — полосы уезжают за край", () => {
    expect(transformOf("https://i.ytimg.com/vi/khnokW3Mw24/hqdefault.jpg")).toBe("scale(1.34)");
  });

  it("4:3-тумбы default/sddefault и .webp — тоже", () => {
    expect(transformOf("https://i.ytimg.com/vi/abc/sddefault.jpg")).toBe("scale(1.34)");
    expect(transformOf("https://i.ytimg.com/vi/abc/default.jpg")).toBe("scale(1.34)");
    expect(transformOf("https://i.ytimg.com/vi_webp/abc/hqdefault.webp")).toBe("scale(1.34)");
  });

  it("query-строка тумба не мешает детекту", () => {
    expect(transformOf("https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=-oaymwE&rs=AOn4")).toBe("scale(1.34)");
  });

  it("16:9-тумбы (maxresdefault/mqdefault/hq720) НЕ зумятся — у них полос нет", () => {
    expect(transformOf("https://i.ytimg.com/vi/abc/maxresdefault.jpg")).toBe("");
    expect(transformOf("https://i.ytimg.com/vi/abc/mqdefault.jpg")).toBe("");
    expect(transformOf("https://i.ytimg.com/vi/abc/hq720.jpg")).toBe("");
  });

  it("кропнутый dataURL от useCoverArt НЕ зумится повторно", () => {
    expect(transformOf("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe("");
  });

  it("чужие обложки не трогаем", () => {
    expect(transformOf("https://example.com/vi/abc/hqdefault.jpg")).toBe("");
    expect(transformOf("https://notytimg.com/x/hqdefault.jpg")).toBe("");
    expect(transformOf("/local/hqdefault.jpg")).toBe("");
  });

  it("проп fit — ручной оверрайд авто-детекта", () => {
    expect(transformOf("https://i.ytimg.com/vi/abc/hqdefault.jpg", "cover")).toBe("");
    expect(transformOf("https://example.com/a.jpg", "pillarbox")).toBe("scale(1.34)");
  });

  it("нет src — плейсхолдер, картинки нет вовсе", () => {
    const { container } = render(createElement(Cover, { src: null }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
