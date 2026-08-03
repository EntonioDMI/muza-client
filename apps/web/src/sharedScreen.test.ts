/** Один способ гасить поле зоны — правило раскладки, а не вкусовщина.
 *
 *  globals.css («ЕДИНСТВЕННЫЙ способ погасить поле зоны») объявляет обёртку
 *  `.shared-screen`: она выключает `padding` у `.main`, и общий экран приносит
 *  свои 24px — ровно как в приложении, где `<main>` голый. Обратный приём
 *  (обнулить поле САМОГО экрана и оставить поле зоны) даёт 20px: страница
 *  выглядит почти так же, но на 4px уже и ниже.
 *
 *  ЧЕМУ ЭТО СЛУЧИЛОСЬ БЫТЬ ТЕСТОМ. Правило нарушалось молча: главная, поиск и
 *  плейлист гасили поле у экрана (`padding="0"` / `style={{ padding: 0 }}`), а
 *  библиотека, «Любимое», статистика, админка и настройки — обёрткой. Переход
 *  между этими экранами двигал ВЕСЬ контент на 4px (жалоба владельца
 *  «спейсинги неровные», 2026-08-02). Ни типы, ни рендер-тест такого не ловят:
 *  оба варианта собираются и работают, разница только в пикселях.
 *
 *  Поэтому проверка читает ИСХОДНИКИ страниц: цена нарушения — визуальная, а
 *  сторож нужен дешёвый и без браузера. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** `apps/web/app/(app)` — группа маршрутов залогиненного веба. Путь от cwd, а
 *  не от `__dirname`: vitest запускается из корня пакета (vitest.config.ts
 *  лежит рядом с app/), а `__dirname` в ESM-трансформе не гарантирован. */
const APP_DIR = join(process.cwd(), "app", "(app)");

function pageFiles(): { route: string; source: string }[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ route: e.name, path: join(APP_DIR, e.name, "page.tsx") }))
    .filter((p) => {
      try {
        readFileSync(p.path);
        return true;
      } catch {
        return false; // подпапка без своей страницы — не наш случай
      }
    })
    .map((p) => ({ route: p.route, source: readFileSync(p.path, "utf8") }));
}

describe("поле зоны у страниц (app)", () => {
  const pages = pageFiles();

  it("страницы вообще нашлись (иначе проверка зелёная впустую)", () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  it.each(pages.map((p) => p.route))("/%s заворачивает экран в .shared-screen", (route) => {
    const { source } = pages.find((p) => p.route === route)!;
    expect(source).toContain('className="shared-screen"');
  });

  it.each(pages.map((p) => p.route))("/%s не гасит поле у самого экрана", (route) => {
    const { source } = pages.find((p) => p.route === route)!;
    // именно эти две формы и разъезжались с обёрткой на 4px
    expect(source).not.toContain('padding="0"');
    expect(source).not.toMatch(/padding:\s*0\b/);
  });
});
