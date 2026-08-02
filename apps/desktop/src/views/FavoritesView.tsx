/** Пенёк-обёртка: «Любимое» переехало в @muza/app (волна экранов веб-паритета,
 *  2026-08-02) — тот же экран теперь рисует и веб (/favorites). App.tsx зовёт
 *  этот файл ровно как раньше, теми же пропами; ни одного узла DOM обёртка не
 *  добавляет.
 *
 *  Обёртка доставляет общему экрану два приложенческих умения — оба живут в
 *  подсистемах, которые в общий пакет не едут:
 *  1) loadFavorites — чтение через оффлайн-снимок (lib/offlineSnapshot.ts):
 *     сервер лёг, а список всё равно виден. Браузер такого не умеет и просто
 *     спрашивает сервер;
 *  2) warmRow — прогрев строки под курсором (player/useWarmer.ts, Rust-движок):
 *     трек начинает готовиться раньше клика.
 *
 *  ⚠️ Хуки зовутся ЗДЕСЬ, а не в общем экране: useWarmRow обязан читать
 *  контекст приложения, а withSnapshot тянет @tauri-независимый, но
 *  приложенческий localStorage-снимок со скоупом пользователя.
 *  Новый код импортирует общий экран из "@muza/app/views/FavoritesView". */

import { FavoritesView as SharedFavoritesView } from "@muza/app/views/FavoritesView";
import { withSnapshot } from "../lib/offlineSnapshot";
import { useWarmRow } from "../player/useWarmer";

type SharedProps = React.ComponentProps<typeof SharedFavoritesView>;

export function FavoritesView(props: Omit<SharedProps, "loadFavorites" | "warmRow">) {
  const warmRow = useWarmRow();
  return (
    <SharedFavoritesView
      {...props}
      loadFavorites={() => withSnapshot("favorites", () => props.api.getFavorites()).then(({ data }) => data)}
      warmRow={warmRow}
    />
  );
}
