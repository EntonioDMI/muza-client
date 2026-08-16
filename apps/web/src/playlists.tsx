"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PlaylistMeta } from "@muza/api-client";
import { useT } from "@muza/app";
import { moveItem } from "@muza/app/lib/dragEngine";
import { getApi } from "./api";
import { usePlayer } from "./player";
import { useSession } from "./session";
import { useToast } from "./toast";
import { humanError } from "@muza/api-client";

/** Плейлисты как общий контекст (как лайки в likes.tsx): сайдбар AppShell,
 *  «В плейлист…» и страницы библиотеки/плейлиста смотрят на один список —
 *  CRUD-действие на любой странице сразу видно везде, без прокидывания
 *  колбэков через пропсы. */

interface PlaylistsCtx {
  playlists: PlaylistMeta[];
  /** Первая загрузка ещё не завершилась (для «Загрузка…» в местах, где
   *  список нужен сразу, до того как AppShell успел его подтянуть). */
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Переставить плейлист за ручку-⠿ (боковая панель и плитки медиатеки —
   *  один и тот же порядок). Применяется оптимистично и уезжает на сервер. */
  reorder: (draggedId: string, toIndex: number) => Promise<void>;
}

const Ctx = createContext<PlaylistsCtx | null>(null);

export function PlaylistsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const notify = useToast();
  const { t } = useT();
  const [playlists, setPlaylists] = useState<PlaylistMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Живой список для обработчиков жеста: два быстрых перетаскивания подряд не
   *  должны считаться от одного и того же кадра состояния. */
  const listRef = useRef<PlaylistMeta[]>(playlists);
  listRef.current = playlists;

  const apply = useCallback((list: PlaylistMeta[]) => {
    listRef.current = list;
    setPlaylists(list);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await getApi().getPlaylists());
    } catch {
      /* сервер недоступен — оставляем что было */
    } finally {
      setLoaded(true);
    }
  }, [apply]);

  /** Новый порядок после перетаскивания за ручку-⠿.
   *
   *  ЖИВЁТ ЗДЕСЬ, А НЕ У ЭКРАНОВ. Ручка есть и у строк боковой панели, и у
   *  плиток медиатеки, порядок у них ОДИН — и до 2026-08-03 этот расчёт стоял
   *  дословной копией в двух местах (AppShell.tsx и app/(app)/library/page.tsx),
   *  вместе с оптимистичным состоянием и его сбросом. Две копии одного
   *  инварианта — это две возможности разъехаться.
   *
   *  ⚠️ toIndex приходит в координатах УРЕЗАННОГО списка: в перетаскивание
   *  отдаются только подвижные строки (подписки и закреплённые исключены).
   *  Складывать его с позицией из ПОЛНОГО списка нельзя — промах равен числу
   *  исключённых, а закреплённые всегда сверху, так что промах гарантирован:
   *  сдвиг на позицию молча не даёт ничего, а испорченный порядок уходит на
   *  сервер и переживает перезапуск (эту ошибку чинили в приложении
   *  2026-08-02, App.tsx → reorderPlaylists). */
  const reorder = useCallback(
    async (draggedId: string, toIndex: number) => {
      const list = listRef.current;
      const movable = list.filter((p) => p.role !== "follower" && !p.pinned);
      const from = movable.findIndex((p) => p.id === draggedId);
      if (from < 0 || from === toIndex || toIndex < 0 || toIndex >= movable.length) return;
      const moved = moveItem(movable, from, toIndex);
      // Неподвижные остаются на СВОИХ местах в общем списке, подвижные
      // перетасовываются только между своими слотами.
      let k = 0;
      const next = list.map((p) => (p.role !== "follower" && !p.pinned ? moved[k++] : p));
      apply(next); // оптимистично: строка встаёт на место до ответа сервера
      try {
        await getApi().reorderPlaylists(next.map((p) => p.id));
      } catch (e) {
        // Откат был, объяснения не было: строка молча прыгала назад, и человек
        // не мог отличить «не сохранилось» от «промахнулся мимо слота».
        // Приложение в том же случае говорит (PlaylistView.tsx:364).
        void refresh(); // не сохранилось — вернём серверный порядок
        notify(humanError(e, t("views.playlist.reorderFailed")), "x");
      }
    },
    [apply, refresh, notify, t],
  );

  useEffect(() => {
    if (session) void refresh();
    else {
      apply([]);
      setLoaded(false);
    }
  }, [session, refresh, apply]);

  return <Ctx.Provider value={{ playlists, loaded, refresh, reorder }}>{children}</Ctx.Provider>;
}

export function usePlaylists(): PlaylistsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlaylists вне PlaylistsProvider");
  return ctx;
}

/** «Слушать плейлист» — из меню плитки медиатеки И из меню строки боковой
 *  панели. Состав плейлиста ни один из этих экранов не держит, поэтому берём
 *  его на месте и отдаём общему плееру.
 *
 *  ХУК, А НЕ ЧАСТЬ КОНТЕКСТА: провайдер плейлистов стоит ВЫШЕ плеера и тостов
 *  (providers.tsx) и позвать их не может, а хук зовёт потребитель — он-то уже
 *  внутри всех провайдеров. Пустой плейлист играть нечем — говорим об этом,
 *  а не молчим. */
export function usePlayPlaylist(): (id: string) => Promise<void> {
  const { playContext } = usePlayer();
  const notify = useToast();
  const { t } = useT();
  return useCallback(
    async (id: string) => {
      try {
        const detail = await getApi().getPlaylist(id);
        if (detail.tracks.length === 0) {
          notify(t("views.playlist.empty"), "x");
          return;
        }
        playContext(detail.tracks, 0);
      } catch (e) {
        // общий текст неудачи (views.playlist.loadFailed) — тот же, что в приложении
        notify(humanError(e, t("views.playlist.loadFailed")), "x");
      }
    },
    [playContext, notify, t],
  );
}
