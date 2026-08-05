/** ПАМЯТЬ ПЛЕЕРА между запусками: громкость, немота, перемешивание, повтор,
 *  скорость. Отдельный ключ localStorage `muza.player.v1`.
 *
 *  Жалоба владельца (05.08): «при перезаходе в приложение не сохраняются
 *  настройки громкости и некоторые другие элементы». Проверка по коду её
 *  подтвердила буквально: на десктопе не сохранялось НИЧЕГО из этого списка —
 *  громкость каждый запуск начиналась с 64, немота/перемешивание/повтор/
 *  скорость с начальных значений (useState в player/usePlayback.ts).
 *
 *  ПОЧЕМУ ОТДЕЛЬНЫЙ КЛЮЧ, А НЕ ПОЛЯ В Prefs — три независимые причины.
 *
 *  1. ЦЕНА ЗАПИСИ. Prefs пишется ЦЕЛИКОМ на каждое изменение (savePrefs →
 *     JSON.stringify профиля, ~8 КБ), а протяжка слайдера громкости даёт
 *     60–120 событий в секунду. Троттлить сам Prefs нельзя: движок зеркала
 *     durableState (apps/desktop/src/lib/durableState.ts) НАМЕРЕННО оставил
 *     синхронную половину — запись в localStorage — без задержки, чтобы
 *     читатели не видели отставания; склеивается только дорогая половина,
 *     поход на диск. Задержать её здесь — значит задержать её всем.
 *  2. ПЕРЕНОСИМОСТЬ. Prefs — переносимый профиль (один ключ на приложение и
 *     веб, экспорт/импорт, будущая синхронизация аккаунта). Громкость
 *     конкретных наушников с оформлением не переносится: приехав на другую
 *     машину, человек ждёт СВОЙ вид, но не чужой уровень звука.
 *  3. ЭТО НЕ НАСТРОЙКИ. У shuffle/repeat/speed нет ряда на экране настроек и
 *     не должно быть: это положение органов управления плеером, а не решение
 *     человека о поведении программы.
 *
 *  Следствие для соседей: новых полей в Prefs не появляется, значит
 *  THEME_KEYS/THEME_EXCLUDED и сторож prefs/themes.coverage.test.ts этой
 *  памятью не затрагиваются вовсе.
 *
 *  ЗАПИСЬ — ОКНО СКЛЕЙКИ, А НЕ DEBOUNCE (образец — mirrorWrite в
 *  durableState.ts): первая запись открывает окно, все попавшие в него
 *  схлопываются в одну, и свежайшее значение уезжает не позже COALESCE_MS
 *  после любого движения. При debounce затянутая протяжка слайдера не писала
 *  бы вообще ничего — а именно она тут и типична.
 *
 *  ЧТЕНИЕ — с проверкой вида значения (образец — typedOverlay в
 *  prefs/load.ts): ключ переживает смену версий клиента и правку руками, и
 *  `"repeat": "loud"` не имеет права доехать до движка. */

import type { RepeatMode } from "../prefs/types";

export interface PlayerState {
  /** Громкость 0–100 — ШКАЛА СЛАЙДЕРА приложения, а не усиление движка:
   *  движок берёт от неё свою кривую, и хранение производной означало бы
   *  пересчёт туда-обратно с потерей на округлении при каждом запуске. */
  volume: number;
  /** Куда вернуть громкость, когда немоту выключат. Хранится отдельно, потому
   *  что немота — это не volume 0: человек, убравший звук в ноль руками, при
   *  снятии немоты обязан остаться в нуле. */
  volumeBeforeMute: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Скорость воспроизведения; шаги кнопки в баре задаёт Prefs.speedSteps. */
  speed: number;
}

export const PLAYER_STATE_KEY = "muza.player.v1";

/** Дефолты = тем значениям, с которых плеер стартовал ДО появления памяти
 *  (usePlayback): у человека, впервые запустившего новую сборку, ничего не
 *  дрогнет — память начнёт работать со следующего запуска. */
export const DEFAULT_PLAYER_STATE: PlayerState = {
  volume: 64,
  volumeBeforeMute: 64,
  muted: false,
  shuffle: false,
  repeat: "off",
  speed: 1,
};

const KNOWN_KEYS = Object.keys(DEFAULT_PLAYER_STATE) as (keyof PlayerState)[];

const REPEAT_MODES: readonly string[] = ["off", "all", "one"];

/** Границы числовых полей. Скорость шире сегодняшнего набора
 *  Prefs.speedSteps намеренно: шаги настраиваются человеком, и кламп обязан
 *  пропускать ЕГО выбор, а не список из коробки. */
