/** Какая строка текста поётся прямо сейчас.
 *
 *  Жила в теле App.tsx как useMemo по [pos, ...]. Переехала сюда, когда
 *  позиция перестала быть состоянием React (см. positionStore.ts): считать её
 *  теперь надо ПРЯМО НА ТИКЕ, вне рендера App, — иначе подсветка строки
 *  замерла бы вместе с ним. Функция чистая и дешёвая: её зовут ~4 раза в
 *  секунду на каждый смонтированный текст (панель «Сейчас играет» и оверлей
 *  караоке), а перерисовка происходит только когда НОМЕР строки сменился —
 *  раз в несколько секунд (DerivedPositionScope).
 *
 *  Логика не менялась при переезде ни на шаг: -1 у не-синхронизированного
 *  текста, «нотка» после последней строки, пустой список даёт 0. */

import type { LyricLine } from "./types";

export function activeLyricLine(
  pos: number,
  lyrics: readonly LyricLine[],
  opts: {
    /** Текст с таймкодами И включённая настройка «синхронный текст».
     *  false — активной строки нет вовсе (plain-список). */
    synced: boolean;
    /** prefs.lyricsEndNote: после последней строки активная переезжает на
     *  виртуальный индекс lyrics.length — «текст кончился, доигрывает музыка». */
    endNote: boolean;
  },
): number {
  if (!opts.synced) return -1;
  let a = 0;
  lyrics.forEach((l, i) => {
    if (l.t <= pos) a = i;
  });
  // Последнюю строку держим примерно столько, сколько типичную (зазор до
  // предпоследней), в рамках 2..8с — иначе нотка загоралась бы синей ещё
  // пока последняя строка поётся.
  if (opts.endNote && lyrics.length > 0 && a === lyrics.length - 1) {
    const last = lyrics[a].t;
    const prev = lyrics.length > 1 ? lyrics[a - 1].t : last - 4;
    const hold = Math.min(8, Math.max(2, last - prev));
    if (pos - last >= hold) a = lyrics.length;
  }
  return a;
}
