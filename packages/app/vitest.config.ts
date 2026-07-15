import { defineConfig } from "vitest/config";

/** jsdom (а не node, как у @muza/core): пакет — слой ПРИЛОЖЕНИЯ, в нём живут
 *  React-компоненты, DOM и localStorage. JSX собирает esbuild по
 *  "jsx": "react-jsx" из tsconfig — плагин react тут не нужен (так же
 *  устроен apps/desktop/vitest.config.ts). */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
