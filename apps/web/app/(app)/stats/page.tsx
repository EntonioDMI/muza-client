"use client";

import { useState } from "react";
import type { StatsPeriod, Track } from "@muza/api-client";
import { StatsView } from "@muza/app/views/StatsView";
import { ContextMenuProvider } from "@muza/app/shell/ContextMenu";
import { getApi } from "../../../src/api";
import { useWebTrackMenu } from "../../../src/components/TrackList";
import { useLikes } from "../../../src/likes";
import { usePlayer } from "../../../src/player";
import { useSession } from "../../../src/session";

/** Статистика веба — ТОТ ЖЕ экран, что в приложении (@muza/app/views/StatsView).
 *
 *  До 2026-08-02 здесь жила своя урезанная копия, и она успела разъехаться с
 *  приложением: плоские «Серии» вместо герой-числа с полосой «до рекорда», не
 *  было блока «Лайки», подсказки на барах были браузерные вместо тултипов ДС.
 *  Теперь страница только подаёт общему экрану то, что знает про браузер:
 *  плеер, лайки и меню строки.
 *
 *  Что осталось за бортом и почему: настройки набора и порядка блоков — они
 *  живут в Prefs приложения, у веба такого экрана настроек нет, поэтому здесь
 *  показываются все блоки в каноническом порядке, а кнопки «Настроить» нет
 *  вовсе (не серая — правило умений площадки). */
export default function StatsPage() {
  const { session } = useSession();
  const { current, playing, playContext } = usePlayer();
  const { likedIds, toggle } = useLikes();
  // Треки топа приезжают вместе с агрегатами — забираем их по дороге, чтобы
  // меню строки и лайк знали, с чем работают (список нужен ДО рендера меню).
  const [topTracks, setTopTracks] = useState<Track[]>([]);
  const menu = useWebTrackMenu(topTracks);

  return (
    // suppressNativeMenu={false}: у браузера своё меню — на сайте его не отбираем
    <ContextMenuProvider ctx={menu.abilities} apiRef={menu.apiRef} suppressNativeMenu={false}>
      <StatsView
        api={getApi()}
        canSearch={session !== null}
        currentId={current?.id ?? null}
        playing={playing}
        likes={[...likedIds]}
        onPlayCatalog={(tracks, id) => {
          const i = tracks.findIndex((tr) => tr.id === id);
          if (i >= 0) playContext(tracks, i);
        }}
        onLike={(id) => {
          const tr = topTracks.find((x) => x.id === id);
          if (tr) toggle(tr);
        }}
        onCatalogMenu={(tr, e) => menu.openRowMenu(tr, e)}
        loadOverview={async (period: StatsPeriod) => {
          const data = await getApi().getStatsOverview(period);
          setTopTracks(data.topTracks.map((entry) => entry.track));
          return { data, offline: false };
        }}
      />
      {menu.overlay}
    </ContextMenuProvider>
  );
}
