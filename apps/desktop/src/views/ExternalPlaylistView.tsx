/** Пенёк: read-only страница плейлиста SoundCloud переехала в
 *  @muza/app/views/ExternalPlaylistView (волна экранов веб-паритета,
 *  2026-08-02). Касаний площадки в ней не было вовсе, поэтому переезд
 *  дословный и обёртка не нужна.
 *
 *  Файл существует, чтобы App.tsx не получил дифф в этапе, который к нему
 *  отношения не имеет. Новый код импортирует из
 *  "@muza/app/views/ExternalPlaylistView". */
export { ExternalPlaylistView } from "@muza/app/views/ExternalPlaylistView";
