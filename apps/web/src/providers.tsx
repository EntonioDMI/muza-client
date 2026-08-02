"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LanguageProvider } from "@muza/app";
import { comboFromEvent, isTypingTarget, matchAction, withDefaults } from "@muza/app/lib/hotkeys";
import { ThemeRoot } from "@muza/app/theme/ThemeRoot";
import { LikesProvider, useLikes } from "./likes";
import { PlayerProvider, usePlayer, usePosition } from "./player";
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

/** Шаг перемотки стрелками — тот же, что у приложения по умолчанию
 *  (apps/desktop DEFAULT_PREFS.seekStepSec). В вебе настройки клавиш пока нет,
 *  поэтому и биндинги берутся дефолтные: withDefaults() без сохранённых. */
const SEEK_STEP_SEC = 5;
const WEB_HOTKEYS = withDefaults();

/** Горячие клавиши веба: тот же модуль, что у приложения (@muza/app), тот же
 *  один слушатель на окно, те же дефолтные сочетания. Монтируется в layout
 *  залогиненной части — на /login клавиши плеера не нужны.
 *
 *  Чего в вебе нет и быть не может:
 *  - клавиш при неактивном окне (у приложения это тоже не сделано, но там
 *    такое хотя бы возможно) — браузер отдаёт keydown только активной вкладке;
 *    роль «клавиш при свёрнутом окне» в вебе играет Media Session (см.
 *    player.tsx: play/pause/next/prev с медиа-кнопок клавиатуры);
 *  - «?» (справка по клавишам) и Esc (закрыть очередь) — это части оболочки
 *    приложения, в вебе таких панелей нет.
 *
 *  Ctrl+K и Alt+←/→ перехватываются намеренно: у первого в браузере своего
 *  смысла нет (адресная строка вне страницы), второе — та же навигация назад/
 *  вперёд, только через роутер, без перезагрузки. */
export function AppHotkeys() {
  const player = usePlayer();
  const { position, duration } = usePosition();
  const likes = useLikes();
  const router = useRouter();

  // Слушатель ставится один раз на маунт, актуальные значения — через ref
  // (иначе замыкание держало бы позицию и очередь на момент подписки).
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  handlerRef.current = (e: KeyboardEvent) => {
    // Человек печатает — музыка не реагирует (правило общее с приложением)
    if (isTypingTarget(e.target)) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const action = matchAction(combo, WEB_HOTKEYS);
    if (!action) return;
    switch (action) {
      case "playPause":
        e.preventDefault(); // иначе страница проскроллится / нажмётся кнопка в фокусе
        player.toggle();
        break;
      case "next":
        player.next();
        break;
      case "prev":
        player.prev();
        break;
      case "seekFwd":
        if (player.current) player.seek(Math.min(position + SEEK_STEP_SEC, duration || player.current.durationSec));
        break;
      case "seekBack":
        if (player.current) player.seek(Math.max(position - SEEK_STEP_SEC, 0));
        break;
      case "mute":
        player.toggleMute();
        break;
      case "like":
        if (player.current) likes.toggle(player.current);
        break;
      case "search":
        e.preventDefault();
        router.push("/search");
        break;
      case "navBack":
        e.preventDefault();
        router.back();
        break;
      case "navForward":
        e.preventDefault();
        router.forward();
        break;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
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
