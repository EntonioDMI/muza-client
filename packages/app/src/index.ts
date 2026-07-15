/** @muza/app — СЛОЙ ПРИЛОЖЕНИЯ Muza: React + DOM + Prefs + i18n + вью, шелл и
 *  плеер, общие для десктопа (apps/desktop, Vite+Tauri) и веба (apps/web, Next).
 *
 *  Зачем отдельный пакет, а не @muza/core / @muza/ui:
 *  - @muza/core — чистый домен: ни React, ни DOM, ни Prefs, ни i18n; его форма
 *    делится с сервером (vitest environment: "node", react в зависимостях нет).
 *  - @muza/ui — дизайн-система, ВЕНДОРНАЯ КОПИЯ muza-design-system/project/
 *    (см. CLAUDE.md). Источник истины вне репозитория → всё, что положить туда,
 *    умрёт на следующей синхронизации вендора.
 *
 *  Правило границы: @muza/core — то, что не знает ни React, ни DOM, ни Prefs,
 *  ни i18n. @muza/app — всё остальное общее. apps/* — только точка входа, env,
 *  реализация портов платформы и роутер.
 *
 *  Направление зависимостей жёсткое: @muza/app → {ui, core, api-client}.
 *  Никогда обратно.
 *
 *  ⚠️ Никаких директив "use client" внутри пакета — клиентскую границу держат
 *  приложения (в @muza/ui их тоже нет, и веб на нём живёт). Подробности — в
 *  shell/PlaylistIconPicker.tsx.
 *
 *  Бочонок неполный НАМЕРЕННО: у пакета есть подпути в exports
 *  ("@muza/app/i18n", "@muza/app/shell/*"), чтобы webpack не тащил в бандл
 *  главной страницы то, что ей не нужно (ни один пакет монорепо не объявлял
 *  sideEffects — трясти их бандлер не умел; здесь sideEffects: ["*.css"]). */

export * from "./i18n";
export { PlaylistIconPicker } from "./shell/PlaylistIconPicker";
