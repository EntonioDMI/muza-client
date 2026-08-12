"use client";

import { useMemo } from "react";
import { ContextMenuProvider } from "@muza/app/shell/ContextMenu";
import { FavoritesView } from "@muza/app/views/FavoritesView";
import { getApi } from "../../../src/api";
import { useLikes } from "../../../src/likes";
import { usePlayer } from "../../../src/player";
import { useToast } from "../../../src/toast";
import { useWebTrackMenu } from "../../../src/components/trackMenu";

/** «Любимое» — тот же экран, что в приложении (@muza/app/views/FavoritesView,
 *  волна экранов веб-паритета 2026-08-02). Своей вёрстки у страницы больше нет:
 *  раньше здесь был свой заголовок и свой TrackList, из-за чего строки,
 *  счётчик и пустое состояние жили отдельной жизнью от приложения.
 *
 *  Страница осталась ровно проводкой: где взять список (сервер), что делать по
 *  клику (общий плеер веба), кому показать меню (общее меню с умениями
 *  браузера — useWebTrackMenu). Чего у браузера нет, того на экране и нет:
 *  прогрева строк и чтения из последнего снимка при недоступном сервере
 *  (эти пропы отдаёт только приложение).
 *
 *  Обновление при заходе: лайки могли прилететь с десктопа — этим занимается
 *  срок свежести общего ключа QK.favorites, а не эффект на странице.
 *  ⚠️ Здесь стоял `useEffect(() => void refresh(), [refresh])`, и он был ВТОРЫМ
 *  из трёх походов за одним и тем же списком на одно открытие экрана (первый —
 *  LikesProvider, третий — сам экран). Разбор — шапка src/likes.tsx. */
export default function FavoritesPage() {
  const { likedIds, favorites, toggle } = useLikes();
  const { current, playing, playContext } = usePlayer();
  const notify = useToast();

  // Список id: ссылка обязана меняться только вместе с набором — новый массив
  // на каждый рендер дёргал бы экран впустую.
  const likes = useMemo(() => [...likedIds], [likedIds]);
  // place="favorites" — ровно ради пункта «Заменить версию»: он есть только
  // здесь и в плейлисте (в приложении так же — App.tsx, inFavorites у
  // FavoritesView). Остальные экраны идут местом "search" по умолчанию.
  const menu = useWebTrackMenu(favorites, { place: "favorites" });

  return (
    // suppressNativeMenu={false}: у браузера своё меню — на сайте отбирать его
    // нельзя (строкам это не мешает, их openMenu гасит нативное сам)
    <ContextMenuProvider ctx={menu.abilities} apiRef={menu.apiRef} suppressNativeMenu={false}>
      {/* .shared-screen гасит отступ зоны: общий экран приносит свои поля,
          как в приложении, где <main> голый (globals.css) */}
      <div className="shared-screen">
      <FavoritesView
        api={getApi()}
        canSearch
        likes={likes}
        currentId={current?.id ?? null}
        playing={playing}
        onPlayCatalog={(tracks, id) => {
          const i = tracks.findIndex((tr) => tr.id === id);
          playContext(tracks, i < 0 ? 0 : i);
        }}
        onLike={(id) => {
          const tr = favorites.find((x) => x.id === id);
          if (tr) toggle(tr);
        }}
        onCatalogMenu={(tr, e) => menu.openRowMenu(tr, e)}
        onNotify={(text, icon) => notify(text, icon)}
      />
      </div>
      {menu.overlay}
    </ContextMenuProvider>
  );
}
