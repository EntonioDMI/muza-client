/** ТОНКАЯ ОБЁРТКА над общим экраном поиска (волна «экраны» веб-паритета,
 *  2026-08-02). Сам экран живёт в @muza/app/views/SearchView — им же рисует
 *  поиск веб, один в один.
 *
 *  Почему не голый пенёк-ре-экспорт, как у карточек рядом: у экрана есть одно
 *  умение, которого нет и не может быть у браузера, — ПРОГРЕВ строк. Пока
 *  курсор идёт к строке, приложение уже тянет метаданные добычи (player/
 *  useWarmer.ts), и клик не платит за резолв. Модуль прогрева тянет движок
 *  (Tauri) и в общий пакет не поедет никогда, поэтому общий экран принимает
 *  его пропом `warmRow`, а вставляет проп вот эта обёртка. Веб пропа не даёт —
 *  и на строках просто нет обработчиков прогрева.
 *
 *  Второе отличие — форма `onOpenScPlaylist`: общий экран отдаёт карточку
 *  целиком (браузеру нужна ссылка на первоисточник), приложению нужен id для
 *  своей read-only страницы. Переходник здесь, чтобы App.tsx не менялся.
 *
 *  Больше в обёртке ничего быть НЕ ДОЛЖНО: любая правка вида/поведения —
 *  в общий экран, иначе клиенты снова разъедутся. */

import type { ComponentProps } from "react";
import type { PublicPlaylist } from "@muza/api-client";
import { SearchView as SharedSearchView } from "@muza/app/views/SearchView";
import { useWarmRow } from "../player/useWarmer";

type SharedProps = ComponentProps<typeof SharedSearchView>;

export function SearchView({
  onOpenScPlaylist,
  ...rest
}: Omit<SharedProps, "onOpenScPlaylist" | "warmRow"> & {
  /** Открыть read-only страницу плейлиста SoundCloud (2026-07-20). */
  onOpenScPlaylist: (id: string) => void;
}) {
  const warmRow = useWarmRow();
  return (
    <SharedSearchView
      {...rest}
      warmRow={warmRow}
      onOpenScPlaylist={(p: PublicPlaylist) => onOpenScPlaylist(p.id)}
    />
  );
}
