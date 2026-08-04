import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "../prefs/types";
import { buildThemeVars, mixHex, themeAttrs } from "./themeVars";

/** ЗАЧЕМ ЭТИ ТЕСТЫ. Движок темы стал общим для приложения и веба (перенос
 *  формул из apps/desktop/src/App.tsx, 2026-08-02), и главное требование
 *  переноса — у приложения НУЛЕВОЙ дифф. Проверять это глазами по скриншоту
 *  дорого и ненадёжно, поэтому ожидаемые значения ниже выписаны руками из
 *  ПРЕЖНИХ формул rootStyle: если кто-то поправит выражение в движке, красным
 *  станет здесь, а не в глазах пользователя. */

// Тип возвращаемого стиля — CSSProperties; читаем как словарь переменных.
const vars = (...args: Parameters<typeof buildThemeVars>) =>
  buildThemeVars(...args) as unknown as Record<string, string | number | undefined>;

describe("buildThemeVars — дефолтный профиль", () => {
  const v = vars(DEFAULT_PREFS);

  it("стекло и текст считаются из процентов профиля", () => {
    expect(v["--blur-glass"]).toBe("28px");
    // Лестница материалов: один ползунок (62) — четыре плотности, у каждой своя
    // прямая α = c0 + c1·g (themeVars.ts, MATERIAL). Числа обязаны совпадать с
    // фолбэками в packages/ui/src/tokens/glass.css, иначе экран входа и первая
    // отрисовка будут отличаться от приложения.
    expect(v["--glass-zone"]).toBe("rgba(28, 26, 23, 0.62)");
    expect(v["--glass-panel"]).toBe("rgba(28, 26, 23, 0.64)");
    expect(v["--glass-dialog"]).toBe("rgba(28, 26, 23, 0.82)");
    // Скрим полноэкранного — тон ФОНА ОКНА (--bg-0), а не поднятой плиты.
    expect(v["--glass-deep"]).toBe("rgba(10, 9, 8, 0.80)");
    expect(v["--text-2"]).toBe("rgba(244, 243, 241, 0.62)");
    // 0.52 давало 4.23:1 на выделенной строке (плёнка surface-4) при норме 4.5,
    // и поднять плотность стекла эту пару не спасает — плёнка светлит поверх
    // любого стекла. Разбор — у токена --text-3 в tokens/colors.css.
    expect(v["--text-3"]).toBe("rgba(244, 243, 241, 0.56)");
  });

  it("размытие зон включено ВСЕГДА, а не только вместе со «стеклом по зонам»", () => {
    // Раньше --bf-zone появлялась лишь при glassZonesOn, и сайдбар с «Сейчас
    // играет» по умолчанию были плоской заливкой без материала.
    expect(v["--bf-zone"]).toBe("blur(var(--blur-glass))");
  });

  it("размеры зон и списков = токенам ДС (профиль ничего не двигает)", () => {
    // Числа редизайна 2026-08-04 (были 92 / 60 / 12 / 280 / 20): зоны собраны,
    // ширина отдана содержимому. Дефолты живут в DEFAULT_PREFS и в
    // tokens/spacing.css — этот тест держит обе копии в одном значении.
    expect(v["--h-playerbar"]).toBe("72px");
    expect(v["--size-cover-bar"]).toBe("48px");
    expect(v["--w-tile"]).toBe("176px");
    expect(v["--pad-tile"]).toBe("16px");
    expect(v["--gap-zone"]).toBe("8px"); // «воздушный» дефолт; плоский — тумблером
    expect(v["--w-sidebar"]).toBe("240px");
    expect(v["--w-nowplaying"]).toBe("340px");
    expect(v["--pad-zone"]).toBe("16px");
    expect(v["--h-trackrow"]).toBe("60px");
    expect(v["--lh-ui"]).toBe("1.40");
    expect(v["--fs-karaoke"]).toBe("56px");
    expect(v["--blur-scenery"]).toBe("64px");
    expect(v["--orb-dur"]).toBe("64s");
  });

  it("при дефолтах НЕ ставит того, что должно достаться токенам ДС", () => {
    for (const key of [
      "--r-xs",
      "--r-lg",
      "--r-control",
      "--r-field",
      "--r-tabs",
      "--glass-player",
      "--bg-0",
      "--font-ui",
      "--font-display",
      "--fs-title",
      "--sp-1",
      "--dur-fast",
      "--ease-out",
      "--accent",
      "--accent-play",
      "zoom",
    ]) {
      expect(v).not.toHaveProperty(key);
    }
  });
});

