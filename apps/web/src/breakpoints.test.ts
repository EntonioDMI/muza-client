import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BP_DESKTOP, BP_SHORT, BP_TABLET } from "@muza/app/lib/useLayoutMode";

/** СТОРОЖ ОДНОГО РЕШЕНИЯ В ДВУХ ЯЗЫКАХ.
 *
 *  «Какая сейчас раскладка» решают ДВА независимых механизма: медиа-ветки в
 *  globals.css (они красят каркас ещё до гидратации) и константы BP_* в
 *  packages/app/src/lib/useLayoutMode.ts (по ним общие экраны решают, рисовать
 *  ли компактную строку трека, стек в шапке, две колонки плиток).
 *
 *  Разъехавшись, они дадут состояние, которого нет ни в одном режиме: сетка
 *  каркаса телефонная, а строки трека десктопные — или наоборот, иконный
 *  рельс планшета рядом с нижней навигацией. Такое не ловится ни типами, ни
 *  снимками одного размера: оно живёт в узкой полосе между двумя порогами.
 *
 *  Тест не проверяет ВЁРСТКУ — только то, что оба источника называют одни и
 *  те же числа. Меняешь порог — меняй в обоих местах, иначе здесь красно. */

/** Путь считаем от рабочей папки, а НЕ от import.meta.url: vitest подменяет
 *  его на не-file схему, и fileURLToPath падает («The URL must be of scheme
 *  file»). Рабочая папка — apps/web при запуске пакетом и корень репо при
 *  запуске турбой, поэтому проверяем оба варианта. */
const cssPath = [resolve(process.cwd(), "app/globals.css"), resolve(process.cwd(), "apps/web/app/globals.css")].find(existsSync);
if (!cssPath) throw new Error("не нашёл apps/web/app/globals.css — проверь рабочую папку теста");
const css = readFileSync(cssPath, "utf8");

describe("пороги раскладки в CSS и в JS — одни и те же", () => {
  it("телефон: ветка max-width на единицу ниже BP_TABLET", () => {
    expect(css).toContain(`@media (max-width: ${BP_TABLET - 1}px)`);
  });

  it("планшет: ветка от BP_TABLET до BP_DESKTOP - 1", () => {
    expect(css).toContain(`@media (min-width: ${BP_TABLET}px) and (max-width: ${BP_DESKTOP - 1}px)`);
  });

  it("телефон на боку: порог по высоте равен BP_SHORT", () => {
    expect(css).toContain(`@media (orientation: landscape) and (max-height: ${BP_SHORT}px)`);
  });

  it("прежние пороги 699/700/899 не вернулись", () => {
    // Старая система (≤699 телефон, 700–899 планшет-портрет с сайдбаром,
    // ≤1199 две колонки) отдавала iPad 768 и iPad mini 744 десктопную
    // раскладку: сайдбар 240px, ряды настроек в столбик по одному слову.
    // Ловим возврат к ней.
    expect(css).not.toContain("max-width: 699px");
    expect(css).not.toContain("max-width: 899px");
    expect(css).not.toContain("min-width: 700px");
  });
});
