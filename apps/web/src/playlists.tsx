"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { PlaylistMeta } from "@muza/api-client";
import { getApi } from "./api";
import { useSession } from "./session";

/** Плейлисты как общий контекст (как лайки в likes.tsx): сайдбар AppShell,
 *  «В плейлист…» из TrackList и страницы библиотеки/плейлиста смотрят на
 *  один список — CRUD-действие на любой странице сразу видно везде,
 *  без прокидывания колбэков через пропсы. */

interface PlaylistsCtx {
  playlists: PlaylistMeta[];
  /** Первая загрузка ещё не завершилась (для «Загрузка…» в местах, где
   *  список нужен сразу, до того как AppShell успел его подтянуть). */
  loaded: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PlaylistsCtx | null>(null);

export function PlaylistsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const [playlists, setPlaylists] = useState<PlaylistMeta[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await getApi().getPlaylists();
      setPlaylists(list);
    } catch {
      /* сервер недоступен — оставляем что было */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (session) void refresh();
    else {
      setPlaylists([]);
      setLoaded(false);
    }
  }, [session, refresh]);

  return <Ctx.Provider value={{ playlists, loaded, refresh }}>{children}</Ctx.Provider>;
}

export function usePlaylists(): PlaylistsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlaylists вне PlaylistsProvider");
  return ctx;
}