describe("buildThemeVars — ручки настроек", () => {
  it("масштаб интерфейса = zoom (100% — свойства нет вовсе)", () => {
    expect(vars({ ...DEFAULT_PREFS, uiScale: 125 }).zoom).toBe(1.25);
    expect(vars({ ...DEFAULT_PREFS, uiScale: 100 })).not.toHaveProperty("zoom");
  });

  it("простор множит ВСЮ шкалу отступов ДС", () => {
    const v = vars({ ...DEFAULT_PREFS, spaceScale: 125 });
    expect(v["--sp-1"]).toBe("5px"); // 4 × 1.25
    expect(v["--sp-4"]).toBe("20px"); // 16 × 1.25
    expect(v["--sp-10"]).toBe("100px"); // 80 × 1.25
  });

  it("скругление по типам: проценты от пресета radius, px — у кнопок и полей", () => {
    const v = vars({ ...DEFAULT_PREFS, radius: "round", radiusTiles: 50, radiusPanels: 200, radiusControls: 8 });
    // Пресет round после редизайна 2026-08-04 — это вид ДО него, число в
    // число (tokens/radius.css): xs 10, md 20, lg 28.
    expect(v["--r-xs"]).toBe("5px"); // round.xs 10 × 0.5
    expect(v["--r-md"]).toBe("10px"); // round.md 20 × 0.5
    expect(v["--r-lg"]).toBe("56px"); // round.lg 28 × 2
    expect(v["--r-control"]).toBe("8px");
    // «как в ДС» (сентинел 999) — токен не ставим вовсе
    expect(v).not.toHaveProperty("--r-field");
  });

  it("стекло по зонам: все пять зон в ОДНОМ тоне стекла", () => {
    // До 03.08 сайдбар и «Сейчас играет» считались от светлеющей плёнки
    // (rgba(255,255,255,…)), то есть жили в другом масштабе, чем плеер и меню:
    // соседние ползунки с одинаковыми числами давали разный результат.
    const v = vars({ ...DEFAULT_PREFS, glassZonesOn: true, glassPlayer: 40, glassSidebar: 10 });
    expect(v["--glass-player"]).toBe("rgba(28, 26, 23, 0.4)");
    expect(v["--glass-sidebar"]).toBe("rgba(28, 26, 23, 0.1)");
  });

  it("включение «стекла по зонам» само по себе ничего не перекрашивает", () => {
    // Дефолты пяти ручек = лестнице материалов при ползунке 62. Тумблер только
    // раскрывает ручки; если он меняет вид — значит дефолты разъехались с
    // формулами, и человек, заглянувший в подстройку, получает сюрприз.
    const off = vars(DEFAULT_PREFS);
    const on = vars({ ...DEFAULT_PREFS, glassZonesOn: true });
    expect(on["--glass-player"]).toBe(off["--glass-panel"]);
    expect(on["--glass-menu"]).toBe(off["--glass-panel"]);
    expect(on["--glass-dialog"]).toBe(off["--glass-dialog"]);
    expect(on["--glass-sidebar"]).toBe(off["--glass-zone"]);
    expect(on["--glass-nowplaying"]).toBe(off["--glass-zone"]);
  });

  it("ползунок стекла двигает ВСЕ материалы, а не только плавающие панели", () => {
    // Ровно та жалоба, из-за которой заведена лестница: «ползунок двигает
    // только часть поверхностей». Тест на суть — каждое значение обязано
    // отличаться от соседнего положения ручки.
    const lo = vars({ ...DEFAULT_PREFS, glassOpacity: 30 });
    const hi = vars({ ...DEFAULT_PREFS, glassOpacity: 100 });
    for (const key of ["--glass-zone", "--glass-panel", "--glass-dialog", "--glass-deep"] as const) {
      expect(lo[key], `${key} не отзывается на ползунок`).not.toBe(hi[key]);
    }
  });

  it("скорость движения: общий процент × групповой множитель", () => {
    const v = vars({ ...DEFAULT_PREFS, animSpeed: 50, durMenuMult: 200 });
    expect(v["--dur-fast"]).toBe("150ms"); // 150 × 0.5 × 2
    expect(v["--dur-base"]).toBe("110ms"); // 220 × 0.5
    expect(v["--dur-slow"]).toBe("200ms"); // 400 × 0.5
  });

  it("анимации выключены — длительности схлопываются в 1ms", () => {
    const v = vars({ ...DEFAULT_PREFS, anims: false, animSpeed: 50 });
    expect(v["--dur-fast"]).toBe("1ms");
    expect(v["--dur-slow"]).toBe("1ms");
  });

  it("характер движения меняет кривую (soft — родная ДС, не ставим)", () => {
    expect(vars({ ...DEFAULT_PREFS, easeStyle: "linear" })["--ease-out"]).toBe("linear");
    expect(vars({ ...DEFAULT_PREFS, easeStyle: "soft" })).not.toHaveProperty("--ease-out");
  });

  it("базовый фон-пресет переопределяет --bg-0/1 и только в тёмной теме", () => {
    expect(vars({ ...DEFAULT_PREFS, baseBg: "amoled" })["--bg-0"]).toBe("#000000");
    expect(vars({ ...DEFAULT_PREFS, baseBg: "amoled", theme: "light" })).not.toHaveProperty("--bg-0");
  });

  it("реакция фона на обложку смешивает пару bg-слоёв с цветом обложки", () => {
    const v = vars({ ...DEFAULT_PREFS, bgTint: true }, { coverTint: "#ff0000" });
    // База тонировки = --bg-0 тёмной темы (BG_DEFAULTS): углублён редизайном
    // 04.08 с #121110 до #0a0908, обоснование — themeVars.ts::glassBase.
    expect(v["--bg-0"]).toBe(mixHex("#0a0908", "#ff0000", 0.22));
    // Выключенная ручка — тонировки нет, даже когда цвет обложки известен
    expect(vars(DEFAULT_PREFS, { coverTint: "#ff0000" })).not.toHaveProperty("--bg-0");
  });

  it("узкое окно пережимает сайдбар независимо от настройки", () => {
    expect(vars({ ...DEFAULT_PREFS, wSidebar: 320 }, { wideSidebar: false })["--w-sidebar"]).toBe("220px");
    expect(vars({ ...DEFAULT_PREFS, wSidebar: 320 })["--w-sidebar"]).toBe("320px");
  });

  it("плотности материалов одинаковы в обеих темах — меняется только тон", () => {
    // «62 %» обязано значить одно и то же при переключении темы, иначе ползунок
    // врёт: человек настроил стекло на тёмной, включил светлую — и получил
    // другую плотность, ничего не трогая.
    const alpha = (s: string) => /, ([\d.]+)\)$/.exec(s)![1];
    const d = vars(DEFAULT_PREFS);
    const l = vars({ ...DEFAULT_PREFS, theme: "light" });
    for (const key of ["--glass-zone", "--glass-panel", "--glass-dialog", "--glass-deep"] as const) {
      expect(alpha(String(l[key])), key).toBe(alpha(String(d[key])));
    }
  });

  it("светлая тема переворачивает базы текста и стекла", () => {
    const v = vars({ ...DEFAULT_PREFS, theme: "light" });
    // Прозрачность на светлой теме ПЛОТНЕЕ, чем на тёмной, при той же ручке:
    // тёмные чернила по светлому теряют контраст быстрее. Раньше здесь стояло
    // 0.62 — то же число, что у тёмной, — и это давало 4.66:1 у второго тона и
    // 3.06:1 у третьего при норме 4.5. Замер 03.08, разбор — в шапке themeVars.
    expect(v["--text-2"]).toBe("rgba(28, 26, 23, 0.78)");
    expect(v["--text-3"]).toBe("rgba(28, 26, 23, 0.66)");
    expect(v["--glass-panel"]).toBe("rgba(253, 252, 250, 0.64)");
  });
});

