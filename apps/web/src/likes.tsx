"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Track } from "@muza/api-client";
import { getApi } from "./api";
import { useSession } from "./session";

/** Лайки как общий контекст: сердечко в списках, «Любимое» и плеер-бар
 *  смотрят на один Set. Optimistic-переключение с откатом — как на десктопе. */

interface LikesCtx {
  likedIds: Set<string>;
  favorites: Track[];
  toggle: (track: Track) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<LikesCtx | null>(null);

export function LikesProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const list = await getApi().getFavorites();
      setFavorites(list);
      setLikedIds(new Set(list.map((t) => t.id)));
    } catch {
      /* сервер недоступен — оставляем что было */
    }
  }, []);

  useEffect(() => {
    if (session) void refresh();
    else {
      setFavorites([]);
      setLikedIds(new Set());
    }
  }, [session, refresh]);

  const toggle = useCallback(
    (track: Track) => {
      const liked = likedIds.has(track.id);
      // optimistic: интерфейс отвечает мгновенно, сервер — следом
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (liked) next.delete(track.id);
        else next.add(track.id);
        return next;
      });
      setFavorites((prev) => (liked ? prev.filter((t) => t.id !== track.id) : [track, ...prev]));
      const call = liked ? getApi().removeFavorite(track.id) : getApi().addFavorite(track.id);
      call.catch(() => {
        // откат: сервер не принял
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (liked) next.add(track.id);
          else next.delete(track.id);
          return next;
        });
        setFavorites((prev) => (liked ? [track, ...prev] : prev.filter((t) => t.id !== track.id)));
      });
    },
    [likedIds],
  );

  return <Ctx.Provider value={{ likedIds, favorites, toggle, refresh }}>{children}</Ctx.Provider>;
}

export function useLikes(): LikesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLikes вне LikesProvider");
  return ctx;
}
