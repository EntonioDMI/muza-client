/** Планирование авто-перехода между треками (T19): общая логика для двух
 *  "ранних" механизмов стыка — длинный слышимый кроссфейд (prefs.crossfade,
 *  уже был в Stage 3/5) и короткий micro-fade "gapless" (prefs.gapless).
 *  Оба идут через один и тот же audioEngine.play(url, norm, fadeSec) —
 *  разница только в длительности фейда и в том, насколько рано он
 *  запускается. Триггер решает planAutoAdvance ниже по "remaining" — его
 *  вызывают ДВА независимых источника в usePlayback: обычный timeupdate
 *  (широкий запас, годится для кроссфейда) и точный pollGapless (T19 fast-
 *  follow: self-adjusting setTimeout от engine().position(), см. usePlayback.ts)
 *  — он и делает узкий GAPLESS_LEAD_SEC надёжным. Кроссфейд приоритетнее:
 *  если включены оба, стык ведёт его длинная кривая — она надёжно прячет
 *  джиттер таймингов, а короткая под ней всё равно осталась бы незаметна.
 *
 *  Вынесено в чистую функцию без DOM/движка — юнит-тест без мока Audio API
 *  (gaplessPlan.test.ts). */

/** Длительность кроссфейда при "Кроссфейд" (секунды) — как и раньше;
 *  вынесено сюда как единый источник истины (usePlayback импортирует). */
export const CROSSFADE_SEC = 4;
/** Нижняя граница окна триггера — не стартуем длинный кроссфейд «в упор». */
const CROSSFADE_TRIGGER_MARGIN_SEC = 0.5;

/** За сколько секунд до конца трека планировать gapless-стык.
 *
 *  T19 fast-follow (ревью #2): раньше здесь стояло 1.5с — костыль под грубый
 *  триггер по timeupdate (в фоне/без OS-фокуса тикает ~1 раз/сек, узкое окно
 *  проскакивалось между тиками). Теперь триггер точный: usePlayback.pollGapless
 *  читает engine().position() напрямую через самоподстраивающийся setTimeout
 *  (не timeupdate), и в последние GAPLESS_ARM_LEAD_SEC секунд опрашивает его
 *  каждые ~20мс — окно ловли сузилось с «между тиками raз/сек» до «между
 *  соседними 20-мс проверками», так что LEAD можно держать вплотную к самому
 *  micro-fade (GAPLESS_XFADE_SEC), а не в 30 раз шире его.
 *
 *  Живой замер (T19 fast-follow, CDP-автоматизация — как и в исходном отчёте,
 *  вероятно худший случай: страница СКРЫТА (document.hidden=true) даже будучи
 *  "активной" вкладкой в этой тестовой среде): requestAnimationFrame в таком
 *  состоянии НЕ срабатывает вообще (проверено — 0 срабатываний за 9+с), а
 *  цепочка setTimeout(и) выравнивается движком браузера на ~1 срабатывание/с
 *  независимо от запрошенной задержки (наблюдались хопы через ~990-1015мс
 *  подряд, сколько бы мс ни запрашивалось). Это подтверждает: пока страница/
 *  окно РЕАЛЬНО скрыты (свёрнуты), ни один JS-таймер физически не может дать
 *  точность лучше ~1с — это архитектурный потолок Chromium, а не то, что
 *  можно "выточить точнее". Поэтому выбран setTimeout (не rAF: у него в этом
 *  сценарии НОЛЬ шансов сработать вообще, у setTimeout — по крайней мере
 *  редкие попадания); а узкий LEAD означает, что пока окно СВЁРНУТО/СКРЫТО,
 *  ранний стык, скорее всего, просто не успеет — трек доиграет обычным путём
 *  через onEnded (см. audioEngine.play: fade включается только пока текущий
 *  слот ещё !paused, так что "не успели" ⇒ тихий откат на мгновенный переход,
 *  НЕ обрезание хвоста). Пока окно видимо (даже без OS-фокуса — это НЕ то же
 *  самое, что document.hidden) — setTimeout не троттлится, точность держится
 *  в единицах мс, и узкий LEAD ловится надёжно. Итог: цена сужения окна —
 *  «gapless иногда молча становится обычным переходом, если окно свёрнуто»,
 *  а не «обрезает 1-1.5с звучания трека», что и было целью ревью. */
export const GAPLESS_LEAD_SEC = 0.1;
/** Сам micro-fade на границе (equal-power, как у обычного кроссфейда, но
 *  короткий) — маскирует щелчок на стыке разных сэмплов, не воспринимается
 *  как «фейд». Раз LEAD(0.1) > XFADE(0.05), последние (LEAD − XFADE) = 0.05с
 *  текущего трека физически не звучат — новый трек стартует чуть раньше.
 *  50мс — на порядок меньше прежних ~1.4с и ниже порога заметности почти на
 *  любом материале (задокументировано в hint тумблера). */
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

/** T19-fix (ревью): чистая логика планирования следующего опроса в
 *  usePlayback.pollGapless — self-adjusting setTimeout, читающий
 *  engine().position() напрямую (см. usePlayback.ts). pollGapless —
 *  самая тайминг-критичная и при этом самая тяжёлая для теста часть T19
 *  (React-хук + реальные таймеры); вынесена сюда ЧИСТАЯ формула расчёта
 *  задержки — юнит-тест без мока хука/движка/setTimeout.
 *
 *  Пока до конца трека (remainingSec) дальше leadSec — один дешёвый
 *  "дальний" прыжок: спим ровно до момента "remainingSec − leadSec"
 *  (переведено в мс), не тратя CPU на опрос всю длительность трека.
 *  Как только remainingSec опускается до leadSec (включительно) и ниже —
 *  тесный опрос с фиксированным шагом stepMs (в т.ч. когда remainingSec
 *  уже ≤ 0 — трек физически кончился, но таймер ещё не успели остановить
 *  снаружи; шаг остаётся тем же самым stepMs, не отрицательным). */
export function nextPollDelayMs(remainingSec: number, leadSec: number, stepMs: number): number {
  return remainingSec > leadSec ? (remainingSec - leadSec) * 1000 : stepMs;
}
