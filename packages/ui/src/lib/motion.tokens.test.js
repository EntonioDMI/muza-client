import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DELAY_TIP, TOAST_HOLD, TOAST_HOLD_ACTION, readDurationMs } from "./motion.js";

/** ЗАЧЕМ ЭТОТ ТЕСТ. Часть чисел движения обязана существовать в двух местах:
 *  в токенах (их читает CSS) и в motion.js (их читает JS — таймеры подсказки и
 *  тоста, которые CSS не выразить). Дубль осознанный, но молчаливое расхождение
 *  между ними даёт худший класс багов: подсказка гаснет раньше, чем появляется,
 *  и никакой тест этого не видит. Здесь копии сверяются буквально. */

/** ⚠️ Путь — от cwd, а не от import.meta.url: под vitest модуль отдаёт vite, и
 *  import.meta.url там http-адрес, из которого файловый путь не собрать.
 *  Кандидаты — на случай запуска и из пакета, и из корня монорепо. */
const CSS_PATH = [
  "src/tokens/effects.css",
  "packages/ui/src/tokens/effects.css",
  "../../packages/ui/src/tokens/effects.css",
]
  .map((p) => resolve(process.cwd(), p))
  .find((p) => existsSync(p));

const css = readFileSync(CSS_PATH, "utf8");

/** Значение токена из :root/[data-muza-layer-root] в мс. Берём последнее
 *  объявление: в файле возможны переопределения под @media. */
function token(name) {
  const hits = [...css.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))];
  expect(hits.length, `токен --${name} не найден в effects.css`).toBeGreaterThan(0);
  const raw = hits[hits.length - 1][1].trim();
  const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : NaN;
  expect(Number.isFinite(ms), `--${name} = "${raw}" — не длительность`).toBe(true);
  return ms;
}

describe("числа движения: JS и CSS не расходятся", () => {
  it("задержка подсказки", () => {
    expect(DELAY_TIP).toBe(token("delay-tip"));
  });

  it("время жизни тоста — простого и с действием", () => {
    expect(TOAST_HOLD).toBe(token("dur-toast-hold"));
    expect(TOAST_HOLD_ACTION).toBe(token("dur-toast-hold-action"));
    // Тост с отменой обязан жить дольше: недостижимая отмена — не отмена.
    expect(TOAST_HOLD_ACTION).toBeGreaterThan(TOAST_HOLD);
  });
});

describe("шкала длительностей: форма и инварианты", () => {
  /** Базовое число из max(1ms, calc(<база> * var(--anim-*, 1))). */
  const base = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*max\\(1ms,\\s*calc\\((\\d+)ms\\s*\\*`));
    expect(m, `--${name} объявлен не по форме max(1ms, calc(Nms * var(--anim-*, 1)))`).toBeTruthy();
    return Number(m[1]);
  };

  it("УХОД БЫСТРЕЕ ВХОДА у каждой пары", () => {
    // Приход надо прочитать, уход — уже нет. Правило шкалы, а не вкус: если
    // кто-то сравняет пару, слой начнёт «оседать» вместо того, чтобы уйти.
    for (const [inName, outName] of [
      ["dur-pop-in", "dur-pop-out"],
      ["dur-modal-in", "dur-modal-out"],
      ["dur-panel-in", "dur-panel-out"],
      ["dur-scene-in", "dur-scene-out"],
      ["dur-view-in", "dur-view-out"],
    ]) {
      expect(base(outName), `${outName} обязан быть короче ${inName}`).toBeLessThan(base(inName));
    }
  });

  it("каждая настраиваемая длительность защищена max(1ms, …)", () => {
    // При выключенных анимациях множитель приезжает нулём, а при нулевой
    // длительности transitionend НЕ приходит вовсе — слой, который снимается
    // по этому событию, остался бы в дереве навсегда.
    for (const name of [
      "dur-press-in",
      "dur-press-out",
      "dur-state",
      "dur-state-move",
      "dur-pop-in",
      "dur-pop-out",
      "dur-modal-in",
      "dur-modal-out",
      "dur-panel-in",
      "dur-panel-out",
      "dur-scene-in",
      "dur-scene-out",
      "dur-lyric",
      "dur-view-in",
      "dur-view-out",
      "dur-transit",
      "dur-transit-land",
    ]) {
      expect(base(name)).toBeGreaterThan(0);
    }
  });

  it("шкала объявлена НА КОРНЕ ТЕМЫ, а не только в :root", () => {
    // Множители --anim-* движок темы ставит инлайном на [data-muza-layer-root].
    // var() подставляется там, где токен ОБЪЯВЛЕН: объяви мы шкалу только в
    // :root — она навсегда взяла бы фолбэк 1, и три ползунка скорости
    // перестали бы действовать, не сломав при этом ни одного теста.
    expect(css).toMatch(/:root,\s*\n?\[data-muza-layer-root\]\s*\{/);
  });

  it("четыре кривые на месте, каждая своя", () => {
    const curves = ["ease-standard", "ease-out", "ease-in", "ease-in-out"].map((n) => {
      const m = css.match(new RegExp(`--${n}:\\s*([^;]+);`));
      expect(m, `--${n} не найдена`).toBeTruthy();
      return m[1].trim();
    });
    expect(new Set(curves).size, "кривые обязаны отличаться друг от друга").toBe(4);
  });

  it("сцепка с курсором НЕ зависит от ползунка скорости", () => {
    // --dur-follow сглаживает плашку, летящую за рукой. Это фильтр, а не
    // переход: замедли его ползунком — и плашка начнёт отставать от курсора.
    expect(css).toMatch(/--dur-follow:\s*\d+ms;/);
  });
});

describe("readDurationMs", () => {
  it("нет узла — нет длительности", () => {
    expect(readDurationMs(null)).toBe(0);
  });

  it("берёт САМУЮ ДЛИННУЮ из списка и из обоих свойств", () => {
    const el = document.createElement("div");
    el.style.transitionDuration = "0.1s, 250ms";
    el.style.animationDuration = "0.4s";
    document.body.appendChild(el);
    // jsdom считает вычисленные значения по инлайну — этого достаточно:
    // проверяем разбор, а не каскад.
    expect(readDurationMs(el)).toBe(400);
    el.remove();
  });
});
