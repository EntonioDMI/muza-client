import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** ЗАЧЕМ ЭТОТ ТЕСТ. Подсветка по наведению переехала из состояния React в
 *  каналы CSS, и вместе с ней туда переехали три инварианта, которые раньше
 *  держались тернарником в JSX и потому были видны глазом при чтении
 *  компонента. В CSS они держатся ПОРЯДКОМ ПРАВИЛ и СПЕЦИФИЧНОСТЬЮ — а это
 *  ровно тот сорт знания, который ломается молча: перенёс блок выше, и
 *  выделенный трек перестал отличаться от играющего, ничего при этом не упав.
 *
 *  ⚠️ Путь — от cwd, а не от import.meta.url (под vitest модуль отдаёт vite, и
 *  import.meta.url там http-адрес). Так же устроен motion.tokens.test.js. */
const find = (rel) =>
  [rel, `packages/ui/${rel}`, `../../packages/ui/${rel}`]
    .map((p) => resolve(process.cwd(), p))
    .find((p) => existsSync(p));

// CRLF нормализуем: файл правится и на Windows, а переносы строк здесь — часть
// сравниваемых селекторов, и тест не должен падать от настройки git-а.
const read = (rel) => readFileSync(find(rel), "utf8").replace(/\r\n/g, "\n");
// Комментарии вырезаем: в шапке таблицы селекторы ЦИТИРУЮТСЯ (там разбор, почему
// порядок правил и есть инвариант), и поиск по тексту находил бы цитату раньше
// самого правила — тест мерил бы порядок абзацев, а не порядок каскада.
const css = read("src/interactions.css").replace(/\/\*[\s\S]*?\*\//g, "");
const styles = read("src/styles.css");

/** Индекс объявления канала внутри правила-селектора (−1 — нет такого). */
function ruleIndex(selector) {
  return css.indexOf(selector);
}

describe("каналы наведения: подключение", () => {
  it("таблица подключена ПОСЛЕ animations.css", () => {
    // Переходы строки трека и плитки объявлены здесь, .muza-press — там.
    // Специфичность равна (0,1,0), спор решает порядок: встань мы раньше —
    // базовый transition класса перекрыл бы наш, и нажатие снова стало бы
    // симметричным, не сломав ни одного другого теста.
    const a = styles.indexOf("./animations.css");
    const b = styles.indexOf("./interactions.css");
    expect(a, "animations.css не подключён").toBeGreaterThan(-1);
    expect(b, "interactions.css не подключён").toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });
});

describe("каналы наведения: инварианты", () => {
  it("клавиатура зажигает строку и плитку наравне с мышью", () => {
    // :focus-within — не украшение, а замена ручного разбора e.relatedTarget в
    // onBlur. Уберут его — подсветка исчезнет ровно у тех, кто ходит табом.
    for (const sel of [".muza-row:hover,\n.muza-row:focus-within", ".muza-tile:hover,\n.muza-tile:focus-within"]) {
      expect(css.includes(sel), `нет пары :hover/:focus-within для ${sel.split(":")[0]}`).toBe(true);
    }
  });

  it("выделение сильнее «играет сейчас», играющий сильнее наведения", () => {
    // Все три правила весят одинаково (0,2,0) — верх берёт ПОСЛЕДНЕЕ. Значит
    // инвариант мультивыбора (2026-07-20) держится порядком строк в файле.
    const hover = ruleIndex(".muza-row:hover");
    const active = ruleIndex(".muza-row[data-active]");
    const selected = ruleIndex(".muza-row[data-selected]");
    expect(hover).toBeGreaterThan(-1);
    expect(active).toBeGreaterThan(hover);
    expect(selected).toBeGreaterThan(active);
  });

  it("строка трека и плитка объявляют переход transform — иначе нажатие мгновенное", () => {
    // .muza-press:active сбивает только длительность и кривую; сам transform
    // обязан быть в списке переходов, иначе сбивать нечего.
    const m = css.match(/\.muza-row--track,\s*\n\.muza-tile\s*\{([^}]+)\}/);
    expect(m, "нет общего правила перехода для строки трека и плитки").toBeTruthy();
    expect(m[1]).toMatch(/transform var\(--dur-press-out\)/);
    expect(m[1]).toMatch(/background var\(--dur-state\)/);
  });

  it("прозрачность аффорданса ходит в паре с кликабельностью", () => {
    // Невидимая, но кликабельная кнопка — «мёртвая» зона: попал в пустоту и
    // что-то произошло. Обе переменные обязаны переключаться одним правилом.
    const rest = css.match(/\.muza-row \{([^}]+)\}/);
    const lit = css.match(/\.muza-row:hover,\s*\n\.muza-row:focus-within \{([^}]+)\}/);
    expect(rest[1]).toMatch(/--row-aff:\s*0;/);
    expect(rest[1]).toMatch(/--row-aff-pe:\s*none;/);
    expect(lit[1]).toMatch(/--row-aff:\s*1;/);
    expect(lit[1]).toMatch(/--row-aff-pe:\s*auto;/);
  });

  it("НЕСИММЕТРИЧНОЕ НАЖАТИЕ: наш переход выигрывает у базового .muza-press", () => {
    // Единственная проверка в файле, где считает не регулярка, а сам каскад:
    // подключаем обе таблицы в том же порядке, что styles.css, и спрашиваем
    // вычисленный transition у строки трека.
    //
    // Почему это важно. Несимметричность собирается ИЗ ДВУХ ПРАВИЛ: базу (180 мс
    // на отпускание) даёт наш селектор, а `.muza-press:active` специфичностью
    // (0,2,0) сбивает её на 90 мс, пока палец внизу. Пока transition сидел
    // инлайном, второе правило не имело шанса — инлайн сильнее любого
    // авторского, — и нажатие с отпусканием шли одной длительностью.
    // ⚠️ :active в jsdom не матчится, поэтому вторая половина договора
    // проверяется по тексту animations.css: она живёт вне этой таблицы, и
    // молчаливая правка там вернула бы симметрию.
    const sheet = document.createElement("style");
    sheet.textContent = `${read("src/animations.css")}\n${read("src/interactions.css")}`;
    document.head.appendChild(sheet);
    const el = document.createElement("div");
    el.className = "muza-press muza-row muza-row--track";
    document.body.appendChild(el);

    const computed = getComputedStyle(el).transition;
    expect(computed, "базовый transform-переход строки достался .muza-press, а не нам").toContain(
      "transform var(--dur-press-out)",
    );
    expect(computed).toContain("background var(--dur-state)");

    const anim = read("src/animations.css");
    expect(anim, ".muza-press:active больше не сбивает длительность — нажатие снова симметрично").toMatch(
      /\.muza-press:active\s*\{[^}]*transition-duration:\s*var\(--dur-press-in\)/,
    );

    el.remove();
    sheet.remove();
  });

  it("у каждого канала есть значение покоя", () => {
    // Канал без объявления в состоянии покоя — это var() без фолбэка, то есть
    // невалидное значение свойства: строка красится «как получится».
    for (const [sel, names] of [
      [".muza-row \\{", ["--row-bg", "--row-aff", "--row-aff-pe"]],
      [".muza-row--track \\{", ["--row-slot-bg", "--row-slot-fg"]],
      [".muza-tile \\{", ["--tile-bg", "--tile-pill", "--tile-pill-y"]],
      [".muza-tab \\{", ["--tab-bg"]],
      [".muza-chip \\{", ["--chip-bg", "--chip-fg"]],
      [".muza-nav \\{", ["--nav-bg", "--nav-fg"]],
      [".muza-setting-row \\{", ["--setting-bg"]],
    ]) {
      const m = css.match(new RegExp(`${sel}([^}]+)\\}`));
      expect(m, `нет правила покоя ${sel}`).toBeTruthy();
      for (const n of names) expect(m[1], `${sel} не объявляет ${n}`).toContain(`${n}:`);
    }
  });
});
