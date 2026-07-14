/** Статик-скан плагина (эпик W8, T44) — общий клиент/сервер модуль:
 *  AST-скан entry.js (acorn) + CSS-скан (переиспользует правила
 *  muza-server/src/market/theme-scan.ts::scanThemeCss — репозитории
 *  раздельные, общий npm-пакет не шарится, сервер держит свою копию
 *  правил, T45 сверяет их с этим файлом при портировании).
 *
 *  ⚠️ Это ВТОРОЙ рубеж, не защита сама по себе: настоящая защита уровня 1 —
 *  песочница (iframe sandbox без allow-same-origin, CSP connect-src 'none').
 *  Скан ловит только явные eval/Function/import/require — обфускацию
 *  (например, `this["ev"+"al"]`) не ловит и не обязан: даже если плагин
 *  обойдёт скан, сам код всё равно исполняется в opaque-origin песочнице
 *  без доступа к DOM хоста и без сети в обход Muza.Net.
 *  См. §6.2, §9 дизайн-дока. */

import { parse } from "acorn";

const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_CSS_BYTES = 100 * 1024;

interface AstNode {
  type?: string;
  [key: string]: unknown;
}

const SKIP_KEYS = new Set(["loc", "start", "end", "range", "parent"]);

function isNode(value: unknown): value is AstNode {
  return !!value && typeof value === "object" && typeof (value as AstNode).type === "string";
}

/** Обход дерева acorn без внешнего walker'а (дерево — простой JSON-подобный
 *  объект: рекурсия по собственным свойствам-узлам и массивам узлов). */
function walkNode(node: unknown, visit: (n: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkNode(item, visit);
    return;
  }
  if (!isNode(node)) return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const val = (node as Record<string, unknown>)[key];
    if (Array.isArray(val) || isNode(val)) walkNode(val, visit);
  }
}

/** Скан JS entry-точки; null — чисто, строка — причина отказа (для UI
 *  согласия/publish-отчёта). Запрещает: eval(...), new Function(...),
 *  require(...), статический import и динамический import(...) — плагин
 *  всегда однофайловый, внешних зависимостей нет по определению. */
export function scanPluginScript(code: string): string | null {
  if (new TextEncoder().encode(code).length > MAX_SCRIPT_BYTES) {
    return "entry: файл больше 512 КБ";
  }
  // Доп. рубеж поверх CSP (security review T44): entry_code вставляется как
  // сырой текст внутри <script> в bootstrap-документе плагина без экранирования
  // (plugins.rs::build_bootstrap_response) — литеральный </script прерывает тег
  // раньше времени, а <!-- переводит HTML-парсер в escaped script data state,
  // из-за чего последующий реальный </script> может не сработать как ожидается.
  // Оба ловим здесь текстово, до AST-парсинга.
  if (/<\/script/i.test(code) || code.includes("<!--")) {
    return "entry: запрещены литералы </script или <!-- (HTML-инъекция в bootstrap-документ)";
  }
  let ast: unknown;
  try {
    ast = parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
  } catch (e) {
    return `entry: синтаксическая ошибка (${e instanceof Error ? e.message : "parse error"})`;
  }
  let bad: string | null = null;
  walkNode(ast, (node) => {
    if (bad) return;
    const type = node.type;
    if (type === "CallExpression") {
      const callee = node.callee as AstNode | undefined;
      if (callee?.type === "Identifier") {
        const name = callee.name as string;
        if (name === "eval") bad = "entry: запрещён вызов eval()";
        else if (name === "require") bad = "entry: запрещён require() — плагин однофайловый";
      }
    } else if (type === "NewExpression") {
      const callee = node.callee as AstNode | undefined;
      if (callee?.type === "Identifier" && callee.name === "Function") {
        bad = "entry: запрещён new Function()";
      }
    } else if (type === "ImportExpression") {
      bad = "entry: запрещён динамический import() — плагин однофайловый";
    } else if (
      type === "ImportDeclaration" ||
      type === "ExportNamedDeclaration" ||
      type === "ExportDefaultDeclaration" ||
      type === "ExportAllDeclaration"
    ) {
      bad = "entry: запрещены import/export — плагин однофайловый";
    }
  });
  return bad;
}

/** Опасные конструкции CSS — копия правил scanThemeCss (сервер). */
const CSS_FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /@import\b/, why: "@import (загрузка внешнего CSS)" },
  { re: /expression\s*\(/, why: "expression() (исполнение кода)" },
  { re: /javascript\s*:/, why: "javascript: (исполнение кода)" },
  { re: /<\s*script/, why: "<script (HTML-инъекция)" },
  { re: /behavior\s*:/, why: "behavior: (исполнение кода, IE)" },
  { re: /-moz-binding\s*:/, why: "-moz-binding (исполнение кода)" },
];
const CSS_URL = /url\s*\(\s*(['"]?)\s*([^'")]*)/g;

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Скан CSS плагина (contributes.css и UI.applyCss); null — чисто. */
export function scanPluginCss(rawCss: string): string | null {
  if (new TextEncoder().encode(rawCss).length > MAX_CSS_BYTES) {
    return "css: файл больше 100 КБ";
  }
  if (rawCss.includes("\\")) {
    return "css: backslash-escape запрещён (обфускация)";
  }
  const css = stripCssComments(rawCss).toLowerCase();
  for (const { re, why } of CSS_FORBIDDEN) {
    if (re.test(css)) return `css: ${why}`;
  }
  for (const m of css.matchAll(CSS_URL)) {
    const target = m[2].trim();
    if (target && !target.startsWith("data:")) {
      return "css: url() допустим только с data: (внешние адреса — утечка)";
    }
  }
  return null;
}
