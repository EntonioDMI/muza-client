/** Сборка PluginBridge поверх живого состояния Player (эпик W8, T44).
 *  Методы читают актуальные зависимости через ref (App обновляет его каждый
 *  рендер) — бридж строится один раз, замыкания не устаревают. Отделено от
 *  App.tsx, чтобы не раздувать его ещё на сотню строк. */

import type { MuzaApi, Track as CatalogTrack, PlaylistMeta } from "@muza/api-client";
import { fromCatalog, fromDemo, type PlayerTrack } from "../player/types";
import { TRACKS, type DemoCollection } from "../data/demo";
import type { PluginBridge } from "./types";

/** Живые зависимости бриджа — App держит это в ref и обновляет каждый рендер. */
export interface PluginBridgeLive {
  api: MuzaApi;
  canSearch: boolean;
  pb: {
    track: PlayerTrack;
    queue: PlayerTrack[];
    playing: boolean;
    buffering: boolean;
    pos: number;
    vol: number;
    toggle: () => void;
    pause: () => void;
    next: () => void;
    prev: () => void;
    seek: (sec: number) => void;
    setVol: (v: number) => void;
    setRate: (r: number) => void;
    enqueue: (tracks: PlayerTrack[], pos?: number) => void;
    removeFromQueue: (id: string) => unknown;
    reorderQueue: (from: number, to: number) => void;
    clearQueue: () => void;
    insertInQueue: (track: PlayerTrack, at: number) => void;
    index: number;
  };
  likes: string[];
  setLike: (trackId: string, on: boolean) => void;
  reloadPlaylists: () => Promise<void>;
  demoPlaylists: DemoCollection[];
  toast: (text: string, kind?: string) => void;
  openTab: (pluginId: string, tabId: string) => void;
  openPanel: (pluginId: string) => void;
  openOverlay: (pluginId: string) => void;
  closeSurface: () => void;
}

function meta(p: PlaylistMeta | DemoCollection): { id: string; name: string } {
  return { id: p.id, name: p.name };
}

export function createPluginBridge(getLive: () => PluginBridgeLive): PluginBridge {
  return {
    player: {
      getState: () => {
        const { pb } = getLive();
        const state = pb.buffering ? "loading" : pb.playing ? "playing" : "paused";
        return { state, position: pb.pos, volume: pb.vol, queue: pb.queue };
      },
      getCurrentTrack: () => getLive().pb.track ?? null,
      getQueue: () => getLive().pb.queue,
      play: () => {
        const { pb } = getLive();
        if (!pb.playing) pb.toggle();
      },
      pause: () => getLive().pb.pause(),
      next: () => getLive().pb.next(),
      prev: () => getLive().pb.prev(),
      seek: (sec) => getLive().pb.seek(sec),
      setVolume: (v) => getLive().pb.setVol(v),
      setRate: (r) => getLive().pb.setRate(r),
      enqueue: (tracks, pos) => getLive().pb.enqueue(tracks, pos),
      removeFromQueueAt: (pos) => {
        const { pb } = getLive();
        const t = pb.queue[pos];
        if (t) pb.removeFromQueue(t.id);
      },
      reorderQueue: (from, to) => getLive().pb.reorderQueue(from, to),
      clearQueue: () => getLive().pb.clearQueue(),
      playTrack: (track) => {
        const { pb } = getLive();
        pb.insertInQueue(track, pb.index + 1);
        pb.next();
      },
    },
    library: {
      getPlaylists: async () => {
        const live = getLive();
        if (live.canSearch) return (await live.api.getPlaylists()).map(meta);
        return live.demoPlaylists.map(meta);
      },
      getPlaylistTracks: async (id) => {
        const live = getLive();
        if (!live.canSearch) return [];
        const detail = await live.api.getPlaylist(id);
        return detail.tracks.map(fromCatalog);
      },
      getFavorites: async () => {
        const live = getLive();
        if (live.canSearch) return (await live.api.getFavorites()).map(fromCatalog);
        return TRACKS.filter((t) => live.likes.includes(t.id)).map(fromDemo);
      },
      createPlaylist: async (name) => {
        const live = getLive();
        if (!live.canSearch) throw new Error("internal: создание плейлиста требует серверной сессии");
        const pl = await live.api.createPlaylist(name);
        await live.reloadPlaylists();
        return meta(pl);
      },
      addToPlaylist: async (id, trackIds) => {
        const live = getLive();
        if (!live.canSearch) throw new Error("internal: требует серверной сессии");
        for (const t of trackIds) await live.api.addPlaylistTrack(id, t);
        await live.reloadPlaylists();
      },
      removeFromPlaylist: async (id, trackIds) => {
        const live = getLive();
        if (!live.canSearch) throw new Error("internal: требует серверной сессии");
        for (const t of trackIds) await live.api.removePlaylistTrack(id, t);
        await live.reloadPlaylists();
      },
      like: async (trackId) => {
        const live = getLive();
        live.setLike(trackId, true);
        if (live.canSearch && /^\d+$/.test(trackId)) await live.api.addFavorite(trackId).catch(() => undefined);
      },
      unlike: async (trackId) => {
        const live = getLive();
        live.setLike(trackId, false);
        if (live.canSearch && /^\d+$/.test(trackId)) await live.api.removeFavorite(trackId).catch(() => undefined);
      },
    },
    ui: {
      toast: (text, kind) => getLive().toast(text, kind),
      openTab: (pluginId, tabId) => getLive().openTab(pluginId, tabId),
      openPanel: (pluginId) => getLive().openPanel(pluginId),
      openOverlay: (pluginId) => getLive().openOverlay(pluginId),
      closeSurface: () => getLive().closeSurface(),
    },
    resolveTrack: async (id) => {
      const live = getLive();
      const demo = TRACKS.find((t) => t.id === id);
      if (demo) return fromDemo(demo);
      if (!live.canSearch) return null;
      try {
        return fromCatalog(await live.api.getTrack(id) as CatalogTrack);
      } catch {
        return null;
      }
    },
  };
}
