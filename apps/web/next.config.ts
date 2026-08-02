import path from "node:path";
import type { NextConfig } from "next";

/** Веб-клиент Muza (Stage 8) — статический экспорт: деплой = папка out/ на
 *  любом статик-хостинге (muza_2 + Caddy, рядом с лендингом). Никакого SSR —
 *  всё живёт в браузере, данные ходят напрямую в muza-server.
 *
 *  ⚠️ ПРОД-СБОРКА — только webpack (`--webpack` в scripts.build): Turbopack
 *  падал на кириллическом пути рабочей папки (гоча, найденная ещё на лендинге).
 *  Для СБОРКИ это не перепроверялось — не трогать без отдельного прогона.
 *
 *  Режим разработки переведён на Turbopack 2026-08-02. Старая гоча на Next
 *  16.2.10 больше не воспроизводится: dev поднимается из этой самой папки с
 *  кириллицей, все экраны рендерятся, ошибок в консоли нет (проверено живьём).
 *  Причина перевода — жалоба владельца «вкладки открываются долго»; замер на
 *  холодном сервере, первый заход на каждую вкладку, Edge:
 *    webpack   /login 11086 мс, дальше 2.4-4.3 с, всего 22.6 с на пять вкладок
 *    turbopack /login  4364 мс, дальше 1.4-1.6 с, всего 10.3 с
 *  Это ТОЛЬКО разработка: у пользователя на app.muza.lol компиляции нет вовсе —
 *  там статический экспорт, всё собрано заранее. */
const nextConfig: NextConfig = {
  output: "export",
  // Монорепо-пакеты поставляются исходниками (jsx/ts) — Next должен их собирать
  transpilePackages: ["@muza/ui", "@muza/api-client", "@muza/core", "@muza/app"],
  // У пользователя в $HOME лежит чужой package-lock.json — без явного корня
  // Next принимает его за корень воркспейса
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Монорепо живёт на TypeScript 7 (tsgo) — встроенная проверка Next 16 его
  // не понимает и роняет build worker. Типы гоняет `pnpm typecheck` (tsc).
  typescript: { ignoreBuildErrors: true },
  // ТОЛЬКО dev: прокси /api → muza-server, чтобы веб мог работать same-origin
  // (нужно окружениям, где localhost:8000 недоступен напрямую — например,
  // агентский браузер-пейн видит только порт dev-сервера). Включается парой
  // с `NEXT_PUBLIC_API_URL=http://localhost:<dev-порт>/api` в apps/web/.env.local
  // (gitignored). Относительный `/api` НЕ работает: resolveApiBaseUrl
  // (api-client) принимает только абсолютный http(s)-URL и на `/api` роняет
  // каждый рендер в 500 «forbidden parts» — same-origin достигается адресом
  // самого dev-сервера, запрос всё равно уходит в rewrite ниже.
  // ⚠️ .env.local влияет и на `next build` — НЕ держи его постоянно, иначе
  // прод-экспорт запечёт localhost вместо настоящего адреса API (rewrites в
  // статическом экспорте не работают by design; гард NODE_ENV ниже убирает
  // даже предупреждение сборки).
  ...(process.env.NODE_ENV !== "production"
    ? {
        rewrites: async () => [
          { source: "/api/:path*", destination: "http://localhost:8000/api/:path*" },
        ],
      }
    : {}),
};

export default nextConfig;
