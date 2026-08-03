"use client";

import { useEffect, useState } from "react";
import { ListeningMode } from "@muza/app/shell/ListeningMode";
import { usePlayer, usePosition } from "../player";
import { usePrefs } from "../prefs";
import { useLyricsMenu, useTrackLyrics } from "./LyricsPanel";

/** Полноэкранный режим прослушивания (караоке) в БРАУЗЕРЕ — тот же общий
 *  оверлей, что в приложении (@muza/app/shell/ListeningMode). Здесь только
 *  проводка веба: откуда трек, позиция, текст и настройки.
 *
 *  ПОЧЕМУ ЭТОТ ФАЙЛ ПОЯВИЛСЯ. Оверлей переехал в общий пакет волной 2, но веб
 *  его не подключал: в MobileNowPlaying.tsx стоял комментарий «сцена — две
 *  колонки, на 375px это чужая раскладка». Решение верное для ТЕЛЕФОНА и
 *  молча распространилось на десктопный браузер, где две колонки как раз есть.
 *  Итог: в программе по клику на обложку открывалось караоке во весь экран, на
 *  сайте та же кнопка (она была, с той же подсказкой «Слушать») не делала
 *  ничего. Теперь делает.
 *
 *  ТЕЛЕФОН НЕ ТРОГАЕМ. Там караоке-сцена — это MobileNowPlaying (полный экран
 *  с окном строк), и два полноэкранных режима друг поверх друга не нужны.
 *  Оверлей на телефонной раскладке НЕ МОНТИРУЕТСЯ вовсе (не «спрятан css»):
 *  display:none не отменяет ни слушателей клавиш оверлея (Esc, T), ни его
 *  rAF-циклов — а именно они и есть цена кадров.
 *
 *  ⚠️ ВИЗУАЛИЗАТОРА В ВЕБЕ ПОКА НЕТ, и это не забывчивость. Оверлей рисует
 *  канвас, только если ему дали `getAnalyser` (см. его шапку), а у веб-плеера
 *  анализатора не существует: Web Audio-цепь в apps/web/src/audioFx.ts строится
 *  ТОЛЬКО под эквалайзер и AnalyserNode в себе не держит. Заводить второй
 *  AudioContext поверх играющего <audio> нельзя — createMediaElementSource
 *  необратим и разово уводит звук в чужую цепь. Поэтому здесь `visualizer`
 *  не передаётся вовсе: нет источника — нет и rAF-цикла 60 Гц, ради которого
 *  владелец жаловался на просадку ФПС в играх (02.08). Когда в audioFx
 *  появится анализатор, включать его надо ВМЕСТЕ с гейтом видимости вкладки:
 *  `visualizer={docVisible ? prefs.visualizer : "off"}` — в браузере фоновая
 *  вкладка кадры обычно и так не получает, но «обычно» не гарантия.
 *
 *  Качание при басах (prefs.bassShake) по той же причине спит: его цикл в
 *  оверлее выходит первой же строкой без getAnalyser. Проп всё равно
 *  передаётся — чтобы в день появления анализатора настройка заработала сама,
 *  а не ждала правки этого файла. */

/** ⚠️ ЗЕРКАЛО медиа-запросов globals.css (раздел «Брейкпоинты»): ровно те
 *  ветки, где `.playerbar { display: none }` — телефон-портрет, телефон в
 *  ландшафте и низкий ландшафт. Мирятся с копией сознательно: единственный
 *  вход в режим — кнопки ПОЛОСЫ ПЛЕЕРА, значит «полосы нет» = «режима нет», и
 *  условие обязано совпадать. Разъедется — оверлей либо станет недостижим на
 *  планшете, либо всплывёт на телефоне поверх своего же now-playing.
 *  Правишь телефонные ветки в globals.css — правь и эту строку. */
const PHONE_MQ =
  "(max-width: 699px), (max-width: 899px) and (orientation: landscape), (orientation: landscape) and (max-height: 480px)";

/** Телефонная раскладка сейчас? До монтирования (SSR-пререндер статического
 *  экспорта) — false: окна нет, спрашивать некого, а оверлей всё равно скрыт
 *  пропом open. */
function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_MQ);
    const apply = () => setPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return phone;
}

export function ListeningModeHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePlayer();
  const { position, duration } = usePosition();
  const { prefs, set } = usePrefs();
  const { lines, activeLine, loading, seekLine, panelPrefs, explainLine, meaningDialog } = useTrackLyrics();
  // ПКМ по строке — то же меню текста, что у панели «Сейчас играет» и у
  // приложения (копировать всё/строку, «Смысл строки»)
  const openLyricsMenu = useLyricsMenu(lines, explainLine);
  const phone = usePhoneLayout();
  const current = p.current;

  // Режим — про КОНКРЕТНЫЙ трек: очередь кончилась — выходим сами (то же
  // правило, что у приложения, где оверлей просто не рисуется без трека).
  useEffect(() => {
    if (open && !current) onClose();
  }, [open, current, onClose]);

  // Окно сузили до телефонного, а режим был открыт: ниже мы размонтируемся, и
  // без этого состояние осталось бы «открыто» — вернувшись на широкое окно,
  // человек получил бы караоке, которого не просил.
  useEffect(() => {
    if (phone && open) onClose();
  }, [phone, open, onClose]);

  if (!current || phone) return null;

  return (
    <>
      <ListeningMode
        open={open}
        track={{
          id: current.id,
          title: current.title,
          artist: current.artist,
          album: current.album ?? "",
          cover: current.coverUrl,
          // Длительность живая (метаданные <audio>), пока её нет — серверная:
          // иначе первые секунды ползунок стоял бы на нулевой шкале. Тот же
          // приём, что в components/PlayerBar.tsx.
          duration: duration > 0 ? duration : current.durationSec,
        }}
        lyrics={lines}
        lyricsLoading={loading}
        playing={p.playing}
        pos={position}
        speed={p.speed}
        activeLine={activeLine}
        lyricsAutoScroll={panelPrefs.lyricsAutoScroll}
        lyricsEndNote={panelPrefs.lyricsEndNote}
        karaokeLines={prefs.karaokeLines}
        onTogglePlay={p.toggle}
        onPrev={p.prev}
        onNext={p.next}
        onSeek={p.seek}
        onSeekLine={seekLine}
        onExplain={explainLine}
        onLineContextMenu={openLyricsMenu}
        onClose={onClose}
        lyricsShown={prefs.listeningLyricsShown}
        onToggleLyrics={() => set({ listeningLyricsShown: !prefs.listeningLyricsShown })}
        bassShake={prefs.bassShake}
        bassShakeStrength={prefs.bassShakeStrength}
        bassSharp={prefs.bassSharp}
        bassReach={prefs.bassReach}
        anims={prefs.anims}
      />
      {/* Карточка смысла строки — соседом оверлея, как в приложении: сам
          оверлей её не держит (он под ней по z-index, диалог живёт на уровне
          окна). Тот же порядок, что у components/NowPlayingPanel.tsx. */}
      {meaningDialog}
    </>
  );
}
