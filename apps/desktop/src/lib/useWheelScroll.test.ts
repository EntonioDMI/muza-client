import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { scaleDelta, stepToward, useWheelScroll } from "./useWheelScroll";

describe("scaleDelta", () => {
  it("пиксельный режим: чистое умножение на скорость", () => {
    expect(scaleDelta(100, 0, 100)).toBe(100);
    expect(scaleDelta(100, 0, 200)).toBe(200);
    expect(scaleDelta(100, 0, 50)).toBe(50);
  });

  it("строчный и страничный deltaMode приводятся к пикселям", () => {
    expect(scaleDelta(3, 1, 100)).toBe(120); // 3 строки × 40px
    expect(scaleDelta(1, 2, 100)).toBe(400); // 1 страница × 400px
  });

  it("знак сохраняется (прокрутка вверх)", () => {
    expect(scaleDelta(-100, 0, 150)).toBe(-150);
  });
});

describe("stepToward", () => {
  it("движется к цели, не перелетая", () => {
    const next = stepToward(0, 100, 16);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(100);
  });

  it("ближе полупикселя — прилипает к цели точно", () => {
    expect(stepToward(99.7, 100, 16)).toBe(100);
  });

  it("за один полураспад проходит половину пути", () => {
    expect(stepToward(0, 100, 90)).toBeCloseTo(50, 5);
  });

  it("работает в обе стороны", () => {
    expect(stepToward(100, 0, 90)).toBeCloseTo(50, 5);
  });
});

/** ⚠️ ЦЕНА КАДРОВ (жалоба владельца 02.08 про ФПС в играх). У цикла догона
 *  раньше был ОДИН выход — «дотянулись до цели». Смена вкладки пересоздаёт
 *  <main key={view}>, старый контейнер уезжает из DOM, его scrollTop навсегда
 *  остаётся нулём — и цикл крутился 60 Гц до конца сессии, держа отсоединённое
 *  поддерево. Здесь проверяется, что он всё-таки завершается. */
describe("плавная прокрутка: цикл кадров обязан завершаться", () => {
  let frames: FrameRequestCallback[] = [];

  /** Прокрутить кадры вручную: по одному, максимум limit — если цикл вечный,
   *  тест не должен висеть, он должен упасть по остатку очереди. */
  const runFrames = (limit = 40) => {
    // Отсчёт ОТ ТЕКУЩИХ часов, а не от круглой тысячи: цикл запомнил lastT
    // как performance.now(), и метка кадра в прошлом дала бы отрицательный dt
    // (шаг «назад»). В одиночном прогоне файла это не всплывало, в общем — да.
    const base = performance.now();
    let n = 0;
    while (frames.length > 0 && n < limit) {
      const next = frames.shift()!;
      n += 1;
      act(() => next(base + n * 16));
    }
    return n;
  };

  /** Контейнер, который «скроллится»: jsdom не считает раскладку, поэтому
   *  размеры и scrollTop подставляем сами. */
  function scrollable(opts: { attached: boolean; movable: boolean }) {
    const el = document.createElement("div");
    el.style.overflowY = "auto";
    Object.defineProperty(el, "scrollHeight", { value: 2000 });
    Object.defineProperty(el, "clientHeight", { value: 500 });
    let top = 0;
    Object.defineProperty(el, "scrollTop", {
      get: () => top,
      // movable=false — ровно поведение отсоединённого узла: запись глотается
      set: (v: number) => {
        if (opts.movable) top = v;
      },
    });
    if (opts.attached) document.body.appendChild(el);
    return el;
  }

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    // ⚠️ Автоочистки в этом проекте нет (vitest без globals): без cleanup хук
    // прошлого теста остаётся смонтированным, его wheel-листенер тоже висит на
    // window — и следующий тест получает ДВА цикла на одно колесо.
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const wheelOn = (el: HTMLElement) => {
    const e = new WheelEvent("wheel", { deltaY: 300, bubbles: true, cancelable: true });
    Object.defineProperty(e, "target", { value: el });
    act(() => void window.dispatchEvent(e));
  };

  it("контейнер уехал из DOM — цикл гаснет, а не крутится вечно", () => {
    // attached=false = смена вкладки: узел уже не в документе, scrollTop мёртв
    const el = scrollable({ attached: false, movable: false });
    renderHook(() => useWheelScroll(100, true));

    wheelOn(el);
    expect(frames.length).toBeGreaterThan(0); // цикл заведён

    runFrames();
    expect(frames.length).toBe(0); // и завершился сам
  });

  it("контейнер на месте, но не двигается — цикл сдаётся, а не молотит вечно", () => {
    const el = scrollable({ attached: true, movable: false });
    renderHook(() => useWheelScroll(100, true));

    wheelOn(el);
    const spun = runFrames();

    expect(frames.length).toBe(0);
    expect(spun).toBeLessThanOrEqual(10); // сдался за считанные кадры, не за сотни
  });

  it("нормальный контейнер: доезжает до цели и на этом останавливается", () => {
    const el = scrollable({ attached: true, movable: true });
    renderHook(() => useWheelScroll(100, true));

    wheelOn(el);
    runFrames(200);

    expect(frames.length).toBe(0);
    expect(el.scrollTop).toBe(300); // ровно delta, без перелёта
  });
});
