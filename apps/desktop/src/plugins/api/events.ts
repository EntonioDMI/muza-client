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

/** Ровно те поля трека, которые плагину можно видеть. */
export type PluginTrackFields = { id: string; title: string; artist: string; album: string; duration: number };

/** Метаданные трека без URL/токенов источников (§3.1 дока).
 *
 *  ⚠️ ЕДИНСТВЕННАЯ КОПИЯ ФИЛЬТРА — не заводить локальные `safeTrack` рядом с
 *  местом использования. До 15.08 их было четыре: здесь, в `App.tsx`, в
 *  `api/player.ts` и в `api/library.ts`; эта, документированная, оказалась
 *  единственной МЁРТВОЙ, а три живые копии могли разъехаться независимо. Всё,
 *  что уходит плагину, идёт через `pluginHost.emit` → `postMessage(…, "*")`,
 *  то есть это граница доверия: новое поле, добавленное сюда, немедленно
 *  становится видимым чужому коду.
 *
 *  Перегрузки, а не `| null` в одной сигнатуре: `library.*` отдаёт списки без
 *  дырок, и общий null-терпимый тип заставил бы дописывать `!` на каждом
 *  `.map()`. */
export function safeTrackPayload(t: PluginTrackFields): PluginTrackFields;
export function safeTrackPayload(t: PluginTrackFields | null | undefined): PluginTrackFields | null;
export function safeTrackPayload(t: PluginTrackFields | null | undefined): PluginTrackFields | null {
  if (!t) return null;
  return { id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration };
}
