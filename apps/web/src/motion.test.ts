/** Движение веба — по ОБЩЕЙ шкале, а не по своим числам.
 *
 *  ЧЕМУ ЭТО СЛУЧИЛОСЬ БЫТЬ ТЕСТОМ (тот же довод, что у sharedScreen.test.ts):
 *  цена нарушения чисто визуальная, а сторож нужен дешёвый и без браузера. Ни
 *  типы, ни рендер-тест не ловят «120 мс вместо токена» и «свой кейфрейм вместо
 *  утилиты слоя»: собирается и работает и то, и другое, разница только в том,
 *  как это ощущается рядом с приложением.
 *
 *  Проверяются два стыка, которые уже разъезжались:
 *   1. переход между экранами — приход по --dur-view-in/--ease-out, и НИКАКОЙ
 *      фазы ухода: у Next App Router её не существует (разбор — в globals.css);
 *   2. полноэкранный «Сейчас играет» телефона — жизнь на .muza-layer, а не свой
 *      кейфрейм, который умел только вход. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Пути от cwd, а не от `__dirname`: vitest запускается из корня пакета
 *  (vitest.config.ts лежит рядом с app/), а `__dirname` в ESM-трансформе не
 *  гарантирован. Тот же приём, что в sharedScreen.test.ts. */
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const shell = readFileSync(join(process.cwd(), "src", "components", "AppShell.tsx"), "utf8");

/** Тело правила по селектору (первое вхождение). */
function rule(selector: string): string {
  const found = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  return found?.[1] ?? "";
}

describe("переход между экранами", () => {
  /** Класс берём из разметки, а не пишем сюда руками: тест обязан проверять
   *  ТО САМОЕ правило, которым красится <main>, а не одноимённое соседнее. */
  const cls = /<main[^>]*className="main ([\w-]+)"/.exec(shell)?.[1];

  it("экран оболочки объявляет класс прихода", () => {
    expect(cls).toBeTruthy();
  });

  it("приход играет по шкале движения, а не своим числом", () => {
    const body = rule(`.${cls}`);
    expect(body).toContain("var(--dur-view-in)");
    expect(body).toContain("var(--ease-out)"); // ПРИЛЕТАЕТ — глаз обязан поймать
    expect(body).not.toMatch(/\d+ms/);
  });

  it("фазы ухода на роутере не изобретено", () => {
    // Уход и выдержку веб получить неоткуда: к моменту, когда известен новый
    // адрес, старое дерево уже снято коммитом. Появились эти токены — значит
    // кто-то попробовал, и это надо обсуждать, а не молча мерцать экраном.
    expect(css).not.toContain("--dur-view-out");
    expect(css).not.toContain("--dur-view-hold");
  });

  it("при «меньше движения» приход выключается", () => {
    expect(css).toMatch(new RegExp(`prefers-reduced-motion[\\s\\S]*\\.${cls}\\s*\\{\\s*animation:\\s*none`));
  });
});

describe("полноэкранный «Сейчас играет» телефона", () => {
  const body = rule(".np-overlay");

  it("живёт слоем, а не собственной анимацией", () => {
    // Свой кейфрейм играл ТОЛЬКО вход — закрытие снимало экран кадром.
    expect(body).not.toContain("animation:");
  });

  it("объявляет позу сцены (из какого края — знает только разметка)", () => {
    expect(body).toContain("--layer-pose:");
  });
});
