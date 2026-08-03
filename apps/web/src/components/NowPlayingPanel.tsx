"use client";

import { NowPlayingPanel as SharedNowPlayingPanel } from "@muza/app/shell/NowPlayingPanel";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { useLyricsMenu, useTrackLyrics } from "./LyricsPanel";

/** Правая панель «Сейчас играет» (≥1200px) — теперь ТОТ ЖЕ экран, что в
 *  приложении (@muza/app/shell/NowPlayingPanel, Э7 веб-паритета). Здесь
 *  осталась только проводка веба: где взять трек, лайк и текст.
 *
 *  Что изменилось для посетителя: текст песни стал героем панели (крупное
 *  полотно с автопрокруткой и подсветкой активной строки), а не мелким блоком
 *  под обложкой; шапка, обложка, название и сердце — пиксель в пиксель как в
 *  приложении.
 *
 *  Настройки раздела «Тексты песен» панель ЧИТАЕТ (волна 2026-08-02): они
 *  приезжают из useTrackLyrics — часть уже вшита в активную строку
 *  («Синхронный текст», «Нотка в конце»), часть отдаётся пропами общего
 *  экрана одним объектом panelPrefs. Спред, а не перечисление полей: новая
 *  настройка панели не должна требовать правки этого файла.
 *
 *  ПКМ по тексту приехала 2026-08-03 (was: «контекстное меню веба ещё не
 *  сделано» — оно давно есть). Пункты те же, что в приложении: скопировать весь
 *  текст, скопировать строку, «Смысл строки». Умение `copyText` лежит в
 *  провайдере оболочки (AppShell), обработчик собирает useLyricsMenu.
 *
 *  Чего у веба пока нет и почему проп не передаётся: видео вместо обложки —
 *  видео-дорожку добывает движок приложения, у страницы такого умения нет
 *  (и ряда настройки в браузере нет тоже).
 *
 *  ⚠️ className="zone np-panel" обязателен: панель — колонка CSS-сетки шелла,
 *  и брейкпоинты прячут её именно по этому классу. */
export function NowPlayingPanel({ onClose }: { onClose: () => void }) {
  const { current } = usePlayer();
  const { likedIds, toggle } = useLikes();
  const { lines, activeLine, loading, seekLine, panelPrefs, explainLine, meaningDialog } = useTrackLyrics();
  const openLyricsMenu = useLyricsMenu(lines, explainLine);
  // Без трека панель НЕ исчезает: в приложении это зона раскладки, и пустой она
  // показывает «Ничего не играет». Возврат null оставлял в сетке шелла пустую
  // колонку в 340px — правая треть экрана выглядела дырой, а раскладка прыгала
  // на первом же клике по песне (замечание владельца 02.08). Общая панель
  // пустое состояние умеет сама — ей нужен только track: null.
  if (!current) {
    return (
      <SharedNowPlayingPanel
        {...panelPrefs}
        className="zone np-panel"
        track={null}
        lyrics={[]}
        lyricsLoading={false}
        liked={false}
        onLike={() => undefined}
        activeLine={-1}
        onSeekLine={() => undefined}
      />
    );
  }

  return (
    <>
      <SharedNowPlayingPanel
        {...panelPrefs}
        onExplain={explainLine}
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
        onLineContextMenu={openLyricsMenu}
        liked={likedIds.has(current.id)}
        onLike={() => toggle(current)}
        onClose={onClose}
      />
      {/* Карточка смысла строки — соседом панели: сама панель её не держит
          (у приложения диалог тоже живёт снаружи, на уровне окна). */}
      {meaningDialog}
    </>
  );
}