/** ══ СТОРОЖ ЧИТАЕМОСТИ СТЕКЛЯННОЙ ЛЕСТНИЦЫ ══════════════════════════════
 *
 *  ЗАЧЕМ. Волна «больше стекла» (03.08) перевела на материал почти все крупные
 *  поверхности: зоны окна, центральную область, диалоги. Стекла стало больше —
 *  значит фон под текстом стал светлее (в светлой теме темнее), и это ровно то,
 *  что ломается первым. Ночной аудит уже ловил такое: текст на стекле поверх
 *  СВЕТЛОЙ обложки давал 2.80:1 и 2.28:1 при норме 4.5.
 *
 *  ЧТО СЧИТАЕМ. Композицию по WCAG 2.1 на ФАКТИЧЕСКОМ фоне, слой за слоем:
 *    сценография → материал (--glass-*) → плёнка элевации (--surface-*) → текст.
 *  Перебираются ВСЕ материалы × ВСЕ плёнки × ВСЕ текстовые ступени × обе темы ×
 *  весь ход ползунка стекла (30–100, границы — AppearancePane/GLASS_MIN).
 *
 *  ХУДШИЙ СЛУЧАЙ — БЕЛАЯ ОБЛОЖКА ПОД СТЕКЛОМ (в светлой теме — чёрная): фон
 *  приложения рисует обложку с прозрачностью 0.22 поверх --bg-0, сверху скрим
 *  «затемнения фона». Берём штатное затемнение 40 % (значение по умолчанию,
 *  prefs bgDim) — это и есть та картинка, которую видит человек, ничего не
 *  трогавший.
 *
 *  ЧЕГО СТОРОЖ НАРОЧНО НЕ ОБЕЩАЕТ. Затемнение, выкрученное в НОЛЬ, вместе с
 *  белой обложкой и стеклом на минимуме даёт 4.07:1 на выделенной строке. Это
 *  не дыра в лестнице: человек выключил ровно тот регулятор, который для этого
 *  и существует, и ни одна плотность стекла тут не спасает — светлеющая плёнка
 *  элевации поднимает фон поверх ЛЮБОГО стекла, вплоть до непрозрачного
 *  (замер: 4.23:1). Рычаг у пользователя один и он на месте — «Затемнение
 *  фона». Числа держим здесь, чтобы следующий агент не «чинил» это повторно. */
