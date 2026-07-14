/** API-модуль Muza.Library (эпик W8, T44): чтение и запись библиотеки.
 *  Реализация поверх bridge.library (App.tsx → api-client). Треки отдаём
 *  метаданными без URL источников. */

import type { PluginApiContext, PluginApiModule } from "../types";

function arg(args: unknown): Record<string, unknown> {
  return (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
}
function str(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`bad_args: ${name} — строка`);
  return v;
}
function strArr(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`bad_args: ${name} — массив строк`);
  return v as string[];
}
function safeTrack(t: { id: string; title: string; artist: string; album: string; duration: number }) {
  return { id: t.id, title: t.title, artist: t.artist, album: t.album, duration: t.duration };
}

export const libraryApi: PluginApiModule = {
  "library.getPlaylists": ({ bridge }: PluginApiContext) => bridge.library.getPlaylists(),
  "library.getPlaylistTracks": async ({ bridge }, args) => {
    const tracks = await bridge.library.getPlaylistTracks(str(arg(args).id, "id"));
    return tracks.map(safeTrack);
  },
  "library.getFavorites": async ({ bridge }) => (await bridge.library.getFavorites()).map(safeTrack),
  "library.createPlaylist": ({ bridge }, args) => bridge.library.createPlaylist(str(arg(args).name, "name")),
  "library.addToPlaylist": ({ bridge }, args) => {
    const a = arg(args);
    return bridge.library.addToPlaylist(str(a.id, "id"), strArr(a.trackIds, "trackIds"));
  },
  "library.removeFromPlaylist": ({ bridge }, args) => {
    const a = arg(args);
    return bridge.library.removeFromPlaylist(str(a.id, "id"), strArr(a.trackIds, "trackIds"));
  },
  "library.like": ({ bridge }, args) => bridge.library.like(str(arg(args).trackId, "trackId")),
  "library.unlike": ({ bridge }, args) => bridge.library.unlike(str(arg(args).trackId, "trackId")),
};
