"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Track } from "@muza/api-client";
import { QK } from "@muza/app/lib/queryClient";
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

  /** ⚠️ ОДИН ЗАПРОС ВМЕСТО ТРЁХ (12.08). Открытие «Любимого» стоило ТРИ полных
   *  GET /me/favorites подряд: этот провайдер грузил список при появлении
   *  сессии, страница дёргала refresh() в своём эффекте, а сам экран —
   *  собственный запрос, потому что ссылка на массив лайков менялась. Все три
   *  ходили за одним и тем же (до 500 треков с аннотациями).
   *
   *  Теперь список живёт под общим ключом QK.favorites: и провайдер, и экран
   *  берут его оттуда, повторный вызов схлопывается в один поход в сеть.
   *
   *  Локальное состояние остаётся: оптимистичное переключение сердечка обязано
   *  отвечать мгновенно и уметь откатываться, а кэш запроса — про то, что
   *  сказал сервер. Смешивать эти две правды в одном месте нельзя. */
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: QK.favorites,
    queryFn: () => getApi().getFavorites(),
    enabled: !!session,
    throwOnError: false,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QK.favorites });
  }, [queryClient]);

  useEffect(() => {
    if (!session) {
      setFavorites([]);
      setLikedIds(new Set());
      return;
    }
    // Сервер недоступен — data не приедет, и мы оставляем что было (прежнее
    // поведение молчаливого catch сохранено).
    if (!data) return;
    setFavorites(data);
    setLikedIds(new Set(data.map((t) => t.id)));
  }, [session, data]);

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
