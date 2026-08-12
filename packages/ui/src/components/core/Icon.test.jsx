/** СТОРОЖ ТАБЛИЦЫ ИКОНОК (переезд с lucide на Hugeicons, 12.08.2026).
 *
 *  Раньше имя иконки переводилось в PascalCase и искалось в экспортах lucide —
 *  то есть таблицы не было вовсе, и промахнуться было почти нельзя: имена и
 *  были lucide-именами. У Hugeicons своя номенклатура («Tick02Icon» вместо
 *  «Check», «Cancel01Icon» вместо «X»), поэтому появилась РУЧНАЯ таблица — а
 *  вместе с ней два новых способа сломать интерфейс молча:
 *
 *   1) добавить `<Icon name="что-то-новое" />` и забыть строку в таблице —
 *      на экране будет пустой квадрат;
 *   2) опечататься в правой части — иконка не найдётся в наборе, и будет тот
 *      же пустой квадрат.
 *
 *  Оба случая не видны ни typecheck'у, ни глазу при беглом просмотре: пустой
 *  квадрат занимает своё место в раскладке. Поэтому проверяем машинно. */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as HI from "@hugeicons/core-free-icons";
import { ICONS } from "./Icon.jsx";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Корень монорепо: packages/ui/src/components/core → ../../../../.. */
const root = path.resolve(here, "../../../../..");

/** Все имена иконок, которые РЕАЛЬНО просит код приложения и веба. */
function usedIconNames() {
  const names = new Set();
  const rx = /(?:<Icon[^>]*\bname=|\bicon:\s*|\bicon=|\biconName=|\bglyph=)\s*"([a-z0-9-]+)"/g;
  const skip = new Set(["node_modules", ".next", "dist", "out", "target", ".git", ".claude"]);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(rx)) names.add(m[1]);
      }
    }
  };
  for (const sub of ["apps", "packages"]) walk(path.join(root, sub));
  return names;
}

describe("таблица иконок", () => {
  it("каждая иконка таблицы существует в наборе Hugeicons", () => {
    const broken = Object.entries(ICONS)
      .filter(([, icon]) => icon === undefined || icon === null)
      .map(([name]) => name);

    expect(broken, `нет в @hugeicons/core-free-icons: ${broken.join(", ")}`).toEqual([]);
  });

  it("иконка — это массив путей, а не компонент (контракт @hugeicons/react)", () => {
    for (const [name, icon] of Object.entries(ICONS)) {
      expect(Array.isArray(icon), `${name} не похожа на данные иконки`).toBe(true);
    }
  });

  it("каждое имя, которое просит код, есть в таблице", () => {
    const missing = [...usedIconNames()].filter((n) => !(n in ICONS)).sort();

    // Пустой квадрат на экране вместо иконки — ровно это и означает промах.
    expect(missing, `нет строки в ICONS: ${missing.join(", ")}`).toEqual([]);
  });

  it("в таблице нет строк, которые никто не просит", () => {
    // Не поломка, но мусор: таблица должна отражать интерфейс, а не историю.
    const used = usedIconNames();
    const orphans = Object.keys(ICONS).filter((n) => !used.has(n)).sort();

    expect(orphans, `лишние строки в ICONS: ${orphans.join(", ")}`).toEqual([]);
  });

  it("lucide больше не используется нигде в исходниках", () => {
    // Смысл переезда — уйти со стокового набора целиком, а не наполовину.
    expect(HI.Tick02Icon).toBeDefined();
    expect(Object.keys(ICONS).length).toBeGreaterThan(90);
  });
});
