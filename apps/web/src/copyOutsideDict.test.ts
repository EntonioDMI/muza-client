import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** ⚠️ ВТОРОЕ ЗРЕНИЕ СТОРОЖА: кириллица ВНЕ словарей (заведено 15.08).
 *
 *  Сторож выше хорош, и словари он держит чистыми — но ходит он только по `ru`
 *  и `en`, а это ~5 % видимого текста продукта. Всё остальное проходило мимо
 *  него, и там жил ровно тот жаргон, который он запрещает. Найденные аудитом
 *  образцы: `«ok»`/`«нет ответа»` зашиты по-русски в копируемой сводке
 *  диагностики; `«Вернуть исходный»` — в подсказке компонента ДС, рядом с
 *  английским `aria-label` того же узла.
 *
 *  ЧТО ИМЕННО ЛОВИМ. Кириллический литерал, переданный в проп, который
 *  становится ВИДИМЫМ или ОЗВУЧИВАЕМЫМ текстом (`label`, `title`, `placeholder`,
 *  `hint`, `aria-label`). Это узкий и проверяемый признак: имена ключей,
 *  комментарии и обычные переменные под него не попадают.
 *
 *  ЧЕГО НЕ ЛОВИМ И ПОЧЕМУ. Сам каталог словарей (`i18n/`) — там кириллица и
 *  должна быть. Тесты — в них русские строки это фикстуры. Крашскрин
 *  (`ErrorBoundary`) — у него своя карта ru/en намеренно: i18n может быть сама
 *  причиной падения. `settingsIndex` — там русские слова это синонимы ПОИСКА,
 *  они никогда не рисуются.
 *
 *  Сторож даёт список нарушений целиком, а не первое: правится это волной. */
const L10N_PROPS = ["label", "title", "placeholder", "hint", "aria-label", "ariaLabel"];
const CYRILLIC_PROP_RE = new RegExp(
  String.raw`\b(${L10N_PROPS.join("|")})\s*=\s*(?:"([^"]*[а-яё][^"]*)"|\{\s*"([^"]*[а-яё][^"]*)"\s*\})`,
  "i",
);

/** Комментарии из исходника — прочь, номера строк — на месте.
 *
 *  ⚠️ Без этого сторож ловит сам разговор о коде. Проверено на себе в тот же
 *  день: комментарий, объясняющий, ПОЧЕМУ убрана кнопка `aria-label="Режим
 *  прослушивания"`, был опознан как нарушение. Ровно та же слабость есть у
 *  детектора impeccable — он находил `<img>` внутри комментариев в трёх местах.
 *  Сторож, который врёт, чинят не ослаблением правила, а вырезанием шума.
 *
 *  Содержимое заменяется пробелами, переводы строк сохраняются — иначе адрес
 *  в отчёте поехал бы, а адрес здесь и есть вся польза. */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank) // блочные, включая {/* … */} в JSX
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length))); // строчные, не трогая "://"
}

const L10N_SCAN_ROOTS = ["packages/app/src", "packages/ui/src", "apps/desktop/src"];
/** Осознанные исключения — каждое с причиной в шапке выше. */
const L10N_SKIP = [/[\/]i18n[\/]/, /\.test\.[jt]sx?$/, /ErrorBoundary\.tsx$/, /settingsIndex\.ts$/];

describe("видимый текст не зашит мимо словаря", () => {
  it("ни одного кириллического литерала в l10n-пропах", () => {
    // Корень клиента: этот файл лежит в packages/app/src/i18n.
    const root = resolve(import.meta.dirname, "../../..");
    const found: string[] = [];

    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const it of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, it.name);
        if (it.isDirectory()) {
          if (it.name === "node_modules" || it.name === "dist") continue;
          walk(p);
          continue;
        }
        if (!/\.(tsx|jsx)$/.test(it.name)) continue;
        const rel = relative(root, p);
        if (L10N_SKIP.some((re) => re.test(rel))) continue;
        const src = stripComments(readFileSync(p, "utf8"));
        src.split("\n").forEach((line: string, i: number) => {
          const m = CYRILLIC_PROP_RE.exec(line);
          if (m) found.push(`${rel.split(sep).join("/")}:${i + 1} [${m[0].trim().slice(0, 70)}]`);
        });
      }
    };
    for (const r of L10N_SCAN_ROOTS) walk(join(root, r));

    expect(found.sort(), "видимый текст обязан приезжать из словаря — заведи ключ и позови t()").toEqual([]);
  });
});
