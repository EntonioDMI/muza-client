"use client";

import { LanguageProvider } from "@muza/app";
import { LikesProvider } from "./likes";
import { PlayerProvider } from "./player";
import { PlaylistsProvider } from "./playlists";
import { PrefsProvider } from "./prefs";
import { SessionProvider } from "./session";
import { ToastProvider } from "./toast";

/** Клиентские провайдеры поверх всего дерева (в т.ч. /login — сессия нужна
 *  и там, чтобы уже вошедшего сразу увести на /home). Prefs — выше плеера:
 *  тот читает настройки эквалайзера.
 *
 *  Э0 веб-паритета: появился LanguageProvider — общие компоненты из @muza/app
 *  переводятся через useT(), а он без провайдера молча фолбэкает на
 *  DEFAULT_LANG="en". Первым таким компонентом стал PlaylistIconPicker, у
 *  которого в веб-копии строки были захардкожены по-русски.
 *
 *  lang прибит к "ru" НАМЕРЕННО, а не взят из prefs: сегодня весь UI веба —
 *  русский хардкодом (~3600 кириллических вхождений), и переключатель показал
 *  бы наполовину переведённый интерфейс. "ru" сохраняет ровно текущее
 *  поведение. Живым он станет в Э8, когда переводить будет уже нечего:
 *  остальные строки живут в компонентах, которые к тому времени заменятся
 *  общими из @muza/app. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PrefsProvider>
        <LanguageProvider lang="ru">
          <LikesProvider>
            <PlaylistsProvider>
              <PlayerProvider>
                <ToastProvider>{children}</ToastProvider>
              </PlayerProvider>
            </PlaylistsProvider>
          </LikesProvider>
        </LanguageProvider>
      </PrefsProvider>
    </SessionProvider>
  );
}
