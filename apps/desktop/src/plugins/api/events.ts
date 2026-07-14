/** События хост→guest (эпик W8, T44). В отличие от player/library/... это НЕ
 *  req-обработчики: guest подписывается локально (Muza.Events.on в guest-
 *  рантайме), а хост широковещательно шлёт плагину те события, на которые у
 *  него есть право (EVENT_PERMISSIONS в @muza/core). Этот модуль решает, какие
 *  типы событий доступны плагину по его granted, и строит безопасный payload
 *  (метаданные без URL источников). */

import { EVENT_PERMISSIONS, type PluginPermission } from "@muza/core";

export type PluginEventType = keyof typeof EVENT_PERMISSIONS;

/** Разрешён ли плагину этот тип события по его правам. */
export function eventAllowed(granted: PluginPermission[], type: string): boolean {
  const need = EVENT_PERMISSIONS[type];
  return !!need && granted.includes(need);
}

/** Все типы событий, доступные плагину (для дешёвого предфильтра в host). */
export function allowedEventTypes(granted: PluginPermission[]): PluginEventType[] {
  return (Object.keys(EVENT_PERMISSIONS) as PluginEventType[]).filter((t) => granted.includes(EVENT_PERMISSIONS[t]));
}

/** Метаданные трека без URL/токенов источников (§3.1 дока). */
export function safeTrackPayload(
  t: { id: string; title: string; artist: string; album: string; duration: number } | null,
): { id: string; title: string; artist: string; album: string; duration: number } | null {
  if (!t) return null;
  return { id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration };
}
