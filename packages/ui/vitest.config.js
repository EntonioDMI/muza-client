import { defineConfig } from "vitest/config";

/** jsdom: пакет — чистый React/DOM без бизнес-логики, проверять тут нечего,
 *  кроме поведения в дереве (фокус, обходы Tab, роли). JSX собирает esbuild
 *  автоматическим рантаймом — плагин react не нужен (так же устроены
 *  packages/app и apps/desktop).
 *  Пакет на чистом JS, поэтому include по .jsx, а не .tsx. */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{js,jsx}"],
    // globals — РАДИ АВТОУБОРКИ @testing-library/react: она вешает
    // afterEach(cleanup) только если afterEach лежит в глобалах. Без этого
    // отрендеренные деревья копятся в document.body между тестами, и запросы
    // вроде getByRole падают на «found multiple elements» — тест видит чужой
    // DOM, а не свой. Соседние пакеты (packages/app, apps/desktop) globals не
    // включают, потому что там cleanup зовут руками в каждом файле.
    globals: true,
  },
});
