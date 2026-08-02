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
 *  приложении она уводит в настройки, где у статистики свой под-экран; здесь
 *  она открывает диалог с теми же рядами (@muza/app/shell/StatsBlocksDialog) —
 *  один клик вместо ухода со страницы, на которую человек как раз и смотрит.
 *  Тот же под-экран у веба с тех пор появился (Настройки → Медиатека →
 *  Статистика, общий StatsSub) и правит ТУ ЖЕ настройку профиля: место входа
 *  разное, хранилище одно.
 *
 *  Период открытия — оттуда же, из профиля (initialPeriod ниже). Пока его сюда
 *  не подавали, ряд «Период» в настройках менял сохранённое значение впустую,
 *  и показывать его было нельзя. */
export default function StatsPage() {
  const { session } = useSession();
  const { current, playing, playContext } = usePlayer();
  const { likedIds, toggle } = useLikes();
  const { prefs, set } = usePrefs();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Состав блоков хранится в профиле веба (тот же JSON настроек в браузере, что
  // тема и эквалайзер) — с 2026-08-02 это ОБЩАЯ модель настроек, и statsBlocks
  // в ней объявлен: приведения типа, которые здесь стояли, пока веб-профиль был
  // своим узким типом, сняты.
  const savedBlocks = prefs.statsBlocks;
  const saveBlocks = (next: StatsBlockPref[]) => set({ statsBlocks: next });
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
        // Период, с которым страница открывается, — настройка профиля, ровно
        // как в приложении. Без этой строки ряд «Период» в настройках менял бы
        // сохранённое значение, а страница всё равно открывалась бы на месяце:
        // ряд, который никуда не приезжает, показывать нельзя.
        initialPeriod={prefs.statsPeriod}
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
