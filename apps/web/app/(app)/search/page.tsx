"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicPlaylist, Track } from "@muza/api-client";
import { useT } from "@muza/app";
import { usePlatform } from "@muza/app/platform";
import { ContextMenuProvider } from "@muza/app/shell/ContextMenu";
import { SearchView } from "@muza/app/views/SearchView";
import { getApi } from "../../../src/api";
import { useLikes } from "../../../src/likes";
import { usePlayer } from "../../../src/player";
import { usePlaylists } from "../../../src/playlists";
import { usePrefs } from "../../../src/prefs";
import { useSession } from "../../../src/session";
import { useToast } from "../../../src/toast";
import { useWebTrackMenu } from "../../../src/components/trackMenu";

/** Поиск веба — ТОТ ЖЕ экран, что в приложении (@muza/app/views/SearchView,
 *  волна «экраны» веб-паритета, 2026-08-02). Своей реализации здесь больше
 *  нет: страница только подаёт экрану данные площадки (сессия, плеер, лайки,
 *  плейлисты, тосты) и умения меню.
 *
 *  Что веб получил вместе с переездом и чего у него не было вовсе:
 *  - карточку найденного плейлиста с превью состава, «Слушать» и подпиской;
 *  - режим кода PL_… и @адреса (весь запрос целиком — прямой поиск плейлиста);
 *  - витрину «плейлисты от слушателей» под выдачей;
 *  - «Загрузить ещё» (лестница пула в источниках);
 *  - множественный выбор с панелью массовых действий и правой кнопкой.
 *  Своя урезанная выдача (GroupedTrackList + variantLabels) удалена — двум
 *  реализациям одного экрана больше негде разъехаться.
 *
 *  Панель массовых действий собирается ПО УМЕНИЯМ площадки: очереди и
 *  хранения на устройстве у браузера нет, поэтому там остаются «В плейлист» и
 *  «В любимое» — не серые кнопки, а просто отсутствующие. */
export default function SearchPage() {
  const { prefs } = usePrefs();
  const { t } = useT();
  const router = useRouter();
  const notify = useToast();
  const { session } = useSession();
  const { current, playing, playContext } = usePlayer();
  const { likedIds, toggle } = useLikes();
  const { refresh: refreshPlaylists } = usePlaylists();
  const platform = usePlatform();
  const [query, setQuery] = useState("");
  /** Показанные экраном треки: меню веба принимает Track целиком (лайк
   *  оптимистично правит список «Любимого»), а экран отдаёт наружу только
   *  плоский список строк — по нему и собирается меню. */
  const [rows, setRows] = useState<Track[]>([]);
  const menu = useWebTrackMenu(rows);

  /** Плейлист SoundCloud из выдачи. Своей read-only страницы у веба нет (она
   *  есть в приложении) — честно уводим к первоисточнику новой вкладкой через
   *  розетку площадки, а не рисуем кнопку, которая никуда не ведёт. */
  const openScPlaylist = (p: PublicPlaylist) => {
    if (p.permalinkUrl && platform.system) void platform.system.openExternal(p.permalinkUrl);
    else notify(t("views.search.somethingWrong"), "x");
  };

  return (
    // suppressNativeMenu={false}: у браузера своё меню («Открыть в новой
    // вкладке», «Назад») — на сайте отбирать его нельзя. Строкам это не
    // мешает: их openMenu гасит нативное меню сам.
    <ContextMenuProvider ctx={menu.abilities} apiRef={menu.apiRef} suppressNativeMenu={false}>
      {/* .shared-screen гасит отступ зоны: общий экран приносит свои поля,
          как в приложении, где <main> голый (globals.css) */}
      <div className="shared-screen">
      {/* ⚠️ Настройки поиска доезжают сюда ВСЕ ТРИ (2026-08-11). Раньше была
          одна — группировка, — и «Где искать» с «Мгновенным поиском» в
          настройках веба отсутствовали ровно поэтому: экран их не спрашивал, и
          ряды нечему было менять. Правило работает в обе стороны — ряд
          появляется только вместе с потребителем. */}
      <SearchView
        api={getApi()}
        // аноним сюда не попадает (шелл уводит на /login), но экран honest:
        // без сессии сервер каталога не знает
        canSearch={Boolean(session)}
        query={query}
        onQueryChange={setQuery}
        currentId={current?.id ?? null}
        playing={playing}
        likes={[...likedIds]}
        searchGrouping={prefs.searchGrouping}
        searchScope={prefs.searchScope}
        instantSearch={prefs.instantSearch}
        onPlayCatalog={(tracks, id) =>
          playContext(
            tracks,
            Math.max(
              tracks.findIndex((tr) => tr.id === id),
              0,
            ),
          )
        }
        onLike={(id) => {
          const tr = rows.find((r) => r.id === id);
          if (tr) toggle(tr);
        }}
        onNotify={notify}
        onCatalogMenu={(tr, e) => menu.openRowMenu(tr, e)}
        onOpenPlaylist={(id) => router.push(`/playlist?id=${id}`)}
        onOpenScPlaylist={openScPlaylist}
        onPlaylistsChanged={() => void refreshPlaylists()}
        onResultsChange={setRows}
      />
      </div>
      {menu.overlay}
    </ContextMenuProvider>
  );
}
