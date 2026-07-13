"use client";

import { LikesProvider } from "./likes";
import { PlayerProvider } from "./player";
import { PlaylistsProvider } from "./playlists";
import { PrefsProvider } from "./prefs";
import { SessionProvider } from "./session";
import { ToastProvider } from "./toast";

/** Клиентские провайдеры поверх всего дерева (в т.ч. /login — сессия нужна
 *  и там, чтобы уже вошедшего сразу увести на /home). Prefs — выше плеера:
 *  тот читает настройки эквалайзера. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PrefsProvider>
        <LikesProvider>
          <PlaylistsProvider>
            <PlayerProvider>
              <ToastProvider>{children}</ToastProvider>
            </PlayerProvider>
          </PlaylistsProvider>
        </LikesProvider>
      </PrefsProvider>
    </SessionProvider>
  );
}