const RANGES: Record<string, { min: number; max: number }> = {
  volume: { min: 0, max: 100 },
  volumeBeforeMute: { min: 0, max: 100 },
  speed: { min: 0.25, max: 4 },
};

/** Наложить произвольный источник на известное состояние, СВЕРЯЯ ВИД значения.
 *  Один валидатор и на чтение с диска, и на приходящий из UI patch: снаружи
 *  оба выглядят одинаково — «объект, в котором что-то лежит», — и вторая,
 *  более мягкая дорожка внутрь состояния была бы дырой в первой. */
function overlay(base: PlayerState, src: unknown): PlayerState {
  if (typeof src !== "object" || src === null || Array.isArray(src)) return { ...base };
  const bag = src as Record<string, unknown>;
  const out = { ...base } as Record<string, unknown>;
  for (const key of KNOWN_KEYS) {
    const v = bag[key];
    if (v === undefined) continue;
    if (typeof v !== typeof DEFAULT_PLAYER_STATE[key]) continue;
    if (typeof v === "number") {
      // NaN/Infinity доехали бы до audio-элемента и уронили бы звук молча
      if (!Number.isFinite(v)) continue;
      const r = RANGES[key];
      out[key] = r ? Math.min(r.max, Math.max(r.min, v)) : v;
      continue;
    }
    // Режим повтора — только три известные строки: чужое значение развернуло
    // бы очередь в состояние, которого в usePlayback нет ни в одной ветке.
    if (key === "repeat" && !REPEAT_MODES.includes(v as string)) continue;
    out[key] = v;
  }
  return out as unknown as PlayerState;
}

/** Сырое содержимое ключа. `{}` — пусто, битый JSON или не объект. */
function readStored(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY) ?? "") as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    // нет localStorage (SSR) либо не JSON — начинаем с дефолтов
    return {};
  }
}

/** Потолок задержки записи, мс. Это НЕ debounce (см. шапку файла), а окно
 *  склейки: 250мс = максимум 4 записи в секунду вместо 60–120. */
const COALESCE_MS = 250;

/** Живое состояние в памяти. null — этот сеанс ключа ещё не касался. */
let live: PlayerState | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function writeNow(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty || live === null) return;
  dirty = false;
  // ИНВАРИАНТ ПЛОЩАДОК (тот же, что у Prefs): пишем объект ЦЕЛИКОМ, включая
  // незнакомые поля, которые уже лежат в ключе. Клиенты разных версий делят
  // одно хранилище, и запись «только своими полями» означала бы, что заход из
  // браузера стирает то, что собрано в приложении.
  const foreign = readStored();
  for (const key of KNOWN_KEYS) delete foreign[key];
  try {
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({ ...foreign, ...live }));
  } catch {
    /* квота/приватный режим — потеря громкости не стоит падения плеера */
  }
}

/** Сброс на диск при уходе окна. Ставится ЛЕНИВО, с первой же записи: модуль
 *  импортируется и там, где до плеера дело не дойдёт вовсе (образец —
 *  armUnloadFlush в apps/desktop/src/lib/resumeStore.ts). pagehide — то, что
 *  WebView2 гарантированно доводит до конца при закрытии; visibilitychange
 *  ловит сворачивание (после него владелец и «завершает задачу»),
 *  beforeunload — страховка. */
let unloadArmed = false;
function armUnloadFlush(): void {
  if (unloadArmed || typeof window === "undefined") return;
  unloadArmed = true;
  window.addEventListener("pagehide", writeNow);
  window.addEventListener("beforeunload", writeNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") writeNow();
  });
}

function schedule(): void {
  armUnloadFlush();
  // Именно «если окна ещё нет»: перезапуск таймера на каждой записи означал бы,
  // что во время непрерывной протяжки слайдера на диск не уходит ничего.
  if (timer === null) timer = setTimeout(writeNow, COALESCE_MS);
}

/** Состояние плеера с прошлого запуска; ничего не сохранено или сохранение
 *  битое — дефолты. */
export function loadPlayerState(): PlayerState {
  // Отложенная запись обязана лечь на диск РАНЬШЕ, чем мы его прочитаем, —
  // иначе повторный вызов вернул бы значение старее того, что уже в памяти.
  writeNow();
  live = overlay(DEFAULT_PLAYER_STATE, readStored());
  return live;
}

/** Запомнить изменившееся. Запись на диск склеивается окном (см. COALESCE_MS);
 *  в памяти значение обновляется сразу, поэтому соседний loadPlayerState в том
 *  же сеансе видит свежее. */
export function savePlayerState(patch: Partial<PlayerState>): void {
  const base = live ?? loadPlayerState();
  live = overlay(base, patch);
  dirty = true;
  schedule();
}
