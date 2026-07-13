/** Планирование авто-перехода между треками (T19): общая логика для двух
 *  "ранних" механизмов стыка — длинный слышимый кроссфейд (prefs.crossfade,
 *  уже был в Stage 3/5) и короткий micro-fade "gapless" (prefs.gapless).
 *  Оба идут через один и тот же audioEngine.play(url, norm, fadeSec) —
 *  разница только в длительности фейда и в том, насколько рано (по
 *  timeupdate, см. usePlayback.onTime) он запускается. Кроссфейд
 *  приоритетнее: если включены оба, стык ведёт его длинная кривая — она
 *  надёжно прячет джиттер setTimeout/timeupdate, а короткая под ней всё
 *  равно осталась бы незаметна.
 *
 *  Вынесено в чистую функцию без DOM/движка — юнит-тест без мока Audio API
 *  (gaplessPlan.test.ts). */

/** Длительность кроссфейда при "Кроссфейд" (секунды) — как и раньше;
 *  вынесено сюда как единый источник истины (usePlayback импортирует). */
export const CROSSFADE_SEC = 4;
/** Нижняя граница окна триггера — не стартуем длинный кроссфейд «в упор». */
const CROSSFADE_TRIGGER_MARGIN_SEC = 0.5;

/** За сколько секунд до конца трека планировать gapless-стык. Специально
 *  СИЛЬНО ШИРЕ самого micro-fade (GAPLESS_XFADE_SEC) — запас на грануляцию
 *  timeupdate. Живая проверка (T19, CDP-автоматизация, окно без реального OS-
 *  фокуса — вероятно, худший случай) поймала ситуацию, где 0.3с оказалось
 *  МАЛО: timeupdate иногда тикает заметно реже "4 раза/сек" учебника (в фоне/
 *  без фокуса тики шли ~1 раз/сек) — окно (0, 0.3] проскакивалось между двумя
 *  тиками, и переход тихо откатывался на обычный onEnded-путь (не крашится,
 *  но уже не честный ранний стык). 1.5с — тот же порядок ширины окна, что у
 *  уже проверенного в проде CROSSFADE_SEC(4)−MARGIN(0.5)=3.5с, при 1 тике/сек
 *  почти гарантированно попадает хотя бы раз. */
export const GAPLESS_LEAD_SEC = 1.5;
/** Сам micro-fade на границе (equal-power, как у обычного кроссфейда, но
 *  короткий) — маскирует щелчок на стыке разных сэмплов, не воспринимается
 *  как «фейд». Побочный эффект честности: раз LEAD > XFADE, последние
 *  (LEAD − XFADE) ≈ 1.4с текущего трека физически не звучат — новый трек
 *  стартует раньше. На большинстве треков это хвостовая тишина/затухание и
 *  не слышно; если у трека резкий обрыв без хвоста без запаса тишины в конце
 *  — стык может обрезать что-то слышимое. Задокументировано в hint тумблера
 *  и в отчёте T19 как ограничение подхода (честный byte-exact gapless без
 *  этого зазора не достижим с двумя независимыми <audio>-элементами без
 *  щелчка — см. шапку файла). */
export const GAPLESS_XFADE_SEC = 0.05;

export interface AutoAdvanceInput {
  /** Секунд до конца текущего трека (duration − position текущего pos). */
  remaining: number;
  crossfadeEnabled: boolean;
  gaplessEnabled: boolean;
  /** repeat === "one" — трек повторяется сам на себя, авто-переход не нужен. */
  repeatOne: boolean;
  /** Есть куда переходить (см. usePlayback.nextIndexFor(1, true) !== null). */
  hasNext: boolean;
  /** Ранний авто-переход для этого pos уже запущен (autoAdvancedRef). */
  alreadyAdvanced: boolean;
}

export interface AutoAdvancePlan {
  trigger: boolean;
  /** Длительность фейда для engine().play(); 0 — обычный мгновенный переход
   *  (когда trigger=false это поле не имеет смысла, но всегда 0). */
  fadeSec: number;
}

/** Длительность фейда для авто-перехода по текущим префам (кроссфейд
 *  приоритетнее gapless, см. шапку файла). Общая точка для onTime-триггера
 *  ниже и для advance() — тот пересчитывает её сам на случай, если ранний
 *  триггер не сработал (трек закончился по обычному onEnded) и просит
 *  движок попробовать fade постфактум (engine.play молча откатится на
 *  мгновенный переход, если текущий слот уже не играет). */
export function pickAutoFadeSec(prefs: { crossfade: boolean; gapless: boolean }): number {
  if (prefs.crossfade) return CROSSFADE_SEC;
  if (prefs.gapless) return GAPLESS_XFADE_SEC;
  return 0;
}

/** Решение "пора ли запускать ранний авто-переход" на очередной timeupdate. */
export function planAutoAdvance(input: AutoAdvanceInput): AutoAdvancePlan {
  if (input.alreadyAdvanced || input.repeatOne || !input.hasNext) {
    return { trigger: false, fadeSec: 0 };
  }
  if (
    input.crossfadeEnabled &&
    input.remaining <= CROSSFADE_SEC &&
    input.remaining > CROSSFADE_TRIGGER_MARGIN_SEC
  ) {
    return { trigger: true, fadeSec: CROSSFADE_SEC };
  }
  if (
    !input.crossfadeEnabled &&
    input.gaplessEnabled &&
    input.remaining <= GAPLESS_LEAD_SEC &&
    input.remaining > 0
  ) {
    return { trigger: true, fadeSec: GAPLESS_XFADE_SEC };
  }
  return { trigger: false, fadeSec: 0 };
}