describe("стеклянная лестница — читаемость", () => {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
  const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (fg: number[], a: number, bg: number[]) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** rgba(...) из движка → [r,g,b] и альфа. */
  const parse = (s: string) => {
    const m = /rgba?\((\d+), (\d+), (\d+),? ?([\d.]+)?\)/.exec(s)!;
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4] ?? 1) };
  };

  /** Плёнки элевации — ЗЕРКАЛО packages/ui/src/tokens/glass.css. Движок их не
   *  считает (они не зависят от профиля), поэтому здесь выписаны руками: разъедутся
   *  с токенами — сторож начнёт мерить не то, что видит человек. */
  const FILMS = { "surface-1": 0.025, "surface-2": 0.04, "surface-3": 0.07, "surface-4": 0.1 };
  /** ⚠️ ink1 берётся ОТСЮДА, а не из движка: --text-1 профилем не управляется
   *  (это чистый токен ДС, свой у каждой темы), и движок его не выдаёт вовсе.
   *  Первая версия сторожа подставляла тёмный #f4f3f1 обеим темам и честно
   *  находила «1.00:1» на светлой — белое по белому, которого в жизни нет. */
  const THEMES = {
    dark: { bg0: [18, 17, 16], film: [255, 255, 255], cover: [255, 255, 255], scrim: [0, 0, 0], ink1: [244, 243, 241] },
    light: { bg0: [243, 241, 237], film: [20, 18, 15], cover: [0, 0, 0], scrim: [243, 241, 237], ink1: [28, 26, 23] },
  } as const;
  const MATERIALS = ["--glass-zone", "--glass-panel", "--glass-dialog", "--glass-deep"] as const;
  const INKS = ["--text-1", "--text-2", "--text-3"] as const;

  /** Фон-сценография: обложка 0.22 поверх --bg-0, затем скрим затемнения. */
  const scenery = (theme: keyof typeof THEMES, dim: number) => {
    const T = THEMES[theme];
    return over([...T.scrim], dim, over([...T.cover], 0.22, [...T.bg0]));
  };

  /** Худшее отношение контраста по всей лестнице при данном затемнении. */
  const worst = (dim: number) => {
    let low = { c: Infinity, where: "" };
    for (const theme of ["dark", "light"] as const) {
      for (let pct = 30; pct <= 100; pct += 2) {
        const v = vars({ ...DEFAULT_PREFS, theme, glassOpacity: pct });
        const back = scenery(theme, dim);
        for (const mat of MATERIALS) {
          const m = parse(String(v[mat]));
          const glass = over(m.rgb, m.a, back);
          const layers: [string, number[]][] = [
            ["голое стекло", glass],
            ...Object.entries(FILMS).map(([n, fa]) => [n, over([...THEMES[theme].film], fa, glass)] as [string, number[]]),
          ];
          for (const [layer, bg] of layers) {
            for (const ink of INKS) {
              const t = v[ink] ? parse(String(v[ink])) : { rgb: [...THEMES[theme].ink1], a: 1 };
              const c = ratio(over(t.rgb, t.a, bg), bg);
              if (c < low.c) low = { c, where: `${theme} стекло=${pct}% ${mat} / ${layer} / ${ink}` };
            }
          }
        }
      }
    }
    return low;
  };

  it("любой текст на любом материале и любой плёнке берёт 4.5:1 (белая обложка, штатное затемнение)", () => {
    const low = worst(0.4);
    expect(low.c, `худшее ${low.c.toFixed(2)}:1 — ${low.where}`).toBeGreaterThanOrEqual(4.5);
  });

  it("даже с выключенным затемнением фона не проваливается ниже 4:1", () => {
    // Не норма AA, а страховка от обвала: если правка формулы уведёт сюда 3:1 —
    // значит сломана сама лестница, а не выкручен пользовательский регулятор.
    const low = worst(0);
    expect(low.c, `худшее ${low.c.toFixed(2)}:1 — ${low.where}`).toBeGreaterThanOrEqual(4);
  });

  it("плотнее стекло — не хуже контраст (лестница не должна инвертироваться)", () => {
    // Смысловая проверка: ползунок «Плотность стекла» обязан быть монотонным
    // рычагом читаемости. Если добавление стекла где-то УХУДШАЕТ контраст,
    // значит материал и плёнка тянут в разные стороны — чинить, а не терпеть.
    for (const theme of ["dark", "light"] as const) {
      const back = scenery(theme, 0.4);
      let prev = -Infinity;
      for (const pct of [30, 50, 62, 80, 100]) {
        const v = vars({ ...DEFAULT_PREFS, theme, glassOpacity: pct });
        const m = parse(String(v["--glass-zone"]));
        const bg = over([...THEMES[theme].film], FILMS["surface-4"], over(m.rgb, m.a, back));
        const t = parse(String(v["--text-3"]));
        const c = ratio(over(t.rgb, t.a, bg), bg);
        expect(c, `${theme} стекло=${pct}%`).toBeGreaterThanOrEqual(prev - 0.001);
        prev = c;
      }
    }
  });
});

