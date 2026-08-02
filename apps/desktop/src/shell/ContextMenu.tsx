/** ПЕНЁК. Транспорт контекстного меню переехал в общий пакет 2026-08-02:
 *  packages/app/src/shell/ContextMenu.tsx — тем же меню живёт веб.
 *
 *  Провайдер по умолчанию давит нативное меню площадки (WebView2), как и
 *  раньше: приложению ничего передавать не надо. Веб просит НЕ давить —
 *  отбирать у браузера его меню на сайте нельзя.
 *
 *  Новый код пусть импортирует прямо из "@muza/app/shell/ContextMenu". */
export { ContextMenuProvider, useContextMenu } from "@muza/app/shell/ContextMenu";
export type { ContextMenuApi } from "@muza/app/shell/ContextMenu";
