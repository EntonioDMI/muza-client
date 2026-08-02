"use client";

import { useEffect, useMemo } from "react";
import { ContextMenuProvider } from "@muza/app/shell/ContextMenu";
import { FavoritesView } from "@muza/app/views/FavoritesView";
import { getApi } from "../../../src/api";
import { useLikes } from "../../../src/likes";
import { usePlayer } from "../../../src/player";
import { useToast } from "../../../src/toast";
import { useWebTrackMenu } from "../../../src/components/TrackList";

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
 *  Обновление при заходе: лайки могли прилететь с десктопа. */
export default function FavoritesPage() {
  const { likedIds, favorites, toggle, refresh } = useLikes();
  const { current, playing, playContext } = usePlayer();
  const notify = useToast();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Список id — ЗАВИСИМОСТЬ эффекта внутри экрана (лайкнул/разлайкнул → он
  // перечитывает избранное). Ссылка обязана меняться только вместе с набором:
  // новый массив на каждый рендер отправил бы экран в бесконечный перезапрос.
  const likes = useMemo(() => [...likedIds], [likedIds]);
  const menu = useWebTrackMenu(favorites);

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
