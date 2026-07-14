import { describe, expect, it } from "vitest";
import { scanPluginCss, scanPluginScript } from "./scan";

describe("scanPluginScript", () => {
  it("чистый код проходит", () => {
    const code = `
      window.Muza.UI.toast("hi");
      const x = [1,2,3].map((n) => n * 2);
      function f(a, b) { return a + b; }
    `;
    expect(scanPluginScript(code)).toBeNull();
  });

  it("eval() запрещён", () => {
    expect(scanPluginScript("eval('1+1')")).toMatch(/eval/);
  });

  it("new Function() запрещён", () => {
    expect(scanPluginScript("const f = new Function('return 1')")).toMatch(/Function/);
  });

  it("require() запрещён", () => {
    expect(scanPluginScript("const fs = require('fs')")).toMatch(/require/);
  });

  it("динамический import() запрещён", () => {
    expect(scanPluginScript("import('./evil.js').then(() => {})")).toMatch(/import/);
  });

  it("статический import запрещён", () => {
    expect(scanPluginScript("import x from './evil.js';")).toMatch(/import/);
  });

  it("export запрещён (плагин однофайловый) — sourceType: script рубит его ещё на парсинге", () => {
    // acorn с sourceType "script" не понимает export/import вообще — падает
    // синтаксической ошибкой раньше, чем до них доходит walker; это даже
    // строже, чем отдельная проверка ImportDeclaration (та ловит только
    // ImportExpression — динамический import(), см. тест выше)
    expect(scanPluginScript("export const x = 1;")).toMatch(/синтакс/);
  });

  it("синтаксическая ошибка -> причина отказа, не исключение", () => {
    expect(scanPluginScript("const x = ;;;")).toMatch(/синтакс/);
  });

  it("обфускация через this[eva l] НЕ ловится — честно (это второй рубеж, не защита)", () => {
    // документируем ограничение: скан не защита сама по себе (§9 дока)
    expect(scanPluginScript('this["ev"+"al"]("1+1")')).toBeNull();
  });

  it("</script запрещён (HTML-инъекция в bootstrap, security review T44)", () => {
    expect(scanPluginScript('const x = "</script><script>alert(1)</script>";')).toMatch(/script/);
  });

  it("</SCRIPT в любом регистре тоже запрещён", () => {
    expect(scanPluginScript('const x = "</SCRIPT >";')).toMatch(/script/);
  });

  it("<!-- запрещён (escaped script data state ломает парсинг тега)", () => {
    expect(scanPluginScript('const x = "<!--";')).toMatch(/<!--/);
  });
});

describe("scanPluginCss", () => {
  it("чистый CSS проходит", () => {
    expect(scanPluginCss(".foo { color: red; background: var(--surface-1); }")).toBeNull();
  });

  it("@import запрещён", () => {
    expect(scanPluginCss("@import url('https://evil.com/x.css');")).toMatch(/@import/);
  });

  it("javascript: запрещён", () => {
    expect(scanPluginCss("a { background: url(javascript:alert(1)); }")).toMatch(/javascript/);
  });

  it("внешний url() запрещён, data: разрешён", () => {
    expect(scanPluginCss("a { background: url(https://evil.com/x.png); }")).toMatch(/url/);
    expect(scanPluginCss("a { background: url(data:image/png;base64,AAAA); }")).toBeNull();
  });

  it("backslash-обфускация запрещена целиком", () => {
    expect(scanPluginCss('a { content: "\\2014"; }')).toMatch(/backslash/);
  });

  it("комментарии не обходят фильтр", () => {
    expect(scanPluginCss("@imp/**/ort url('https://evil.com/x.css');")).toMatch(/@import/);
  });
});
