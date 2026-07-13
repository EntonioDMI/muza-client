import { PLAYLIST_ICON_IDS, playlistIconUrl } from "@muza/core";

/** Валидация id иконки плейлиста (T47) против манифеста @muza/core —
 *  playlistIconUrl() сама её не делает (просто строит путь по шаблону).
 *  Нужна на рендере: playlist.icon приходит с бэка и может быть битым/из
 *  будущего манифеста (сервер обновили, клиент — ещё нет), тогда попытка
 *  показать картинку по нему даст сломанную обложку вместо фолбэка. */
const VALID_ICON_IDS = new Set<string>(PLAYLIST_ICON_IDS);

/** Src для обложки плейлиста по id иконки — null, если иконки нет или id
 *  не входит в манифест: вызывающий код должен в этом случае отрисовать
 *  прежний фолбэк (Icon "list-music"/"users"), а не битую картинку. */
export function playlistIconSrc(icon: string | null | undefined): string | null {
  if (!icon || !VALID_ICON_IDS.has(icon)) return null;
  return playlistIconUrl(icon);
}
