"use client";

import { useEffect } from "react";
import { LanguageProvider } from "@muza/app";
import { ThemeRoot } from "@muza/app/theme/ThemeRoot";
import { LikesProvider } from "./likes";
import { PlayerProvider } from "./player";
import { PlaylistsProvider } from "./playlists";
import { PrefsProvider, usePrefs } from "./prefs";
import { SessionProvider } from "./session";
import { ToastProvider } from "./toast";

/** Э1 веб-паритета: тема из prefs применяется общим ThemeRoot (@muza/app) —
 *  та же механика data-атрибутов + CSS-переменных, что на десктопе. Внутри
 *  PrefsProvider, поверх всего видимого дерева (включая /login). */
function ThemedTree({ children }: { children: React.ReactNode }) {
  const { prefs } = usePrefs();
  return (
    <ThemeRoot
      theme={{
        theme: prefs.theme,
        accent: prefs.accent,
        customAccent: prefs.customAccent,
        radius: prefs.radius,
        blur: prefs.blur,
        glassOpacity: prefs.glassOpacity,
        textDim: prefs.textDim,
        fontUi: prefs.fontUi,
      }}
    >
      {children}
    </ThemeRoot>
  );
}

/** Клиентские провайдеры поверх всего дерева (в т.ч. /login — сессия нужна
 *  и там, чтобы уже вошедшего сразу увести на /home). Prefs — выше плеера:
 *  тот читает настройки эквалайзера.
 *
 *  Э0 веб-паритета: появился LanguageProvider — общие компоненты из @muza/app
 *  переводятся через useT(), а он без провайдера молча фолбэкает на
 *  DEFAULT_LANG="en". Первым таким компонентом стал PlaylistIconPicker, у
 *  которого в веб-копии строки были захардкожены по-русски.
 *
 *  И5-веб (2026-07-22): lang теперь берётся из prefs.language, а не прибит к
 *  "ru" — весь apps/web переведён на общий словарь (settings/page.tsx и
 *  компоненты страниц читают useT()), переключатель живёт в Настройках →
 *  Внешний вид ("Язык интерфейса", те же ключи, что у десктопа). */
function LocalizedTree({ children }: { children: React.ReactNode }) {
  const { prefs } = usePrefs();
  // <html lang="ru"> в app/layout.tsx фиксирован на билде (статический
  // экспорт не знает prefs.language до гидратации) — держим атрибут в
  // синхроне с реальным языком интерфейса руками, иначе скринридер и
  // переводчик браузера будут ошибаться на английском UI.
  useEffect(() => {
    document.documentElement.lang = prefs.language;
  }, [prefs.language]);
  return <LanguageProvider lang={prefs.language}>{children}</LanguageProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PrefsProvider>
        <ThemedTree>
          <LocalizedTree>
            <LikesProvider>
              <PlaylistsProvider>
                <PlayerProvider>
                  <ToastProvider>{children}</ToastProvider>
                </PlayerProvider>
              </PlaylistsProvider>
            </LikesProvider>
          </LocalizedTree>
        </ThemedTree>
      </PrefsProvider>
    </SessionProvider>
  );
}
