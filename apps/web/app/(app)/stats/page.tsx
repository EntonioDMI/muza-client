"use client";

import { useState } from "react";
import type { StatsPeriod, Track } from "@muza/api-client";
import { StatsView } from "@muza/app/views/StatsView";
import { ContextMenuProvider } from "@muza/app/shell/ContextMenu";
import {
  StatsBlocksDialog,
  enabledStatsBlocks,
  type StatsBlockPref,
} from "@muza/app/shell/StatsBlocksDialog";
import { getApi } from "../../../src/api";
import { useWebTrackMenu } from "../../../src/components/TrackList";
import { useLikes } from "../../../src/likes";
import { usePlayer } from "../../../src/player";
import { usePrefs } from "../../../src/prefs";
import { useSession } from "../../../src/session";

/** Статистика веба — ТОТ ЖЕ экран, что в приложении (@muza/app/views/StatsView).
 *
 *  До 2026-08-02 здесь жила своя урезанная копия, и она успела разъехаться с
 *  приложением: плоские «Серии» вместо герой-числа с полосой «до рекорда», не
 *  было блока «Лайки», подсказки на барах были браузерные вместо тултипов ДС.
 *  Теперь страница только подаёт общему экрану то, что знает про браузер:
 *  плеер, лайки и меню строки.
 *
 *  Состав и порядок блоков (2026-08-02): кнопка «Настроить» теперь есть и
 *  здесь — до этого веб-читатель не мог убрать ни одного блока вовсе. В
 *  приложении она уводит в настройки, где у статистики свой под-экран; у веба
 *  такого под-экрана нет, поэтому она открывает диалог с теми же рядами
 *  (@muza/app/shell/StatsBlocksDialog). Выбор — настройка профиля, живёт
 *  рядом с остальными настройками веба и переживает перезагрузку. */
export default function StatsPage() {
  const { session } = useSession();
  const { current, playing, playContext } = usePlayer();
  const { likedIds, toggle } = useLikes();
  const { prefs, set } = usePrefs();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Состав блоков хранится в профиле веба (тот же JSON настроек в браузере, что
  // тема и эквалайзер). Поле statsBlocks в типе WebPrefs пока не объявлено —
  // apps/web/src/prefs.tsx правит соседняя зона этой волны, — а провайдер
  // настроек носит профиль целиком и незнакомые поля переносит как есть: и
  // читает (`{...дефолты, ...сохранённое}`), и пишет (`{...прежнее, ...правка}`).
  // Появится поле в WebPrefs — приведения ниже снять, поведение не изменится.
  const profile = prefs as typeof prefs & { statsBlocks?: StatsBlockPref[] };
  const savedBlocks = profile.statsBlocks ?? [];
  const saveBlocks = (next: StatsBlockPref[]) => set({ statsBlocks: next } as Partial<typeof profile>);
  // Треки топа приезжают вместе с агрегатами — забираем их по дороге, чтобы
  // меню строки и лайк знали, с чем работают (список нужен ДО рендера меню).
  const [topTracks, setTopTracks] = useState<Track[]>([]);
  const menu = useWebTrackMenu(topTracks);

  return (
    // suppressNativeMenu={false}: у браузера своё меню — на сайте его не отбираем
    <ContextMenuProvider ctx={menu.abilities} apiRef={menu.apiRef} suppressNativeMenu={false}>
      {/* .shared-screen гасит отступ зоны: поле (24px) приносит сам экран,
          как в приложении, где <main> голый — иначе поля складывались бы
          (globals.css → «ЕДИНСТВЕННЫЙ способ погасить поле зоны») */}
      <div className="shared-screen">
      <StatsView
        api={getApi()}
        canSearch={session !== null}
        blocks={enabledStatsBlocks(savedBlocks)}
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
        onCustomize={() => setCustomizeOpen(true)}
        loadOverview={async (period: StatsPeriod) => {
          const data = await getApi().getStatsOverview(period);
          setTopTracks(data.topTracks.map((entry) => entry.track));
          return { data, offline: false };
        }}
      />
      </div>
      {/* Правки применяются сразу, как в приложении: кнопка внизу закрывает */}
      <StatsBlocksDialog
        open={customizeOpen}
        blocks={savedBlocks}
        onChange={saveBlocks}
        onClose={() => setCustomizeOpen(false)}
      />
      {menu.overlay}
    </ContextMenuProvider>
  );
}
