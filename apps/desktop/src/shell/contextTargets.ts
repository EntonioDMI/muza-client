/** ПЕНЁК. Цели контекстного меню переехали в общий пакет 2026-08-02:
 *  packages/app/src/shell/contextTargets.ts — тем же меню живёт веб.
 *
 *  Здесь остались только ре-экспорты, чтобы приложение переезда не заметило.
 *  Новый код пусть импортирует прямо из "@muza/app/shell/ContextMenu"
 *  (у соседних .ts-модулей общего пакета своих подпутей пока нет — см. шапку
 *  ContextMenu.tsx там).
 *
 *  Формы локального файла и трека очереди в общем пакете описаны СТРУКТУРНО:
 *  десктопные LocalEntry (lib/localFiles.ts) и PlayerTrack (player/types.ts)
 *  подходят в них как есть — конвертировать ничего не нужно. */
export type { ContextTarget, TrackPlace } from "@muza/app/shell/ContextMenu";
