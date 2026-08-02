import { defineConfig } from "vitest/config";

/** У пакета не было тестового прогона вовсе (волна 6 добавила ~850 строк
 *  плеера, не покрытых ничем). Конфиг намеренно повторяет apps/desktop и
 *  packages/app: jsdom + тот же include, без плагина react — JSX собирает
 *  esbuild по "jsx": "react-jsx" из tsconfig.
 *
 *  Next.js в прогоне не участвует: тесты дёргают модули напрямую
 *  (src/player.tsx, src/audioFx.ts), поэтому ни next/jest, ни SWC не нужны. */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
