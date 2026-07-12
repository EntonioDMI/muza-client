import path from "node:path";
import type { NextConfig } from "next";

/** Веб-клиент Muza (Stage 8) — статический экспорт: деплой = папка out/ на
 *  любом статик-хостинге (muza_2 + Caddy, рядом с лендингом). Никакого SSR —
 *  всё живёт в браузере, данные ходят напрямую в muza-server.
 *
 *  ⚠️ Сборка ТОЛЬКО webpack'ом (`--webpack` в scripts): Turbopack падает на
 *  кириллическом пути рабочей папки — гоча, найденная ещё на лендинге. */
const nextConfig: NextConfig = {
  output: "export",
  // Монорепо-пакеты поставляются исходниками (jsx/ts) — Next должен их собирать
  transpilePackages: ["@muza/ui", "@muza/api-client"],
  // У пользователя в $HOME лежит чужой package-lock.json — без явного корня
  // Next принимает его за корень воркспейса
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Монорепо живёт на TypeScript 7 (tsgo) — встроенная проверка Next 16 его
  // не понимает и роняет build worker. Типы гоняет `pnpm typecheck` (tsc).
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
