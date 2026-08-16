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
    // 5 с по умолчанию у vitest не хватает под параллельной нагрузкой: три
    // теста PlaylistView падали по таймауту, а не по логике, и делали гейт
    // отката недостоверным (аудит 15.08).
    testTimeout: 15000,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
