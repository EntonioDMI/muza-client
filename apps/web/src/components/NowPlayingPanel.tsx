"use client";

import { NowPlayingPanel as SharedNowPlayingPanel } from "@muza/app/shell/NowPlayingPanel";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { useTrackLyrics } from "./LyricsPanel";

/** Правая панель «Сейчас играет» (≥1200px) — теперь ТОТ ЖЕ экран, что в
 *  приложении (@muza/app/shell/NowPlayingPanel, Э7 веб-паритета). Здесь
 *  осталась только проводка веба: где взять трек, лайк и текст.
 *
 *  Что изменилось для посетителя: текст песни стал героем панели (крупное
 *  полотно с автопрокруткой и подсветкой активной строки), а не мелким блоком
 *  под обложкой; шапка, обложка, название и сердце — пиксель в пиксель как в
 *  приложении.
 *
 *  Чего у веба пока нет и почему пропы не передаются:
 *  - видео вместо обложки — видео-дорожку добывает движок приложения;
 *  - ПКМ по тексту и «Смысл строки» — контекстное меню веба ещё не сделано;
 *  - настройки текста (автопрокрутка, нотка, «строк в панели») — в веб-профиле
 *    таких полей нет, и общий экран берёт свои значения по умолчанию, равные
 *    заводским настройкам приложения. Появятся поля в prefs — сюда добавятся
 *    три пропа, и больше ничего.
 *
 *  ⚠️ className="zone np-panel" обязателен: панель — колонка CSS-сетки шелла,
 *  и брейкпоинты прячут её именно по этому классу. */
export function NowPlayingPanel({ onClose }: { onClose: () => void }) {
  const { current } = usePlayer();
  const { likedIds, toggle } = useLikes();
  const { lines, activeLine, loading, seekLine } = useTrackLyrics();
  if (!current) return null;

  return (
    <SharedNowPlayingPanel
      className="zone np-panel"
      track={{
        id: current.id,
        title: current.title,
        artist: current.artist,
        album: current.album ?? "",
        cover: current.coverUrl,
        duration: current.durationSec,
      }}
      lyrics={lines}
      lyricsLoading={loading}
      activeLine={activeLine}
      onSeekLine={seekLine}
      liked={likedIds.has(current.id)}
      onLike={() => toggle(current)}
      onClose={onClose}
    />
  );
}
