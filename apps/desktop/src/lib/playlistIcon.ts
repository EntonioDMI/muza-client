import { PLAYLIST_ICON_IDS, playlistIconUrl } from "@muza/core";

/** Валидация id иконки плейлиста (T47b) против манифеста @muza/core —
 *  playlistIconUrl() сама её не делает (просто строит путь по шаблону).
 *  Нужна на рендере: playlist.icon приходит с сервера и может быть битым
 *  или из будущего манифеста (сервер обновили, клиент — ещё нет); тогда
 *  попытка показать картинку по нему дала бы сломанную обложку вместо
 *  прежнего фолбэка. Та же логика есть в apps/web/src/playlistIcon.ts —
 *  манифест общий (@muza/core), но саму валидацию клиенты не шарят
 *  (см. task-T47b-brief.md, «не импортируй из web»). */
const VALID_ICON_IDS = new Set<string>(PLAYLIST_ICON_IDS);

/** Src для обложки плейлиста по id иконки — null, если иконки нет или id
 *  не входит в манифест: вызывающий код должен в этом случае отрисовать
 *  прежний фолбэк (Icon "list-music"/"users" или статичную демо-обложку). */
export function playlistIconSrc(icon: string | null | undefined): string | null {
  if (!icon || !VALID_ICON_IDS.has(icon)) return null;
  return playlistIconUrl(icon);
}
