import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 5 с по умолчанию у vitest не хватает под параллельной нагрузкой: три
    // теста PlaylistView падали по таймауту, а не по логике, и делали гейт
    // отката недостоверным (аудит 15.08).
    testTimeout: 15000,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
