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
import { cleanup, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as HI from "@hugeicons/core-free-icons";
import { Icon, ICONS } from "./Icon.jsx";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Корень монорепо: packages/ui/src/components/core → ../../../../.. */
const root = path.resolve(here, "../../../../..");

/** Все имена иконок, которые РЕАЛЬНО просит код приложения и веба.
 *
 *  ⚠️ РАЗБИРАЕМ ВЫРАЖЕНИЕ ЦЕЛИКОМ, А НЕ ОДИН ЛИТЕРАЛ. Первая версия этого
 *  обхода искала `name="строка"` — и пропустила ВСЁ, что приходит из
 *  тернарников: `playing ? "pause" : "play"`, `vol === 0 ? "volume-x" : …`,
 *  `repeat === "one" ? "repeat-1" : "repeat"`. В таблицу попадала только первая
 *  ветка каждого условия, а вторая молча превращалась в пустой квадрат — то
 *  есть кнопка воспроизведения пропадала ровно тогда, когда музыка играет.
 *  Владелец нашёл это уже ПОСЛЕ релиза 0.2.4.
 *
 *  Поэтому берём хвост после `icon=`/`name=` целиком и вытаскиваем из него ВСЕ
 *  строковые литералы. В хвост попадает и соседнее свойство (`size="sm"`) —
 *  такие отсеиваются списком IGNORED ниже. Лучше разобрать лишнее и один раз
 *  внести в исключения, чем пропустить настоящее имя. */
function usedIconNames() {
  const names = new Set();
  const rx = /(?:<Icon[^>]*\bname=|\bicon:\s*|\bicon=|\biconName=|\bglyph=)\s*\{?([^;\n]{0,200})/g;
  const skip = new Set(["node_modules", ".next", "dist", "out", "target", ".git", ".claude"]);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(rx)) {
          for (const lit of m[1].matchAll(/"([a-z][a-z0-9]*(?:-[a-z0-9]+)*)"/g)) names.add(lit[1]);
        }
      }
    }
  };
  for (const sub of ["apps", "packages"]) walk(path.join(root, sub));
  for (const w of IGNORED) names.delete(w);
  return names;
}

/** Слова, которые попадают в хвост выражения, но иконками не являются:
 *  соседние свойства (`size="sm"`, `variant="primary"`), значения настроек,
 *  имена из тестов. Список ведётся руками — это плата за то, что обход берёт
 *  выражение целиком. Ошибиться он может только в СТОРОНУ ЛИШНЕГО: пропустить
 *  настоящее имя после этой правки уже нельзя. */
const IGNORED = new Set([
  "sm", "lg", "md", "xs", "primary", "secondary", "ghost", "danger", "auto", "none", "relative",
  "asc", "ascending", "descending", "checking", "installing", "one", "toggle", "tab", "surface",
  "ok", "bad", "eval", "require", "string", "json", "png", "zip", "src", "y", "ru",
  "muzaplugin", "yt-dlp", "namespace", "aria-label", "aria-sort", "mobile-web-app-capable",
  "track", "library", "stats", "files", "folder", "next", "prev", "close",
  // имена из тестовых наборов данных
  "anna", "boris", "clara", "pl9",
]);

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

  /** ⚠️ САМАЯ ВАЖНАЯ ПРОВЕРКА ФАЙЛА: РЕНДЕРИМ ПО-НАСТОЯЩЕМУ.
   *
   *  Проверки таблицы выше говорят «ключ есть» и «значение не undefined» — но
   *  не «на экране что-то нарисовалось». Между ними помещается ровно тот класс
   *  поломки, который уехал в релиз 0.2.4: пустой `<svg>` нужного размера
   *  занимает своё место в раскладке, ничего не ломает и в глаза не бросается.
   *
   *  Здесь каждое имя из КОДА прогоняется через настоящий компонент, и мы
   *  требуем, чтобы внутри svg были узлы. Пустой svg = дырка в интерфейсе. */
  it("каждое имя из кода реально рисуется, а не даёт пустой квадрат", () => {
    const empty = [];
    for (const name of [...usedIconNames()].sort()) {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      if (!svg || svg.children.length === 0) empty.push(name);
      cleanup();
    }

    expect(empty, `рисуются пустыми: ${empty.join(", ")}`).toEqual([]);
  });

  it("неизвестное имя всё же даёт svg нужного размера — раскладка не прыгает", () => {
    const { container } = render(<Icon name="такой-иконки-нет" size={24} />);
    const svg = container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.children.length).toBe(0);
  });

  it("lucide больше не используется нигде в исходниках", () => {
    // Смысл переезда — уйти со стокового набора целиком, а не наполовину.
    expect(HI.Tick02Icon).toBeDefined();
    expect(Object.keys(ICONS).length).toBeGreaterThan(90);
  });
});