/** Шаг между вторым и третьим тоном = разница токенов ДС: на тёмной теме 0.62 и
 *  0.56 (шаг 0.06 — сжат волной «больше стекла», разбор у --text-3 в
 *  tokens/colors.css), на светлой 0.78 и 0.66 (шаг 0.12). Копий формулы было
 *  две (App.tsx и веб), теперь одна — этот тест сторожит и шаг, и нижний клэмп. */
describe("третий тон текста", () => {
  it("держит шаг своей темы на всём ходу ручки", () => {
    for (const [theme, step] of [["dark", 0.06] as const, ["light", 0.12] as const]) {
      for (const textDim of [40, 55, 62, 80]) {
        const v = vars({ ...DEFAULT_PREFS, theme, textDim });
        const second = Number(/, ([\d.]+)\)$/.exec(String(v["--text-2"]))![1]);
        const third = Number(/, ([\d.]+)\)$/.exec(String(v["--text-3"]))![1]);
        expect(Number((second - third).toFixed(2)), `${theme} textDim=${textDim}`).toBe(step);
      }
    }
  });

  it("ниже 0.2 не опускается — текст не растворяется совсем", () => {
    // 20 вместо прежних 30: со сжатым шагом тёмной темы (0.06) значение 30 даёт
    // 0.24 и до клэмпа не доходит вовсе — тест перестал бы проверять клэмп,
    // продолжая быть зелёным. Ручка настройки ниже 40 всё равно не опускается,
    // так что оба числа за пределами живого диапазона; берём то, что сторожит.
    expect(vars({ ...DEFAULT_PREFS, textDim: 20 })["--text-3"]).toBe("rgba(244, 243, 241, 0.20)");
  });
});

/** Веб-совместимость: клиент вправе прислать неполный срез профиля —
 *  недостающее берётся из DEFAULT_PREFS, а не ломает сборку стиля. */
describe("неполный вход", () => {
  it("считает по дефолтам всё, чего не прислали", () => {
    const v = vars({ blur: 10 });
    expect(v["--blur-glass"]).toBe("10px");
    expect(v["--glass-panel"]).toBe("rgba(28, 26, 23, 0.64)");
    expect(v["--pad-zone"]).toBe("16px");
  });

  it("пустой вход = дефолтный профиль", () => {
    expect(vars({})).toEqual(vars(DEFAULT_PREFS));
  });
});

describe("themeAttrs", () => {
  it("дефолты (тёмная/blue/soft) не оставляют атрибутов", () => {
    expect(themeAttrs(DEFAULT_PREFS)).toEqual({});
  });

  it("свой цвет акцента не превращается в data-accent (его считает движок)", () => {
    expect(themeAttrs({ ...DEFAULT_PREFS, accent: "custom" })).toEqual({});
  });

  it("непресетные значения уезжают в data-атрибуты для CSS ДС", () => {
    expect(themeAttrs({ theme: "light", accent: "red", radius: "round" })).toEqual({
      "data-theme": "light",
      "data-accent": "red",
      "data-radius": "round",
    });
  });
});
